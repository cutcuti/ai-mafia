import type { AgentContext, InputRequest, InputResponse, Responder } from '@ai-mafia/engine';
import { systemPrompt, userPrompt } from './prompts.js';
import type { CompletionResult, Provider } from './providers/types.js';
import { invalidResponse, toolFor } from './tools.js';

/** Anything that plays a seat (BRD §7.1). Structurally the engine's Responder. */
export interface Controller extends Responder {
  respond(ctx: AgentContext, req: InputRequest): Promise<InputResponse>;
}

export interface ModelControllerOptions {
  /** Provider model string, e.g. "claude-haiku-5-5". */
  model: string;
  maxOutputTokens?: number;
  /** Extra attempts after an answer fails validation (BRD §7.4: one repair retry). */
  repairRetries?: number;
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
    for (let attempt = 0; attempt <= (this.opts.repairRetries ?? 1); attempt++) {
      last = await this.provider.complete({
        model: this.opts.model,
        system,
        user,
        tool: tool.spec,
        maxOutputTokens: this.opts.maxOutputTokens ?? 600,
      });
      const parsed = tool.parse(last.toolInput);
      if (parsed.ok) return parsed.response;
      error = parsed.error;
      user = `${userPrompt(ctx, req)}\n\nYour previous answer was invalid (${error}). Call the "${tool.spec.name}" tool again with valid arguments.`;
    }
    // Still invalid: hand the engine an empty answer; it falls back and logs the raw output (I5).
    const o = last?.toolInput as Record<string, unknown> | undefined;
    return invalidResponse(req, typeof o?.thought === 'string' ? o.thought : `(invalid output: ${error})`);
  }
}
