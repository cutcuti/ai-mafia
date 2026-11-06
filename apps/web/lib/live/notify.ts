/**
 * Supabase Realtime broadcast over REST: tells viewers "the log now reaches seq N" on topic game:<id>.
 * Only the number is sent — clients fetch filtered events from the API (I3: never broadcast event bodies).
 */
export function realtimeNotifier(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return async (gameId: string, seq: number) => {
    if (!url || !key) return;
    await fetchImpl(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: `game:${gameId}`, event: 'seq', payload: { seq } }] }),
      signal: AbortSignal.timeout(3000),
    });
  };
}
