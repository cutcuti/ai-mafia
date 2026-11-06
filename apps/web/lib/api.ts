import { authorizeView, cacheControl, eventsForViewer, gameMeta, type Caller } from './views';
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
