import { ModelController } from './controller.ts';
import { MODELS, type ModelSpec } from './models.config.ts';
import { AnthropicProvider } from './providers/anthropic.ts';
import { OPENROUTER_BASE_URL, OpenAICompatProvider } from './providers/openai.ts';
import type { Provider } from './providers/types.ts';
import { getModel, type AgentCall } from './registry.ts';
import { ReliableProvider, limiterFor, type ReliabilityOptions } from './reliability.ts';

export interface FactoryOptions {
  models?: readonly ModelSpec[];
  onCall?: (c: AgentCall) => void;
  logRaw?: boolean;
  reliability?: ReliabilityOptions;
  /** Per-provider concurrency (BRD §7.6). */
  concurrency?: number;
  /** Override provider construction (tests). */
  makeProvider?: (spec: ModelSpec) => Provider;
}

/** Build the raw adapter for a registry entry. Keys come from the environment, server-side only. */
export function defaultProvider(spec: ModelSpec): Provider {
  switch (spec.provider) {
    case 'anthropic':
      return new AnthropicProvider();
    case 'openai':
      return new OpenAICompatProvider({ id: 'openai', apiKey: process.env.OPENAI_API_KEY, toolMode: spec.toolMode });
    case 'openrouter':
      return new OpenAICompatProvider({
        id: 'openrouter',
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: OPENROUTER_BASE_URL,
        maxTokensParam: 'max_tokens',
        toolMode: spec.toolMode,
      });
    case 'google':
      throw new Error(`google adapter not implemented yet — route ${spec.id} through openrouter`);
  }
}

/** Registry id → ready-to-play ModelController with retries, timeout, limiter and cost logging. */
export function createModelController(modelId: string, o: FactoryOptions = {}): ModelController {
  const spec = getModel(modelId, o.models ?? MODELS);
  const raw = (o.makeProvider ?? defaultProvider)(spec);
  const provider = new ReliableProvider(raw, { limiter: limiterFor(spec.provider, o.concurrency ?? 4), ...o.reliability });
  return new ModelController(provider, { model: spec.model, spec, onCall: o.onCall, logRaw: o.logRaw });
}
