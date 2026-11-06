-- Leaderboard aggregates (BRD §8.3/§8.5): per-model metrics + Wilson CIs, recomputed from scratch by
-- `pnpm ratings:rebuild -- --db` together with `ratings`. Aggregates over finished games only, so public-readable.

create table public.model_stats (
  model_id text not null references public.models,
  prompt_version text not null,
  preset text not null,
  games int not null,
  stats jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (model_id, prompt_version, preset)
);

alter table public.model_stats enable row level security;
create policy model_stats_public_read on public.model_stats for select to anon, authenticated using (true);
grant select on public.model_stats to anon, authenticated;
grant all on public.model_stats to service_role;
revoke insert, update, delete on public.model_stats from anon, authenticated;

-- Swap ratings and stats together so the leaderboard is never half-updated.
create or replace function public.replace_leaderboard(p_ratings jsonb, p_stats jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  nr int;
  ns int;
begin
  delete from ratings where true;
  delete from model_stats where true;
  insert into ratings (model_id, scope, prompt_version, preset, mu, sigma, ordinal, games, updated_at)
  select r.model_id, r.scope, r.prompt_version, r.preset, r.mu, r.sigma, r.ordinal, r.games, now()
  from jsonb_to_recordset(coalesce(p_ratings, '[]'::jsonb))
    as r(model_id text, scope text, prompt_version text, preset text, mu double precision,
         sigma double precision, ordinal double precision, games int);
  get diagnostics nr = row_count;
  insert into model_stats (model_id, prompt_version, preset, games, stats, updated_at)
  select s.model_id, s.prompt_version, s.preset, s.games, s.stats, now()
  from jsonb_to_recordset(coalesce(p_stats, '[]'::jsonb))
    as s(model_id text, prompt_version text, preset text, games int, stats jsonb);
  get diagnostics ns = row_count;
  return jsonb_build_object('ratings', nr, 'stats', ns);
end;
$$;

revoke all on function public.replace_leaderboard(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_leaderboard(jsonb, jsonb) to service_role;
