import type { Highlight } from '@ai-mafia/agents';
import { modelName } from './roster';
import type { GameStore } from './types';
import { eventsForViewer, highlightsFor } from './views';

/** Text for share cards. Built only from the PUBLIC view (I3): link previews are seen by anyone. */
export interface OgGame {
  title: string;
  outcome: 'town' | 'mafia' | 'draw' | null;
  players: { seatId: string; name: string; model: string | null; mafia: boolean | null }[];
  award: Highlight | null;
}

export interface OgMoment {
  speaker: string;
  seatId: string;
  text: string;
  context: string;
  model: string | null;
  award: Highlight | null;
}

export async function ogGame(store: GameStore, id: string): Promise<OgGame | null> {
  const g = await store.getGame(id);
  if (!g) return null;
  const done = g.status === 'finished';
  const awards = highlightsFor(g, done ? await store.getHighlights(id) : []);
  return {
    title: [...new Set(g.seats.map((s) => (s.controller.kind === 'model' ? modelName(s.controller.modelId) : s.controller.kind === 'human' ? 'a human' : 'random')))].join(' vs '),
    outcome: done ? g.outcome : null,
    players: g.seats.map((s) => ({
      seatId: s.seatId,
      name: s.name,
      // roles and models are public only once it's over
      model: done ? (s.controller.kind === 'model' ? modelName(s.controller.modelId) : s.controller.kind) : null,
      mafia: done ? s.role === 'mafia' : null,
    })),
    award: awards.find((a) => a.kind === 'best_liar') ?? awards[0] ?? null,
  };
}

export async function ogMoment(store: GameStore, id: string, seq: number): Promise<OgMoment | null> {
  const g = await store.getGame(id);
  if (!g || !Number.isInteger(seq)) return null;
  const e = eventsForViewer(await store.getEvents(id), { kind: 'public' }).find((x) => x.seq === seq);
  if (!e || e.type !== 'speech' || !e.actorSeatId) return null;
  const seat = g.seats.find((s) => s.seatId === e.actorSeatId);
  if (!seat) return null;
  const done = g.status === 'finished';
  const award = highlightsFor(g, done ? await store.getHighlights(id) : []).find((a) => a.seq === seq) ?? null;
  return {
    speaker: seat.name,
    seatId: seat.seatId,
    text: e.text.length > 260 ? `${e.text.slice(0, 257)}…` : e.text,
    context: `Day ${e.day}`,
    model: done && seat.controller.kind === 'model' ? modelName(seat.controller.modelId) : null,
    award,
  };
}
