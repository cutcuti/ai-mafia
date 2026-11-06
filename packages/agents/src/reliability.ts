import type { CompletionRequest, CompletionResult, Provider } from './providers/types.ts';

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`provider call timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/** Retry only what might succeed next time: rate limits, server errors, timeouts, dropped connections. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  const e = err as { status?: unknown; name?: unknown; code?: unknown };
  if (typeof e?.status === 'number') return e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500;
  // SDK connection errors carry no status
  return e?.name === 'APIConnectionError' || e?.name === 'APIConnectionTimeoutError' || e?.code === 'ECONNRESET' || e?.code === 'ETIMEDOUT';
}

/** Caps in-flight calls (BRD §7.6: per-provider concurrency limiter). FIFO. */
export class Limiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(readonly max: number) {
    if (max < 1) throw new Error('limiter max must be ≥ 1');
  }
  get inFlight() {
    return this.active;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

const limiters = new Map<string, Limiter>();
/** One shared limiter per provider id, process-wide. */
export function limiterFor(providerId: string, max = 4): Limiter {
  let l = limiters.get(providerId);
  if (!l) limiters.set(providerId, (l = new Limiter(max)));
  return l;
}

export interface ReliabilityOptions {
  timeoutMs?: number; // default 45s
  retries?: number; // default 2
  baseDelayMs?: number; // default 500 → 500, 1000 (+ jitter)
  limiter?: Limiter;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wraps a Provider with timeout, retries (exponential backoff + full jitter) and a concurrency limiter. */
export class ReliableProvider implements Provider {
  readonly id: string;
  constructor(
    private readonly inner: Provider,
    private readonly o: ReliabilityOptions = {},
  ) {
    this.id = inner.id;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const retries = this.o.retries ?? 2;
    const sleep = this.o.sleep ?? realSleep;
    const random = this.o.random ?? Math.random;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.once(req);
        return { ...res, retries: attempt };
      } catch (err) {
        if (attempt >= retries || !isRetryable(err) || req.signal?.aborted) throw err;
        const cap = (this.o.baseDelayMs ?? 500) * 2 ** attempt;
        await sleep(cap / 2 + random() * (cap / 2));
      }
    }
  }

  private once(req: CompletionRequest): Promise<CompletionResult> {
    const call = async () => {
      const timeoutMs = this.o.timeoutMs ?? 45_000;
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort(req.signal?.reason);
      req.signal?.addEventListener('abort', onAbort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // reject first so the race settles as a (retryable) timeout, then abort the hung request
          reject(new TimeoutError(timeoutMs));
          ctrl.abort();
        }, timeoutMs);
      });
      try {
        return await Promise.race([this.inner.complete({ ...req, signal: ctrl.signal }), timeout]);
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener('abort', onAbort);
      }
    };
    return this.o.limiter ? this.o.limiter.run(call) : call();
  }
}
