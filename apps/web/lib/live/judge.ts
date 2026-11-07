import { dryRunAwards, judgeGame, toHighlights, type Award, type JudgeSeat, type Provider, type ModelSpec } from '@ai-mafia/agents';
import type { GameEvent, GameState } from '@ai-mafia/engine';
import type { LiveStore } from './types';

export type Judge = (events: readonly GameEvent[], seats: readonly JudgeSeat[]) => Promise<{ awards: Award[]; error?: string }>;

export const modelJudge = (provider: Provider, spec: ModelSpec): Judge => (events, seats) => judgeGame(provider, spec, events, seats);
export const dryRunJudge: Judge = async (events, seats) => ({ awards: dryRunAwards(events, seats) });

/** After a live game ends: judge it and store the awards. Best effort — never throws (a game without awards is fine). */
export async function judgeFinishedGame(store: LiveStore, id: string, state: GameState, judge: Judge): Promise<number> {
  if (state.status !== 'finished') return 0;
  try {
    const seats = state.seats.map((s) => ({ id: s.id, name: s.name, role: s.role, modelId: s.controller.kind === 'model' ? s.controller.modelId : s.controller.kind }));
    const { awards } = await judge(state.events, seats);
    await store.saveHighlights(id, toHighlights(awards, state.events, seats));
    return awards.length;
  } catch {
    return 0;
  }
}
