import type { Highlight } from '@ai-mafia/agents';
import type { LiveGame, LiveStore, StepCommit } from './types';

/** In-memory LiveStore with the same semantics as the SQL functions (lease, CAS, buckets). Tests and local demos. */
export class MemoryLiveStore implements LiveStore {
  readonly games = new Map<string, LiveGame & { leaseUntil: number }>();
  readonly buckets = new Map<string, { tokens: number; at: number }>();
  spent = 0;
  readonly highlights = new Map<string, Highlight[]>();
  private seq = 0;
  constructor(private readonly clock: () => number = Date.now) {}

  async createLiveGame(state: LiveGame['state'], createdBy: string) {
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`;
    this.games.set(id, { id, state, version: 0, status: 'running', costUsd: 0, mode: 'live', createdBy, createdAt: new Date(this.clock()).toISOString(), leaseUntil: 0 });
    return id;
  }
  async loadLive(id: string) {
    const g = this.games.get(id);
    return g ? { ...g, state: structuredClone(g.state) } : null;
  }
  async claimStep(id: string, version: number, leaseMs: number) {
    const g = this.games.get(id);
    if (!g || g.version !== version || g.status !== 'running' || g.leaseUntil > this.clock()) return false;
    g.leaseUntil = this.clock() + leaseMs;
    return true;
  }
  async commitStep(id: string, version: number, c: StepCommit) {
    const g = this.games.get(id);
    if (!g || g.version !== version) return false;
    const next = g.state.events.length;
    if (c.newEvents.length && c.newEvents[0].seq !== next) throw new Error(`events must continue at seq ${next}`);
    g.state = structuredClone(c.state);
    g.version++;
    g.costUsd += c.costUsd;
    this.spent += c.costUsd;
    g.status = c.state.status === 'finished' ? 'finished' : c.state.status === 'awaiting_input' ? 'awaiting_input' : 'running';
    g.leaseUntil = 0;
    return true;
  }
  async abort(id: string) {
    const g = this.games.get(id);
    if (!g || g.status !== 'running') return false;
    g.status = 'aborted';
    g.version++;
    g.leaseUntil = 0;
    return true;
  }
  async takeToken(key: string, capacity: number, refillPerSec: number) {
    const now = this.clock();
    const b = this.buckets.get(key) ?? { tokens: capacity, at: now };
    b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSec);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
  async spendToday() {
    return this.spent;
  }
  async gamesCreatedToday(userId: string) {
    return [...this.games.values()].filter((g) => g.createdBy === userId).length;
  }
  async listActive(limit: number) {
    return [...this.games.values()].filter((g) => g.status === 'running').slice(0, limit);
  }
  async saveHighlights(id: string, h: Highlight[]) {
    if (this.games.get(id)?.status !== 'finished') throw new Error(`game ${id} is not finished`);
    this.highlights.set(id, [...h]);
  }
  highlightsOf(id: string): Highlight[] {
    return [...(this.highlights.get(id) ?? [])];
  }
  async recentFallbacks(limit: number) {
    return [...this.games.values()]
      .flatMap((g) =>
        g.state.events
          .filter((e) => e.type === 'fallback')
          .map((e) => ({ gameId: g.id, seq: e.seq, seatId: e.actorSeatId ?? null, text: e.text, reason: String(e.payload?.reason ?? ''), rawOutput: e.payload?.rawOutput, createdAt: e.createdAt })),
      )
      .slice(-limit)
      .reverse();
  }
}
