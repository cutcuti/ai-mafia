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
}

/** One adapter per provider (BRD §7.5). */
export interface Provider {
  readonly id: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}
