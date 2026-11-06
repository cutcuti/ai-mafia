import type { CompletionRequest, CompletionResult, Provider } from './types.ts';

export type MockAnswer = ((req: CompletionRequest, call: number) => unknown) | Record<string, unknown> | unknown[] | string | number | boolean | null;

/**
 * Offline provider for tests and CI. Answers every call with `answer` (or its result),
 * records requests, reports fixed usage. A thrown Error from `answer` propagates like a provider failure.
 */
export class MockProvider implements Provider {
  readonly id = 'mock';
  readonly calls: CompletionRequest[] = [];
  constructor(
    private readonly answer: MockAnswer,
    private readonly usage = { inputTokens: 100, outputTokens: 20 },
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(req);
    const toolInput = typeof this.answer === 'function' ? (this.answer as (r: CompletionRequest, n: number) => unknown)(req, this.calls.length) : this.answer;
    return { toolInput, usage: { ...this.usage }, latencyMs: 1, raw: { toolInput } };
  }
}
