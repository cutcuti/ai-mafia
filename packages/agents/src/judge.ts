import { z } from 'zod';
import type { GameEvent, Role } from '@ai-mafia/engine';
import { escapeSpeech } from './render.ts';
import type { Provider } from './providers/types.ts';
import type { ModelSpec } from './models.config.ts';
import { costUsd } from './registry.ts';

/** BRD §10.6 award kinds. */
export const AWARD_KINDS = ['best_liar', 'sharpest_read', 'biggest_fumble', 'mvp'] as const;
export type AwardKind = (typeof AWARD_KINDS)[number];

export interface Award {
  kind: AwardKind;
  seatId: string;
  /** The moment it's about (null only for MVP). */
  seq: number | null;
  title: string;
  blurb: string;
}

export interface JudgeSeat {
  id: string;
  name: string;
  role: Role;
}

export const JUDGE_VERSION = 'j1';

const SYSTEM = `You are the host of a chaotic, funny Mafia game show where every player is an AI model. After each game you hand out awards.
Tone: playful, Gen Z, punchy. Roast the AI players freely. Never mention or mock real people, groups, or anything outside this game. No slurs, nothing hateful.
Awards (use each kind at most once, skip one if nothing fits):
- best_liar: the mafia player whose lie was the most shameless or effective. Point at the exact message.
- sharpest_read: the town player whose read, accusation or vote was spot on. Point at the exact message or vote.
- biggest_fumble: the worst blunder (a misvote, a self-own, a bad claim). Point at the exact moment.
- mvp: the player who carried the game (seq may be null).
Titles: max 5 words. Blurbs: one sentence, max 140 characters, refer to the player by name. Use the [#seq] numbers from the log.`;

/** The full spectator log as the judge sees it: roles known, thoughts included, every line numbered. */
export function judgeTranscript(events: readonly GameEvent[], seats: readonly JudgeSeat[]): string {
  const name = (id?: string) => seats.find((s) => s.id === id)?.name ?? '?';
  const roster = seats.map((s) => `${s.name} (${s.role})`).join(', ');
  const lines = events
    .filter((e) => !['role_reveal', 'team_reveal', 'fallback', 'notes', 'game_start'].includes(e.type))
    .map((e) => {
      const who = name(e.actorSeatId);
      switch (e.type) {
        case 'speech':
          return `[#${e.seq}] ${who} says: <speech>${escapeSpeech(e.text)}</speech>${e.payload?.claimRole ? ` (claims ${e.payload.claimRole})` : ''}`;
        case 'mafia_chat':
          return `[#${e.seq}] ${who} (mafia channel): <speech>${escapeSpeech(e.text)}</speech>`;
        case 'thought':
          return `[#${e.seq}]   ${who} privately thinks: ${escapeSpeech(e.text)}`;
        default:
          return `[#${e.seq}] ${e.text}`;
      }
    });
  return `Players and their true roles: ${roster}\n\n${lines.join('\n')}`;
}

const TOOL = {
  name: 'give_awards',
  description: 'Hand out the post-game awards.',
  schema: {
    type: 'object',
    properties: {
      awards: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...AWARD_KINDS] },
            player: { type: 'string', description: 'Player name' },
            seq: { type: ['integer', 'null'], description: 'The [#seq] of the moment' },
            title: { type: 'string' },
            blurb: { type: 'string' },
          },
          required: ['kind', 'player', 'title', 'blurb'],
        },
      },
    },
    required: ['awards'],
  },
};

const raw = z.object({
  awards: z
    .array(
      z.object({
        kind: z.enum(AWARD_KINDS),
        player: z.string(),
        seq: z.number().int().nullable().optional(),
        title: z.string().min(1),
        blurb: z.string().min(1),
      }),
    )
    .max(8),
});

/**
 * Validate the judge's output against the actual game (BRD §10.6): known players, existing seqs, one award per kind,
 * best_liar must be mafia and sharpest_read town, lengths capped. Invalid entries are dropped, never "fixed".
 */
export function validateAwards(input: unknown, events: readonly GameEvent[], seats: readonly JudgeSeat[]): Award[] {
  const parsed = raw.safeParse(input);
  if (!parsed.success) return [];
  const seqs = new Set(events.map((e) => e.seq));
  const out: Award[] = [];
  for (const a of parsed.data.awards) {
    const seat = seats.find((s) => s.name.toLowerCase() === a.player.trim().toLowerCase());
    if (!seat || out.some((x) => x.kind === a.kind)) continue;
    if (a.kind === 'best_liar' && seat.role !== 'mafia') continue;
    if (a.kind === 'sharpest_read' && seat.role === 'mafia') continue;
    const seq = a.seq ?? null;
    if (seq !== null && !seqs.has(seq)) continue;
    if (seq === null && a.kind !== 'mvp') continue;
    out.push({ kind: a.kind, seatId: seat.id, seq, title: a.title.trim().slice(0, 48), blurb: a.blurb.trim().slice(0, 180) });
  }
  return out.sort((x, y) => AWARD_KINDS.indexOf(x.kind) - AWARD_KINDS.indexOf(y.kind));
}

/** One judge call. Never throws: any failure means "no awards" (BRD: never block the game). */
export async function judgeGame(
  provider: Provider,
  spec: ModelSpec,
  events: readonly GameEvent[],
  seats: readonly JudgeSeat[],
): Promise<{ awards: Award[]; costUsd: number; error?: string }> {
  try {
    const res = await provider.complete({
      model: spec.model,
      system: SYSTEM,
      user: `${judgeTranscript(events, seats)}\n\nHand out the awards now.`,
      tool: TOOL,
      maxOutputTokens: spec.maxOutputTokens,
      toolChoice: spec.toolChoice,
      effort: spec.effort,
    });
    return { awards: validateAwards(res.toolInput, events, seats), costUsd: costUsd(spec, res.usage) };
  } catch (e) {
    return { awards: [], costUsd: 0, error: (e as Error).message };
  }
}
