/**
 * Model registry (BRD §7.5). Prices are USD per million tokens, filled manually:
 * Anthropic from the Claude API pricing table, everything else from OpenRouter's public /models list — both checked 2026-11-06.
 * Re-check before a benchmark run; cost numbers on the leaderboard are only as good as this file.
 */
export interface ModelSpec {
  id: string; // registry key
  provider: 'anthropic' | 'openai' | 'google' | 'openrouter';
  model: string; // provider model string
  displayName: string;
  pricing: { inputPerMTok: number; outputPerMTok: number };
  maxOutputTokens: number;
  enabled: boolean;
  /** Cheap enough for web-initiated live games (BRD §9.5). */
  webAllowed: boolean;
  /** 'auto' for models that reject forced tool use. Default 'forced'. */
  toolChoice?: 'forced' | 'auto';
  /** 'json' for models without reliable function calling (OpenAI-compatible only). */
  toolMode?: 'tool' | 'json';
  effort?: 'low' | 'medium' | 'high';
}

export const MODELS: ModelSpec[] = [
  // Anthropic. Thinking is on by default for all three, so leave room in max tokens; Haiku 5.5's price is the ≤100K-prompt tier.
  { id: 'claude-haiku', provider: 'anthropic', model: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5', pricing: { inputPerMTok: 0.1, outputPerMTok: 0.5 }, maxOutputTokens: 2000, enabled: true, webAllowed: true, effort: 'low' },
  { id: 'claude-sonnet', provider: 'anthropic', model: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', pricing: { inputPerMTok: 2, outputPerMTok: 10 }, maxOutputTokens: 4000, enabled: true, webAllowed: true, toolChoice: 'auto', effort: 'low' },
  { id: 'claude-opus', provider: 'anthropic', model: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', pricing: { inputPerMTok: 4, outputPerMTok: 20 }, maxOutputTokens: 4000, enabled: true, webAllowed: false, toolChoice: 'auto', effort: 'low' },
  // OpenAI direct
  { id: 'gpt-mini', provider: 'openrouter', model: 'openai/gpt-5.4-mini', displayName: 'GPT-5.4 mini', pricing: { inputPerMTok: 0.75, outputPerMTok: 4.5 }, maxOutputTokens: 2000, enabled: true, webAllowed: false },
  { id: 'gpt-nano', provider: 'openrouter', model: 'openai/gpt-5.4-nano', displayName: 'GPT-5.4 nano', pricing: { inputPerMTok: 0.2, outputPerMTok: 1.25 }, maxOutputTokens: 2000, enabled: true, webAllowed: true },
  // Open / other models via OpenRouter
  { id: 'llama-70b', provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B', pricing: { inputPerMTok: 0.59, outputPerMTok: 0.79 }, maxOutputTokens: 800, enabled: true, webAllowed: true },
  { id: 'deepseek-v3', provider: 'openrouter', model: 'deepseek/deepseek-chat-v3.1', displayName: 'DeepSeek V3.1', pricing: { inputPerMTok: 0.25, outputPerMTok: 0.95 }, maxOutputTokens: 800, enabled: true, webAllowed: true },
  { id: 'qwen3-235b', provider: 'openrouter', model: 'qwen/qwen3-235b-a22b-2507', displayName: 'Qwen3 235B', pricing: { inputPerMTok: 0.14, outputPerMTok: 0.8 }, maxOutputTokens: 800, enabled: true, webAllowed: true },
  { id: 'gemini-flash', provider: 'openrouter', model: 'google/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', pricing: { inputPerMTok: 0.825, outputPerMTok: 4.125 }, maxOutputTokens: 2000, enabled: true, webAllowed: false },
];
