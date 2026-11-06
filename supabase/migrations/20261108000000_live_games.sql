-- Live games (BRD §9.4, §9.5). Server-only functions; browsers never touch these tables directly.

-- One request at a time performs a game's next model call: a short lease, taken with compare-and-swap on version.
alter table public.games add column step_lease_until timestamptz;
create index games_live_idx on public.games (status, mode) where status in ('running', 'awaiting_input');
create index games_created_by_day_idx on public.games (created_by, created_at);
create index agent_calls_created_idx on public.agent_calls (created_at);

-- ── Token-bucket rate limiting (per IP / per user) ──
create table public.rate_limits (
  key text primary key,
  tokens double precision not null,
  updated_at timestamptz not null default now()
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

-- Atomically refill and take one token; true = allowed.
create or replace function public.take_token(p_key text, p_capacity double precision, p_refill_per_sec double precision)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  t double precision;
begin
  insert into rate_limits (key, tokens, updated_at) values (p_key, p_capacity, now())
  on conflict (key) do update
    set tokens = least(p_capacity, rate_limits.tokens + extract(epoch from (now() - rate_limits.updated_at)) * p_refill_per_sec),
        updated_at = now()
  returning tokens into t;
  if t < 1 then
    return false;
  end if;
  update rate_limits set tokens = tokens - 1 where key = p_key;
  return true;
end;
$$;

-- Create a live game: game row (with engine state), seats, setup events. Atomic.
create or replace function public.create_live_game(p jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  gid uuid;
begin
  insert into games (external_id, mode, format, preset, config, seed, prompt_version, status, state, version, has_human, created_by, created_at)
  select g.external_id, g.mode, g.format, g.preset, g.config, g.seed, g.prompt_version, 'running', g.state, 0, g.has_human, g.created_by, now()
  from jsonb_to_record(p -> 'game') as g(
    external_id text, mode text, format text, preset text, config jsonb, seed bigint, prompt_version text,
    state jsonb, has_human boolean, created_by uuid)
  returning id into gid;

  insert into seats (game_id, seat_id, name, role, persona_id, controller)
  select gid, s.seat_id, s.name, s.role, s.persona_id, s.controller
  from jsonb_to_recordset(p -> 'seats') as s(seat_id text, name text, role text, persona_id text, controller jsonb);

  insert into events (game_id, seq, day, phase, type, visibility, actor_seat_id, target_seat_id, text, payload, reply_to_seq, created_at)
  select gid, e.seq, e.day, e.phase, e.type, e.visibility, e.actor_seat_id, e.target_seat_id, e.text, e.payload, e.reply_to_seq, e.created_at
  from jsonb_to_recordset(coalesce(p -> 'events', '[]'::jsonb))
    as e(seq int, day int, phase text, type text, visibility jsonb, actor_seat_id text, target_seat_id text, text text, payload jsonb, reply_to_seq int, created_at timestamptz);
  return gid;
end;
$$;

-- Take the step lease if the game is still at p_version and nobody else holds it. true = you may call the model.
create or replace function public.claim_step(p_id uuid, p_version int, p_lease_ms int)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  update games
     set step_lease_until = now() + make_interval(secs => p_lease_ms / 1000.0)
   where id = p_id
     and version = p_version
     and status = 'running'
     and (step_lease_until is null or step_lease_until < now());
  return found;
end;
$$;

-- Commit one step with compare-and-swap on version: new state, appended events (must continue the seq exactly,
-- I7), agent calls, cost. false = someone else already advanced; nothing is written.
create or replace function public.commit_step(p_id uuid, p_version int, p jsonb)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  next_seq int;
  n int;
  lo int;
  hi int;
begin
  update games
     set state = p -> 'state',
         version = version + 1,
         status = p ->> 'status',
         outcome = p ->> 'outcome',
         cost_usd = cost_usd + coalesce((p ->> 'cost_usd')::numeric, 0),
         finished_at = case when p ->> 'status' in ('finished', 'aborted') then now() else finished_at end,
         step_lease_until = null
   where id = p_id and version = p_version;
  if not found then
    return false;
  end if;

  select coalesce(max(seq) + 1, 0) into next_seq from events where game_id = p_id;
  select count(*), min((e ->> 'seq')::int), max((e ->> 'seq')::int) into n, lo, hi
    from jsonb_array_elements(coalesce(p -> 'events', '[]'::jsonb)) e;
  if n > 0 and (lo <> next_seq or hi <> next_seq + n - 1) then
    raise exception 'commit_step: events must continue at seq % (got % .. %)', next_seq, lo, hi using errcode = '22023';
  end if;

  insert into events (game_id, seq, day, phase, type, visibility, actor_seat_id, target_seat_id, text, payload, reply_to_seq, created_at)
  select p_id, e.seq, e.day, e.phase, e.type, e.visibility, e.actor_seat_id, e.target_seat_id, e.text, e.payload, e.reply_to_seq, e.created_at
  from jsonb_to_recordset(coalesce(p -> 'events', '[]'::jsonb))
    as e(seq int, day int, phase text, type text, visibility jsonb, actor_seat_id text, target_seat_id text, text text, payload jsonb, reply_to_seq int, created_at timestamptz);

  insert into agent_calls (game_id, seq, seat_id, model_id, prompt_version, input_tokens, output_tokens, cost_usd, latency_ms, retries, fallback)
  select p_id, c.seq, c.seat_id, c.model_id, c.prompt_version, c.input_tokens, c.output_tokens, c.cost_usd, c.latency_ms, c.retries, c.fallback
  from jsonb_to_recordset(coalesce(p -> 'agent_calls', '[]'::jsonb))
    as c(seq int, seat_id text, model_id text, prompt_version text, input_tokens int, output_tokens int, cost_usd numeric, latency_ms int, retries int, fallback boolean);
  return true;
end;
$$;

-- Today's (UTC) spend on web-initiated games — the global daily budget (§9.5).
create or replace function public.live_spend_today()
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(a.cost_usd), 0)
  from agent_calls a join games g on g.id = a.game_id
  where g.mode in ('live', 'human') and a.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
$$;

-- Abort a game (admin / per-game cost cap).
create or replace function public.abort_game(p_id uuid)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  update games set status = 'aborted', finished_at = now(), step_lease_until = null, version = version + 1
   where id = p_id and status in ('running', 'awaiting_input');
  return found;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'take_token(text, double precision, double precision)',
    'create_live_game(jsonb)',
    'claim_step(uuid, int, int)',
    'commit_step(uuid, int, jsonb)',
    'live_spend_today()',
    'abort_game(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
