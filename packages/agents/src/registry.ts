import { MODELS, type ModelSpec } from './models.config.js';
import type { Usage } from './providers/types.js';

export function getModel(id: string, models: readonly ModelSpec[] = MODELS): ModelSpec {
  const m = models.find((x) => x.id === id);
  if (!m) throw new Error(`unknown model "${id}" (known: ${models.map((x) => x.id).join(', ')})`);
  if (!m.enabled) throw new Error(`model "${id}" is disabled in models.config.ts`);
  return m;
}

/** USD for one call, from registry pricing. */
export function costUsd(spec: Pick<ModelSpec, 'pricing'>, usage: Usage): number {
  return (usage.inputTokens * spec.pricing.inputPerMTok + usage.outputTokens * spec.pricing.outputPerMTok) / 1_000_000;
}

/** Problems with a registry; empty when valid. */
export function registryErrors(models: readonly ModelSpec[] = MODELS): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const m of models) {
    if (seen.has(m.id)) errs.push(`duplicate id ${m.id}`);
    seen.add(m.id);
    const { inputPerMTok: i, outputPerMTok: o } = m.pricing;
    if (m.enabled && !(i > 0 && o > 0)) errs.push(`${m.id}: enabled but unpriced`);
    if (m.maxOutputTokens < 100) errs.push(`${m.id}: maxOutputTokens too small`);
    if (m.toolMode === 'json' && m.provider === 'anthropic') errs.push(`${m.id}: json mode is OpenAI-compatible only`);
  }
  return errs;
}

/** One record per LLM call (BRD §7.7) — the source for cost, latency and fallback stats. */
export interface AgentCall {
  gameId: string;
  seq: number;
  seatId: string;
  modelId: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  retries: number;
  /** The controller gave up (error or still invalid after repair) and the engine will fall back. */
  fallback: boolean;
  /** Raw request/response — only kept in bench mode or LOG_RAW=1. */
  raw?: unknown;
}

/** Running totals for a game or a bench run. */
export class CostMeter {
  readonly calls: AgentCall[] = [];
  add = (c: AgentCall) => void this.calls.push(c);
  get totalUsd() {
    return this.calls.reduce((a, c) => a + c.costUsd, 0);
  }
  byModel() {
    const out = new Map<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number; fallbacks: number; latencies: number[] }>();
    for (const c of this.calls) {
      const m = out.get(c.modelId) ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, fallbacks: 0, latencies: [] };
      m.calls++;
      m.inputTokens += c.inputTokens;
      m.outputTokens += c.outputTokens;
      m.costUsd += c.costUsd;
      m.fallbacks += c.fallback ? 1 : 0;
      m.latencies.push(c.latencyMs);
      out.set(c.modelId, m);
    }
    return out;
  }
}

/** Parse "gameId:seq:seatId:kind" (engine request ids). */
export function parseRequestId(id: string): { gameId: string; seq: number; seatId: string } {
  const parts = id.split(':');
  const seatId = parts.at(-2) ?? '';
  const seq = Number(parts.at(-3));
  return { gameId: parts.slice(0, -3).join(':'), seq: Number.isFinite(seq) ? seq : -1, seatId };
}
