import { buildLeaderboard, h2hSummary, modelProfile } from './leaderboard';
import { authorizeView, cacheControl, eventsForViewer, gameMeta, type Caller, highlightsFor } from './views';

/** Aggregates over finished games change only on rebuild: cache at the edge, revalidate in the background. */
const PUBLIC_AGGREGATE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600';

/** GET /api/leaderboard?scope=&preset=&promptVersion= */
export async function leaderboardResponse(store: GameStore, url: URL): Promise<Response> {
  const lb = buildLeaderboard(await store.getLeaderboard(), {
    scope: url.searchParams.get('scope'),
    preset: url.searchParams.get('preset'),
    promptVersion: url.searchParams.get('promptVersion'),
  });
  return json(lb, 200, { 'cache-control': PUBLIC_AGGREGATE });
}

/** GET /api/models/:id — ratings, stats and recent games for one model. */
export async function modelResponse(store: GameStore, id: string): Promise<Response> {
  const profile = modelProfile(await store.getLeaderboard(), id);
  if (!profile) return error(404, 'model not found');
  const { games } = await store.listGames({ limit: 10, model: id });
  return json({ ...profile, recentGames: games }, 200, { 'cache-control': PUBLIC_AGGREGATE });
}

/** GET /api/h2h/:a/:b?preset=&promptVersion= — both directions + self-play baselines. */
export async function h2hResponse(store: GameStore, a: string, b: string, url: URL): Promise<Response> {
  if (a === b) return error(400, 'pick two different models');
  const summary = h2hSummary(await store.listPairGames(), a, b, url.searchParams.get('preset') ?? 'classic6', url.searchParams.get('promptVersion'));
  return json(summary, 200, { 'cache-control': PUBLIC_AGGREGATE });
}
import type { GameStore } from './types';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const error = (status: number, message: string) => json({ error: message }, status, { 'cache-control': 'no-store' });

/** GET /api/games?mode=&model=&cursor=&limit= — finished games, newest first. */
export async function listGamesResponse(store: GameStore, url: URL): Promise<Response> {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20) || 20, 1), 50);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  if (cursor && Number.isNaN(Date.parse(cursor))) return error(400, 'bad cursor');
  const res = await store.listGames({
    limit,
    before: cursor,
    mode: url.searchParams.get('mode') ?? undefined,
    model: url.searchParams.get('model') ?? undefined,
  });
  return json(res, 200, { 'cache-control': 'public, max-age=30, s-maxage=60' });
}

/** GET /api/games/:id?view= — meta + seats, with roles only where allowed. */
export async function gameResponse(store: GameStore, id: string, url: URL, caller: Caller): Promise<Response> {
  const g = await store.getGame(id);
  if (!g) return error(404, 'game not found');
  const d = authorizeView(g, url.searchParams.get('view'), caller);
  if (!d.ok) return error(d.status, d.error);
  return json(gameMeta(g, d.viewer), 200, { 'cache-control': cacheControl(g, d.view) });
}

/** GET /api/games/:id/highlights — judged awards; empty until the game is finished (they name the mafia). */
export async function highlightsResponse(store: GameStore, id: string): Promise<Response> {
  const g = await store.getGame(id);
  if (!g) return error(404, 'game not found');
  const highlights = highlightsFor(g, await store.getHighlights(id));
  // finished + judged: cache; otherwise the judge may still be running
  return json({ highlights }, 200, { 'cache-control': highlights.length ? cacheControl(g, 'public') : 'private, no-store' });
}

/** GET /api/games/:id/events?view=&after= — filtered server-side (I3). */
export async function eventsResponse(store: GameStore, id: string, url: URL, caller: Caller): Promise<Response> {
  const afterRaw = url.searchParams.get('after');
  const after = afterRaw === null ? undefined : Number(afterRaw);
  if (after !== undefined && !Number.isInteger(after)) return error(400, 'after must be an integer seq');
  const g = await store.getGame(id);
  if (!g) return error(404, 'game not found');
  const d = authorizeView(g, url.searchParams.get('view'), caller);
  if (!d.ok) return error(d.status, d.error);
  const events = eventsForViewer(await store.getEvents(id), d.viewer, after);
  return json({ view: d.view, events }, 200, { 'cache-control': cacheControl(g, d.view) });
}
