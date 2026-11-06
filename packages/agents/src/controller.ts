import type { AgentContext, InputRequest, InputResponse, Responder } from '@ai-mafia/engine';
import { systemPrompt, userPrompt } from './prompts.js';
import type { Provider, ToolSpec } from './providers/types.js';

/** Anything that plays a seat (BRD §7.1). Structurally the engine's Responder. */
export interface Controller extends Responder {
  respond(ctx: AgentContext, req: InputRequest): Promise<InputResponse>;
}

export interface ModelControllerOptions {
  /** Provider model string, e.g. "claude-haiku-5-5". */
  model: string;
  maxOutputTokens?: number;
}

/** Tool for the current request. Agents see names, never seat ids. */
export function toolFor(ctx: AgentContext, req: InputRequest): ToolSpec {
  if (req.kind === 'speak') {
    return {
      name: 'speak',
      description: req.channel === 'mafia' ? 'Talk privately to your mafia teammate(s).' : 'Say something to the whole table.',
      schema: {
        type: 'object',
        properties: {
          thought: { type: 'string', description: 'Private reasoning. Never shown to other players.' },
          speech: { type: 'string', description: `What you actually say out loud (max ${req.maxChars} characters).` },
        },
        required: ['thought', 'speech'],
      },
    };
  }
  const toName = new Map(ctx.roster.map((r) => [r.seatId, r.name]));
  return {
    name: req.action,
    description: `Pick a target for: ${req.action}.`,
    schema: {
      type: 'object',
      properties: {
        thought: { type: 'string', description: 'Private reasoning for your choice.' },
        target: { type: 'string', enum: req.options.map((id) => toName.get(id) ?? id) },
      },
      required: ['thought', 'target'],
    },
  };
}

/** Map a model's tool input back to an engine response (names → seat ids). Unknown names become '' so the engine falls back. */
export function toResponse(ctx: AgentContext, req: InputRequest, input: unknown): InputResponse {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const thought = typeof o.thought === 'string' ? o.thought : '';
  if (req.kind === 'speak') return { kind: 'speak', thought, speech: typeof o.speech === 'string' ? o.speech : '' };
  const toId = new Map(ctx.roster.map((r) => [r.name, r.seatId]));
  return { kind: 'choose', thought, target: toId.get(String(o.target)) ?? '' };
}

/** LLM-backed seat: prompt → forced tool call on any Provider → validated InputResponse. */
export class ModelController implements Controller {
  constructor(
    private readonly provider: Provider,
    private readonly opts: ModelControllerOptions,
  ) {}

  async respond(ctx: AgentContext, req: InputRequest): Promise<InputResponse> {
    const res = await this.provider.complete({
      model: this.opts.model,
      system: systemPrompt(ctx),
      user: userPrompt(ctx, req),
      tool: toolFor(ctx, req),
      maxOutputTokens: this.opts.maxOutputTokens ?? 600,
    });
    return toResponse(ctx, req, res.toolInput);
  }
}
