import type { AgentContext, InputRequest, InputResponse, Responder } from '@ai-mafia/engine';
import { PROMPT_VERSION, systemPrompt, userPrompt } from './prompts.js';
import type { ModelSpec } from './models.config.js';
import { costUsd, parseRequestId, type AgentCall } from './registry.js';
import type { CompletionResult, Provider } from './providers/types.js';
import { invalidResponse, toolFor } from './tools.js';

/** Anything that plays a seat (BRD §7.1). Structurally the engine's Responder. */
export interface Controller extends Responder {
  respond(ctx: AgentContext, req: InputRequest): Promise<InputResponse>;
}

export interface ModelControllerOptions {
  /** Provider model string, e.g. "claude-haiku-5-5". */
  model: string;
  /** Registry entry — enables cost accounting and call logs. */
  spec?: ModelSpec;
  /** Called once per provider call (BRD §7.7). */
  onCall?: (call: AgentCall) => void;
  /** Keep raw request/response in call logs (bench mode / LOG_RAW=1). */
  logRaw?: boolean;
  maxOutputTokens?: number;
  /** Extra attempts after an answer fails validation (BRD §7.4: one repair retry). */
  repairRetries?: number;
  toolChoice?: 'forced' | 'auto';
  effort?: 'low' | 'medium' | 'high';
}

/** LLM-backed seat: prompt → forced tool call on any Provider → zod-validated InputResponse. */
export class ModelController implements Controller {
  constructor(
    private readonly provider: Provider,
    private readonly opts: ModelControllerOptions,
  ) {}

  async respond(ctx: AgentContext, req: InputRequest): Promise<InputResponse> {
    const tool = toolFor(ctx, req);
    const system = systemPrompt(ctx);
    let user = userPrompt(ctx, req);
    let last: CompletionResult | undefined;
    let error = '';
    const attempts = (this.opts.repairRetries ?? 1) + 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const request = {
        model: this.opts.model,
        system,
        user,
        tool: tool.spec,
        maxOutputTokens: this.opts.maxOutputTokens ?? this.opts.spec?.maxOutputTokens ?? 600,
        toolChoice: this.opts.toolChoice ?? this.opts.spec?.toolChoice,
        effort: this.opts.effort ?? this.opts.spec?.effort,
      };
      try {
        last = await this.provider.complete(request);
      } catch (err) {
        this.log(req, undefined, true, { request, error: String((err as Error)?.message ?? err) });
        throw err; // drive() turns this into an engine fallback (I5)
      }
      const parsed = tool.parse(last.toolInput);
      const givingUp = !parsed.ok && attempt === attempts - 1;
      this.log(req, last, givingUp, { request, response: last.raw });
      if (parsed.ok) return parsed.response;
      error = parsed.error;
      user = `${userPrompt(ctx, req)}\n\nYour previous answer was invalid (${error}). Call the "${tool.spec.name}" tool again with valid arguments.`;
    }
    // Still invalid: hand the engine an empty answer; it falls back and logs the raw output (I5).
    const o = last?.toolInput as Record<string, unknown> | undefined;
    return invalidResponse(req, typeof o?.thought === 'string' ? o.thought : `(invalid output: ${error})`);
  }

  private log(req: InputRequest, res: CompletionResult | undefined, fallback: boolean, raw: unknown) {
    if (!this.opts.onCall) return;
    const { gameId, seq, seatId } = parseRequestId(req.id);
    const usage = res?.usage ?? { inputTokens: 0, outputTokens: 0 };
    this.opts.onCall({
      gameId,
      seq,
      seatId,
      modelId: this.opts.spec?.id ?? this.opts.model,
      promptVersion: PROMPT_VERSION,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: this.opts.spec ? costUsd(this.opts.spec, usage) : 0,
      latencyMs: res?.latencyMs ?? 0,
      retries: res?.retries ?? 0,
      fallback,
      ...(this.opts.logRaw ? { raw } : {}),
    });
  }
}
