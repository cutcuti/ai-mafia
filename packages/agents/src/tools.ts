import { z } from 'zod';
import type { AgentContext, InputRequest, InputResponse, Role } from '@ai-mafia/engine';
import type { ToolSpec } from './providers/types.js';

const ROLES = ['mafia', 'detective', 'doctor', 'villager'] as const satisfies readonly Role[];

/** Tool shown to the model and the zod schema its answer must pass. Agents see names; ids are mapped in `parse`. */
export interface RequestTool {
  spec: ToolSpec;
  /** Validate untrusted tool input → engine response, or a readable error for the repair retry. */
  parse(input: unknown): { ok: true; response: InputResponse } | { ok: false; error: string };
}

/** Optional enum that silently drops invalid values instead of failing the whole answer. */
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).optional().catch(undefined);

function format(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export function toolFor(ctx: AgentContext, req: InputRequest): RequestTool {
  const toName = new Map(ctx.roster.map((r) => [r.seatId, r.name]));
  const toId = new Map(ctx.roster.map((r) => [r.name, r.seatId]));

  if (req.kind === 'notes') {
    const schema = z.object({ notes: z.string().trim().min(1, 'notes must not be empty') });
    return {
      spec: {
        name: 'write_notes',
        description: 'Write private notes for your future self. Only you will ever see them.',
        schema: {
          type: 'object',
          properties: { notes: { type: 'string', description: `Your notes, at most ${req.maxWords} words.` } },
          required: ['notes'],
        },
      },
      parse(input) {
        const r = schema.safeParse(input);
        return r.success ? { ok: true, response: { kind: 'notes', notes: r.data.notes } } : { ok: false, error: format(r.error) };
      },
    };
  }

  if (req.kind === 'speak') {
    const others = ctx.alive.filter((n) => n !== ctx.self.name);
    const accusable = (others.length ? others : ['nobody']) as [string, ...string[]];
    const schema = z.object({
      thought: z.string(),
      speech: z.string().trim().min(1, 'speech must not be empty'),
      accuses: optionalEnum(accusable),
      claimRole: optionalEnum(ROLES),
    });
    return {
      spec: {
        name: 'speak',
        description: req.channel === 'mafia' ? 'Talk privately to your mafia teammate(s).' : 'Say something to the whole table.',
        schema: {
          type: 'object',
          properties: {
            thought: { type: 'string', description: 'Private reasoning. Never shown to other players.' },
            speech: { type: 'string', description: `What you actually say (1–3 sentences, max ${req.maxChars} characters).` },
            accuses: {
              type: 'string',
              enum: accusable,
              description:
                req.channel === 'mafia'
                  ? 'Optional: the player you suggest killing tonight.'
                  : 'Optional: the player your speech points suspicion at, if any.',
            },
            claimRole: {
              type: 'string',
              enum: [...ROLES],
              description: 'Optional: the role you publicly claim in this speech, if you claim one (true or not).',
            },
          },
          required: ['thought', 'speech'],
        },
      },
      parse(input) {
        const r = schema.safeParse(input);
        if (!r.success) return { ok: false, error: format(r.error) };
        const { thought, speech, accuses, claimRole } = r.data;
        const res: Extract<InputResponse, { kind: 'speak' }> = { kind: 'speak', thought, speech };
        const accusedId = accuses ? toId.get(accuses) : undefined;
        if (accusedId) res.accuses = accusedId;
        if (claimRole) res.claimRole = claimRole;
        return { ok: true, response: res };
      },
    };
  }

  const names = req.options.map((id) => toName.get(id) ?? id) as [string, ...string[]];
  const schema = z.object({ thought: z.string(), target: z.enum(names) });
  return {
    spec: {
      name: req.action,
      description: `Pick a target for: ${req.action}.`,
      schema: {
        type: 'object',
        properties: {
          thought: { type: 'string', description: 'Private reasoning for your choice.' },
          target: { type: 'string', enum: names },
        },
        required: ['thought', 'target'],
      },
    },
    parse(input) {
      const r = schema.safeParse(input);
      if (!r.success) return { ok: false, error: format(r.error) };
      return { ok: true, response: { kind: 'choose', thought: r.data.thought, target: toId.get(r.data.target) ?? '' } };
    },
  };
}

/** What the engine gets when a model never produced a valid answer: empty fields, so the engine's seeded fallback kicks in (I5). */
export function invalidResponse(req: InputRequest, thought: string): InputResponse {
  if (req.kind === 'notes') return { kind: 'notes', notes: '' };
  return req.kind === 'speak' ? { kind: 'speak', thought, speech: '' } : { kind: 'choose', thought, target: '' };
}
