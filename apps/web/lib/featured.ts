import type { FeaturedLine, FeaturedReplayProps } from '@/components/FeaturedReplay';
import { modelName, rosterFrom } from './roster';
import type { GameStore } from './types';
import { eventsForViewer, gameMeta } from './views';

const MAX_LINES = 40;

/**
 * The landing page's featured replay: FEATURED_GAME_ID if set, else the most recent finished game the judge
 * gave a Best Liar award (a juicy one), else the most recent game. Public view only; stops before the reveal.
 */
export async function featuredReplay(store: GameStore, env: Record<string, string | undefined> = process.env): Promise<FeaturedReplayProps | null> {
  const { games } = await store.listGames({ limit: 12 });
  let id = env.FEATURED_GAME_ID && (await store.getGame(env.FEATURED_GAME_ID)) ? env.FEATURED_GAME_ID : undefined;
  for (const g of games) {
    if (id) break;
    if ((await store.getHighlights(g.id)).some((h) => h.kind === 'best_liar')) id = g.id;
  }
  id ??= games[0]?.id;
  if (!id) return null;
  const g = await store.getGame(id);
  if (!g) return null;
  const events = eventsForViewer(await store.getEvents(id), { kind: 'public' });
  const meta = gameMeta(g, { kind: 'public' });
  const lines: FeaturedLine[] = [];
  for (const e of events) {
    if (e.type === 'game_over' || lines.length >= MAX_LINES) break;
    if (e.type === 'speech' && e.actorSeatId) lines.push({ seq: e.seq, kind: 'speech', seatId: e.actorSeatId, text: e.text });
    else if (e.type === 'phase') lines.push({ seq: e.seq, kind: 'banner', text: e.text });
    else if (e.type === 'death' || e.type === 'eliminated') lines.push({ seq: e.seq, kind: 'system', text: e.text });
  }
  if (!lines.some((l) => l.kind === 'speech')) return null;
  return {
    gameId: id,
    title: meta.models.map(modelName).join(' vs '),
    seats: rosterFrom(meta.seats, events).map((s) => ({ seatId: s.seatId, name: s.name, avatarSeed: s.avatarSeed })),
    lines,
  };
}
