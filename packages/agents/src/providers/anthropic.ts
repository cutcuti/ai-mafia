import Anthropic from '@anthropic-ai/sdk';
import type { CompletionRequest, CompletionResult, Provider } from './types.ts';

/** Minimal slice of the SDK client we use — lets tests inject a fixture-backed fake. */
export type AnthropicLike = Pick<Anthropic, 'messages'>;

/** Anthropic Messages API with a forced (or, where the model requires it, auto) tool call (BRD §7.4). SDK retries are off: ours (§7.6) handle it. */
export class AnthropicProvider implements Provider {
  readonly id = 'anthropic';
  private readonly client: AnthropicLike;

  constructor(client?: AnthropicLike) {
    this.client = client ?? new Anthropic({ maxRetries: 0 });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const auto = req.toolChoice === 'auto';
    const t0 = performance.now();
    const res = await this.client.messages.create(
      {
        model: req.model,
        max_tokens: req.maxOutputTokens,
        system: auto ? `${req.system}\n\nAlways answer by calling the "${req.tool.name}" tool exactly once. Do not reply with plain text.` : req.system,
        messages: [{ role: 'user', content: req.user }],
        tools: [{ name: req.tool.name, description: req.tool.description, input_schema: req.tool.schema as Anthropic.Tool.InputSchema }],
        tool_choice: auto ? { type: 'auto' } : { type: 'tool', name: req.tool.name },
        ...(req.effort ? { output_config: { effort: req.effort } } : {}),
      },
      { signal: req.signal },
    );
    const latencyMs = Math.round(performance.now() - t0);
    const block = res.content.find((b) => b.type === 'tool_use');
    return {
      toolInput: block && block.type === 'tool_use' ? block.input : undefined,
      usage: { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 },
      latencyMs,
      raw: res,
    };
  }
}
