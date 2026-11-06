import type { LiveStore, SessionUser } from './types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** POST /api/admin/games/:id/abort — allowlisted admins only. */
export async function abortResponse(store: LiveStore, id: string, user: SessionUser | null, admin: boolean): Promise<Response> {
  if (!user) return json({ error: 'sign in first' }, 401);
  if (!admin) return json({ error: 'admins only' }, 403);
  const ok = await store.abort(id);
  return json({ aborted: ok }, ok ? 200 : 409);
}
