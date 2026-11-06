-- AI Mafia — initial schema (BRD §9.2).
-- Access model (I3): browsers never read game data directly. Every table has RLS on; only `models` and `ratings`
-- are publicly readable. Everything else is served by API routes using the service role + the engine's visibility filter.

create table public.models (
  id text primary key,
  provider text not null,
  model text not null,
  display_name text not null,
  pricing jsonb not null,
  enabled boolean not null default true
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  -- the engine/bench game id (e.g. "h2h_a-vs-b_classic6_s1.s3.a-mafia"); makes uploads idempotent and resumable
  external_id text not null unique,
  mode text not null check (mode in ('bench', 'live', 'human')),
  format text check (format in ('h2h', 'ffa', 'self')),
  run_id text,
  preset text not null,
  config jsonb not null,
  seed bigint not null,
  prompt_version text not null,
  status text not null check (status in ('running', 'awaiting_input', 'finished', 'aborted')),
  outcome text check (outcome in ('town', 'mafia', 'draw')),
  state jsonb,
  version int not null default 0,
  has_human boolean not null default false,
  created_by uuid references auth.users,
  cost_usd numeric(10, 5) not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (status <> 'finished' or outcome is not null)
);
create index games_run_id_idx on public.games (run_id);
create index games_finished_idx on public.games (status, finished_at desc);

create table public.seats (
  game_id uuid not null references public.games on delete cascade,
  seat_id text not null,
  name text not null,
  role text not null check (role in ('mafia', 'detective', 'doctor', 'villager')),
  persona_id text not null,
  controller jsonb not null,
  primary key (game_id, seat_id)
);

create table public.events (
  game_id uuid not null references public.games on delete cascade,
  seq int not null check (seq >= 0),
  day int not null,
  phase text not null,
  type text not null,
  visibility jsonb not null,
  actor_seat_id text,
  target_seat_id text,
  text text not null,
  payload jsonb,
  reply_to_seq int,
  created_at timestamptz not null default now(),
  primary key (game_id, seq) -- I7: no duplicate seqs (gaps are rejected by upload_game)
);

create table public.agent_calls (
  id bigserial primary key,
  game_id uuid not null references public.games on delete cascade,
  seq int,
  seat_id text,
  model_id text references public.models,
  prompt_version text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10, 6),
  latency_ms int,
  retries int,
  fallback boolean,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index agent_calls_game_idx on public.agent_calls (game_id);
create index agent_calls_model_day_idx on public.agent_calls (model_id, created_at);

create table public.ratings (
  model_id text not null references public.models,
  scope text not null check (scope in ('overall', 'as_mafia', 'as_town')),
  prompt_version text not null,
  preset text not null,
  mu double precision not null,
  sigma double precision not null,
  ordinal double precision not null,
  games int not null,
  updated_at timestamptz not null default now(),
  primary key (model_id, scope, prompt_version, preset)
);

create table public.highlights (
  game_id uuid not null references public.games on delete cascade,
  rank int not null,
  seq int,
  kind text not null,
  title text not null,
  blurb text not null,
  primary key (game_id, rank)
);

-- ── Row-level security ───────────────────────────────────────────────────────
alter table public.models enable row level security;
alter table public.games enable row level security;
alter table public.seats enable row level security;
alter table public.events enable row level security;
alter table public.agent_calls enable row level security;
alter table public.ratings enable row level security;
alter table public.highlights enable row level security;

-- Public read: the model list and the leaderboard ratings only.
create policy models_public_read on public.models for select to anon, authenticated using (true);
create policy ratings_public_read on public.ratings for select to anon, authenticated using (true);
-- games / seats / events / agent_calls / highlights: no policies ⇒ no direct client access at all (I3).
-- Belt and braces: strip table privileges too, so a future permissive policy can't silently expose them.
revoke all on public.games, public.seats, public.events, public.agent_calls, public.highlights from anon, authenticated;
revoke insert, update, delete on public.models, public.ratings from anon, authenticated;

-- ── Server-only write paths (service role) ───────────────────────────────────

-- Upload one finished game atomically: models (upsert), game, seats, events, agent_calls.
-- Idempotent on games.external_id. Rejects seq gaps/duplicates (I7). One function call = one transaction.
create or replace function public.upload_game(p jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  gid uuid;
  n int;
  lo int;
  hi int;
begin
  insert into models (id, provider, model, display_name, pricing, enabled)
  select x.id, x.provider, x.model, x.display_name, x.pricing, x.enabled
  from jsonb_to_recordset(coalesce(p -> 'models', '[]'::jsonb))
    as x(id text, provider text, model text, display_name text, pricing jsonb, enabled boolean)
  on conflict (id) do update
    set provider = excluded.provider, model = excluded.model, display_name = excluded.display_name,
        pricing = excluded.pricing, enabled = excluded.enabled;

  select id into gid from games where external_id = p -> 'game' ->> 'external_id';
  if gid is not null then
    return gid; -- already uploaded: resumable, never duplicated
  end if;

  select count(*), min((e ->> 'seq')::int), max((e ->> 'seq')::int)
    into n, lo, hi
  from jsonb_array_elements(coalesce(p -> 'events', '[]'::jsonb)) e;
  if n = 0 or lo <> 0 or hi <> n - 1 then
    raise exception 'upload_game: event seq must be gapless from 0 (got % events, min %, max %)', n, lo, hi
      using errcode = '22023';
  end if;

  insert into games (external_id, mode, format, run_id, preset, config, seed, prompt_version, status, outcome,
                     has_human, cost_usd, created_at, finished_at)
  select g.external_id, g.mode, g.format, g.run_id, g.preset, g.config, g.seed, g.prompt_version, g.status,
         g.outcome, g.has_human, g.cost_usd, g.created_at, g.finished_at
  from jsonb_to_record(p -> 'game') as g(
    external_id text, mode text, format text, run_id text, preset text, config jsonb, seed bigint,
    prompt_version text, status text, outcome text, has_human boolean, cost_usd numeric,
    created_at timestamptz, finished_at timestamptz)
  returning id into gid;

  insert into seats (game_id, seat_id, name, role, persona_id, controller)
  select gid, s.seat_id, s.name, s.role, s.persona_id, s.controller
  from jsonb_to_recordset(p -> 'seats')
    as s(seat_id text, name text, role text, persona_id text, controller jsonb);

  insert into events (game_id, seq, day, phase, type, visibility, actor_seat_id, target_seat_id, text, payload,
                      reply_to_seq, created_at)
  select gid, e.seq, e.day, e.phase, e.type, e.visibility, e.actor_seat_id, e.target_seat_id, e.text, e.payload,
         e.reply_to_seq, e.created_at
  from jsonb_to_recordset(p -> 'events')
    as e(seq int, day int, phase text, type text, visibility jsonb, actor_seat_id text, target_seat_id text,
         text text, payload jsonb, reply_to_seq int, created_at timestamptz);

  insert into agent_calls (game_id, seq, seat_id, model_id, prompt_version, input_tokens, output_tokens, cost_usd,
                           latency_ms, retries, fallback, raw)
  select gid, c.seq, c.seat_id, c.model_id, c.prompt_version, c.input_tokens, c.output_tokens, c.cost_usd,
         c.latency_ms, c.retries, c.fallback, c.raw
  from jsonb_to_recordset(coalesce(p -> 'agent_calls', '[]'::jsonb))
    as c(seq int, seat_id text, model_id text, prompt_version text, input_tokens int, output_tokens int,
         cost_usd numeric, latency_ms int, retries int, fallback boolean, raw jsonb);

  return gid;
end;
$$;

-- Replace the whole ratings table in one transaction (ratings are always rebuilt from scratch, BRD §8.4).
create or replace function public.replace_ratings(p jsonb)
returns int
language plpgsql
set search_path = public
as $$
declare
  n int;
begin
  delete from ratings where true;
  insert into ratings (model_id, scope, prompt_version, preset, mu, sigma, ordinal, games, updated_at)
  select r.model_id, r.scope, r.prompt_version, r.preset, r.mu, r.sigma, r.ordinal, r.games, now()
  from jsonb_to_recordset(coalesce(p, '[]'::jsonb))
    as r(model_id text, scope text, prompt_version text, preset text, mu double precision,
         sigma double precision, ordinal double precision, games int);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.upload_game(jsonb) from public, anon, authenticated;
revoke all on function public.replace_ratings(jsonb) from public, anon, authenticated;
grant execute on function public.upload_game(jsonb) to service_role;
grant execute on function public.replace_ratings(jsonb) to service_role;
