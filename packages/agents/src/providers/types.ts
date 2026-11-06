/** A forced tool call: the model must answer by filling this JSON schema. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema (type: object). */
  schema: Record<string, unknown>;
}

export interface CompletionRequest {
  model: string;
  system: string;
  user: string;
  tool: ToolSpec;
  maxOutputTokens: number;
  /**
   * 'forced' (default) pins tool_choice to this tool. 'auto' is for models that reject forced tool use
   * (Claude Opus 5.5 / Sonnet 5.5 / Fable 5.1): tool_choice auto + an explicit instruction; validation still applies.
   */
  toolChoice?: 'forced' | 'auto';
  /** Reasoning effort for models that support it. */
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  /** The tool arguments the model produced. Untrusted — validate before use. */
  toolInput: unknown;
  usage: Usage;
  latencyMs: number;
  raw: unknown;
  /** Retries spent before this result (set by ReliableProvider). */
  retries?: number;
}

/** One adapter per provider (BRD §7.5). */
export interface Provider {
  readonly id: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}
