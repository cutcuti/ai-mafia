-- M8: post-game judge awards. Denormalised so model profiles can list "best moments" without joins.
alter table public.highlights
  add column if not exists seat_id text,
  add column if not exists seat_name text,
  add column if not exists model_id text,
  add column if not exists quote text,
  add column if not exists judge_version text;
create index if not exists highlights_model_idx on public.highlights (model_id);

-- Replace a finished game's awards atomically. Server-only (service role); refuses unfinished games,
-- because awards reveal roles (I3: hidden info only after the game ends).
create or replace function public.save_highlights(p_game uuid, p jsonb)
returns int
language plpgsql
set search_path = public
as $$
declare n int;
begin
  if not exists (select 1 from games where id = p_game and status = 'finished') then
    raise exception 'game % is not finished', p_game;
  end if;
  delete from highlights where game_id = p_game;
  insert into highlights (game_id, rank, seq, kind, title, blurb, seat_id, seat_name, model_id, quote, judge_version)
  select p_game, (ord - 1)::int, (h->>'seq')::int, h->>'kind', h->>'title', h->>'blurb',
         h->>'seat_id', h->>'seat_name', h->>'model_id', h->>'quote', h->>'judge_version'
  from jsonb_array_elements(p) with ordinality as t(h, ord);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.save_highlights(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_highlights(uuid, jsonb) to service_role;
