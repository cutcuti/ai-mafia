import OpenAI from 'openai';
import type { CompletionRequest, CompletionResult, Provider } from './types.js';

/** Minimal slice of the SDK client we use — lets tests inject a fixture-backed fake. */
export type OpenAILike = { chat: { completions: Pick<OpenAI['chat']['completions'], 'create'> } };

export interface OpenAICompatOptions {
  /** Registry provider id: 'openai' | 'openrouter' | … */
  id: string;
  apiKey?: string;
  baseURL?: string;
  /** 'tool' = forced function call (default). 'json' = JSON mode for models without forced tool calls (BRD §7.4). */
  toolMode?: 'tool' | 'json';
  /** Newer OpenAI models need max_completion_tokens; many OpenRouter models still expect max_tokens. */
  maxTokensParam?: 'max_completion_tokens' | 'max_tokens';
  client?: OpenAILike;
}

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Parse a JSON string the model produced; undefined (→ validation error → repair retry) if it isn't JSON. */
function parseJson(s: string | null | undefined): unknown {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    // tolerate ```json fences
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) return undefined;
    try {
      return JSON.parse(m[0]);
    } catch {
      return undefined;
    }
  }
}

/** OpenAI Chat Completions — works for OpenAI itself and any OpenAI-compatible endpoint (OpenRouter). */
export class OpenAICompatProvider implements Provider {
  readonly id: string;
  private readonly client: OpenAILike;
  private readonly toolMode: 'tool' | 'json';
  private readonly maxTokensParam: 'max_completion_tokens' | 'max_tokens';

  constructor(o: OpenAICompatOptions) {
    this.id = o.id;
    this.client = o.client ?? new OpenAI({ apiKey: o.apiKey, baseURL: o.baseURL, maxRetries: 0 });
    this.toolMode = o.toolMode ?? 'tool';
    this.maxTokensParam = o.maxTokensParam ?? 'max_completion_tokens';
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const json = this.toolMode === 'json';
    const system = json
      ? `${req.system}\n\nRespond with ONLY a JSON object (no prose, no code fences) matching this JSON Schema for "${req.tool.name}" (${req.tool.description}):\n${JSON.stringify(req.tool.schema)}`
      : req.system;
    const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: req.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: req.user },
      ],
      [this.maxTokensParam]: req.maxOutputTokens,
      ...(json
        ? { response_format: { type: 'json_object' as const } }
        : {
            tools: [{ type: 'function' as const, function: { name: req.tool.name, description: req.tool.description, parameters: req.tool.schema } }],
            tool_choice: { type: 'function' as const, function: { name: req.tool.name } },
          }),
    };
    const t0 = performance.now();
    const res = await this.client.chat.completions.create(body, { signal: req.signal });
    const latencyMs = Math.round(performance.now() - t0);
    const msg = res.choices?.[0]?.message;
    const call = msg?.tool_calls?.find((c) => c.type === 'function');
    const toolInput = json ? parseJson(msg?.content) : call && call.type === 'function' ? parseJson(call.function.arguments) : undefined;
    return {
      toolInput,
      usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
      latencyMs,
      raw: res,
    };
  }
}

export const openaiProvider = (o: Partial<OpenAICompatOptions> = {}) =>
  new OpenAICompatProvider({ id: 'openai', apiKey: process.env.OPENAI_API_KEY, ...o });

export const openrouterProvider = (o: Partial<OpenAICompatOptions> = {}) =>
  new OpenAICompatProvider({ id: 'openrouter', apiKey: process.env.OPENROUTER_API_KEY, baseURL: OPENROUTER_BASE_URL, maxTokensParam: 'max_tokens', ...o });
