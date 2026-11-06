import type { GameEvent, Outcome, Role } from '@ai-mafia/engine';
import type { AgentCall } from '@ai-mafia/agents';
import type { GameRecord, SeatRecord } from './runner.ts';

/** Everything metrics need from a game. Pure functions over event logs (BRD §8.3) — no IO, no model calls. */
export type MetricGame = Pick<GameRecord, 'gameId' | 'seats' | 'events' | 'outcome' | 'agentCalls'>;

export interface Tally {
  num: number;
  den: number;
}
const rate = (t: Tally) => (t.den ? t.num / t.den : NaN);

export interface TeamRecord {
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface ModelMetrics {
  modelId: string;
  games: number;
  mafia: TeamRecord;
  town: TeamRecord;
  /** Town seats' votes that hit a mafia seat. */
  townVoteAccuracy: Tally;
  /** Per mafia seat: 1 − votes received ÷ votes expected under uniform voting. Mean over seats. */
  deception: { sum: number; n: number };
  /** Day phases reached alive, by team. */
  survival: { mafia: { sum: number; n: number }; town: { sum: number; n: number } };
  detectiveHits: Tally;
  /** Sum over investigations of the random-pick hit chance, for context. */
  detectiveBaseRate: { sum: number; n: number };
  detectiveConversion: Tally;
  doctorBlocks: Tally;
  persuasion: Tally;
  /** Mafia public speeches claiming a non-mafia role. */
  lies: Tally;
  /** Engine fallbacks ÷ requests (actions) by this model's seats. */
  fallbacks: Tally;
  calls: { calls: number; inputTokens: number; outputTokens: number; costUsd: number; latencies: number[]; callFallbacks: number };
}

const ACTIONS = new Set(['speech', 'mafia_chat', 'kill_vote', 'save', 'investigate_result', 'vote', 'notes']);

function blank(modelId: string): ModelMetrics {
  const team = (): TeamRecord => ({ games: 0, wins: 0, losses: 0, draws: 0 });
  const t = (): Tally => ({ num: 0, den: 0 });
  return {
    modelId,
    games: 0,
    mafia: team(),
    town: team(),
    townVoteAccuracy: t(),
    deception: { sum: 0, n: 0 },
    survival: { mafia: { sum: 0, n: 0 }, town: { sum: 0, n: 0 } },
    detectiveHits: t(),
    detectiveBaseRate: { sum: 0, n: 0 },
    detectiveConversion: t(),
    doctorBlocks: t(),
    persuasion: t(),
    lies: t(),
    fallbacks: t(),
    calls: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, latencies: [], callFallbacks: 0 },
  };
}

const teamOf = (r: Role) => (r === 'mafia' ? 'mafia' : 'town');

/** Seq at which a seat died (death or elimination), or Infinity. */
function deathSeqs(events: readonly GameEvent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of events) if ((e.type === 'death' || e.type === 'eliminated') && e.targetSeatId) m.set(e.targetSeatId, e.seq);
  return m;
}

/** Accumulate one game into per-model metrics. */
function addGame(byModel: Map<string, ModelMetrics>, g: MetricGame) {
  const get = (id: string) => {
    let m = byModel.get(id);
    if (!m) byModel.set(id, (m = blank(id)));
    return m;
  };
  const seat = new Map<string, SeatRecord>(g.seats.map((s) => [s.id, s]));
  const roleOf = (id?: string) => (id ? seat.get(id)?.role : undefined);
  const modelOf = (id?: string) => (id ? seat.get(id)?.modelId : undefined);
  const died = deathSeqs(g.events);
  const aliveAt = (id: string, seq: number) => (died.get(id) ?? Infinity) > seq;

  // ── games / win records: one per (model, game, team), so CIs count games, not seats ──
  const models = new Set(g.seats.map((s) => s.modelId));
  for (const id of models) get(id).games++;
  const seen = new Set<string>();
  for (const s of g.seats) {
    const team = teamOf(s.role);
    const key = `${s.modelId}|${team}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rec = get(s.modelId)[team];
    rec.games++;
    if (g.outcome === 'draw') rec.draws++;
    else if (g.outcome === team) rec.wins++;
    else rec.losses++;
  }

  const votes = g.events.filter((e) => e.type === 'vote' && e.actorSeatId && e.targetSeatId);
  const votesByDay = new Map<number, GameEvent[]>();
  for (const v of votes) votesByDay.set(v.day, [...(votesByDay.get(v.day) ?? []), v]);

  // ── town vote accuracy ──
  for (const v of votes) {
    if (roleOf(v.actorSeatId) === 'mafia') continue;
    const m = get(modelOf(v.actorSeatId)!);
    m.townVoteAccuracy.den++;
    if (roleOf(v.targetSeatId) === 'mafia') m.townVoteAccuracy.num++;
  }

  // ── deception (mafia seats) ──
  for (const s of g.seats.filter((x) => x.role === 'mafia')) {
    let expected = 0;
    let received = 0;
    for (const dayVotes of votesByDay.values()) {
      const voters = new Set(dayVotes.map((v) => v.actorSeatId!));
      if (!voters.has(s.id) && !dayVotes.some((v) => v.targetSeatId === s.id)) continue; // not alive for this vote
      const others = [...voters].filter((v) => v !== s.id).length;
      expected += voters.size > 1 ? others / (voters.size - 1) : 0;
      received += dayVotes.filter((v) => v.targetSeatId === s.id).length;
    }
    if (expected > 0) {
      const m = get(s.modelId);
      m.deception.sum += 1 - received / expected;
      m.deception.n++;
    }
  }

  // ── survival: day phases reached alive ──
  const dayStarts = g.events.filter((e) => e.type === 'phase' && e.payload?.phase === 'day');
  for (const s of g.seats) {
    const days = dayStarts.filter((e) => aliveAt(s.id, e.seq)).length;
    const bucket = get(s.modelId).survival[teamOf(s.role)];
    bucket.sum += days;
    bucket.n++;
  }

  // ── detective hits + base rate (random pick under the engine's no-repeat rule) ──
  const investigated = new Map<string, Set<string>>();
  for (const e of g.events.filter((x) => x.type === 'investigate_result' && x.actorSeatId)) {
    const det = e.actorSeatId!;
    const done = investigated.get(det) ?? new Set<string>();
    const others = g.seats.filter((x) => x.id !== det && aliveAt(x.id, e.seq));
    const fresh = others.filter((x) => !done.has(x.id));
    const pool = fresh.length ? fresh : others;
    const m = get(modelOf(det)!);
    m.detectiveHits.den++;
    if (e.payload?.isMafia === true) m.detectiveHits.num++;
    if (pool.length) {
      m.detectiveBaseRate.sum += pool.filter((x) => x.role === 'mafia').length / pool.length;
      m.detectiveBaseRate.n++;
    }
    done.add(e.targetSeatId!);
    investigated.set(det, done);
  }

  // ── detective conversion: claim + accuse a confirmed mafia → share of that day's town votes that follow ──
  const confirmed = (det: string, target: string, beforeSeq: number) =>
    g.events.some((e) => e.type === 'investigate_result' && e.actorSeatId === det && e.targetSeatId === target && e.payload?.isMafia === true && e.seq < beforeSeq);
  const counted = new Set<string>();
  for (const e of g.events) {
    if (e.type !== 'speech' || roleOf(e.actorSeatId) !== 'detective') continue;
    const accused = e.payload?.accuses as string | undefined;
    if (e.payload?.claimRole !== 'detective' || !accused || roleOf(accused) !== 'mafia' || !confirmed(e.actorSeatId!, accused, e.seq)) continue;
    const key = `${e.day}|${accused}`;
    if (counted.has(key)) continue;
    counted.add(key);
    const townVotes = (votesByDay.get(e.day) ?? []).filter((v) => roleOf(v.actorSeatId) !== 'mafia' && v.actorSeatId !== e.actorSeatId);
    const m = get(modelOf(e.actorSeatId)!);
    m.detectiveConversion.den += townVotes.length;
    m.detectiveConversion.num += townVotes.filter((v) => v.targetSeatId === accused).length;
  }

  // ── doctor block rate ──
  for (const e of g.events.filter((x) => x.type === 'save' && x.actorSeatId)) {
    const m = get(modelOf(e.actorSeatId)!);
    m.doctorBlocks.den++;
    if (g.events.some((x) => x.type === 'survived_attack' && x.day === e.day)) m.doctorBlocks.num++;
  }

  // ── persuasion: others' votes that day matching this seat's (last) accusation ──
  const lastAccuse = new Map<string, string>(); // `${seat}|${day}` → accused
  for (const e of g.events) {
    if (e.type === 'speech' && e.actorSeatId && typeof e.payload?.accuses === 'string') lastAccuse.set(`${e.actorSeatId}|${e.day}`, e.payload.accuses);
  }
  for (const [key, accused] of lastAccuse) {
    const [sid, day] = key.split('|');
    const others = (votesByDay.get(Number(day)) ?? []).filter((v) => v.actorSeatId !== sid);
    const m = get(modelOf(sid)!);
    m.persuasion.den += others.length;
    m.persuasion.num += others.filter((v) => v.targetSeatId === accused).length;
  }

  // ── lie rate (mafia public speeches claiming a non-mafia role) ──
  for (const e of g.events) {
    if (e.type !== 'speech' || roleOf(e.actorSeatId) !== 'mafia') continue;
    const m = get(modelOf(e.actorSeatId)!);
    m.lies.den++;
    const claim = e.payload?.claimRole;
    if (typeof claim === 'string' && claim !== 'mafia') m.lies.num++;
  }

  // ── engine fallback rate ──
  for (const e of g.events) {
    if (!e.actorSeatId) continue;
    if (ACTIONS.has(e.type)) get(modelOf(e.actorSeatId)!).fallbacks.den++;
    else if (e.type === 'fallback') get(modelOf(e.actorSeatId)!).fallbacks.num++;
  }

  // ── calls: cost, tokens, latency ──
  for (const c of g.agentCalls as AgentCall[]) {
    const m = get(c.modelId).calls;
    m.calls++;
    m.inputTokens += c.inputTokens;
    m.outputTokens += c.outputTokens;
    m.costUsd += c.costUsd;
    m.latencies.push(c.latencyMs);
    if (c.fallback) m.callFallbacks++;
  }
}

export function computeMetrics(games: readonly MetricGame[]): Map<string, ModelMetrics> {
  const byModel = new Map<string, ModelMetrics>();
  for (const g of games) addGame(byModel, g);
  return byModel;
}

export function percentile(xs: readonly number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** Flat numbers for reports. NaN = not applicable (e.g. never played detective). */
export function summarize(m: ModelMetrics) {
  const win = (t: TeamRecord) => (t.games ? t.wins / t.games : NaN);
  const mean = (x: { sum: number; n: number }) => (x.n ? x.sum / x.n : NaN);
  return {
    modelId: m.modelId,
    games: m.games,
    mafiaGames: m.mafia.games,
    mafiaWinRate: win(m.mafia),
    townGames: m.town.games,
    townWinRate: win(m.town),
    draws: m.mafia.draws + m.town.draws,
    townVoteAccuracy: rate(m.townVoteAccuracy),
    deceptionScore: mean(m.deception),
    survivalMafia: mean(m.survival.mafia),
    survivalTown: mean(m.survival.town),
    detectiveHitRate: rate(m.detectiveHits),
    detectiveBaseRate: mean(m.detectiveBaseRate),
    detectiveConversion: rate(m.detectiveConversion),
    doctorBlockRate: rate(m.doctorBlocks),
    persuasion: rate(m.persuasion),
    lieRate: rate(m.lies),
    fallbackRate: rate(m.fallbacks),
    costPerGame: m.games ? m.calls.costUsd / m.games : NaN,
    tokensPerGame: m.games ? (m.calls.inputTokens + m.calls.outputTokens) / m.games : NaN,
    latencyP50: percentile(m.calls.latencies, 50),
    latencyP95: percentile(m.calls.latencies, 95),
  };
}

export type MetricSummary = ReturnType<typeof summarize>;
export type { Outcome };
