import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EventType, GameEvent, Phase, Visibility } from '@ai-mafia/engine';
import type { AgentCall } from '@ai-mafia/agents';
import { computeMetrics, percentile, summarize, type MetricGame } from '../src/metrics.ts';
import { runBench } from '../src/runner.ts';

/** Tiny event builder for hand-written logs. */
function log() {
  const events: GameEvent[] = [];
  let day = 0;
  let phase: Phase = 'setup';
  const add = (type: EventType, x: Partial<GameEvent> = {}, visibility: Visibility = { kind: 'public' }) =>
    void events.push({ gameId: 'fx', seq: events.length, day, phase, type, visibility, text: type, createdAt: '', ...x });
  return {
    events,
    phase(p: Phase, d: number) {
      phase = p;
      day = d;
      add('phase', { payload: { phase: p, day: d } });
    },
    add,
  };
}

const call = (modelId: string, costUsd: number, latencyMs: number, fallback = false): AgentCall => ({
  gameId: 'fx', seq: 0, seatId: 's1', modelId, promptVersion: 'p1', inputTokens: 100, outputTokens: 10, costUsd, latencyMs, retries: 0, fallback,
});

/**
 * Hand-built mini5 game. A = mafia (s1). B = town: s2 detective, s3 doctor, s4/s5 villagers.
 * Night 1: s1 kills s4, doctor saves s4 (blocked), detective finds s1 = MAFIA.
 * Day 1: s2 claims detective + accuses s1; s1 fake-claims doctor + accuses s2; s3 accuses s1; s4 falls back.
 * Votes: s1→s2, s2→s1, s3→s1, s4→s1, s5→s2. s1 eliminated → town wins.
 */
function fixture(): MetricGame {
  const l = log();
  l.add('game_start');
  l.phase('night', 1);
  l.add('kill_vote', { actorSeatId: 's1', targetSeatId: 's4' }, { kind: 'team', team: 'mafia' });
  l.add('save', { actorSeatId: 's3', targetSeatId: 's4' }, { kind: 'seat', seatId: 's3' });
  l.add('investigate_result', { actorSeatId: 's2', targetSeatId: 's1', payload: { isMafia: true } }, { kind: 'seat', seatId: 's2' });
  l.add('survived_attack');
  l.phase('day', 1);
  l.add('speech', { actorSeatId: 's2', payload: { claimRole: 'detective', accuses: 's1' } });
  l.add('speech', { actorSeatId: 's1', payload: { claimRole: 'doctor', accuses: 's2' } });
  l.add('speech', { actorSeatId: 's3', payload: { accuses: 's1' } });
  l.add('fallback', { actorSeatId: 's4' }, { kind: 'spectator' });
  l.add('speech', { actorSeatId: 's4' });
  l.add('speech', { actorSeatId: 's5' });
  l.phase('vote', 1);
  for (const [a, t] of [['s1', 's2'], ['s2', 's1'], ['s3', 's1'], ['s4', 's1'], ['s5', 's2']]) l.add('vote', { actorSeatId: a, targetSeatId: t });
  l.add('eliminated', { targetSeatId: 's1', payload: { role: 'mafia' } });
  l.add('game_over', { payload: { outcome: 'town' } });
  return {
    gameId: 'fx',
    outcome: 'town',
    seats: [
      { id: 's1', name: 'Zara', role: 'mafia', modelId: 'A' },
      { id: 's2', name: 'Omar', role: 'detective', modelId: 'B' },
      { id: 's3', name: 'Priya', role: 'doctor', modelId: 'B' },
      { id: 's4', name: 'Leo', role: 'villager', modelId: 'B' },
      { id: 's5', name: 'Maya', role: 'villager', modelId: 'B' },
    ],
    events: l.events,
    agentCalls: [call('A', 0.01, 100), call('A', 0.01, 300), call('B', 0.02, 50, true)],
  };
}

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≠ ${b}`);

test('fixture: mafia-side metrics for A', () => {
  const a = summarize(computeMetrics([fixture()]).get('A')!);
  assert.equal(a.games, 1);
  assert.equal(a.mafiaGames, 1);
  assert.equal(a.mafiaWinRate, 0);
  assert.ok(Number.isNaN(a.townWinRate), 'never played town');
  close(a.deceptionScore, 1 - 3 / 1); // 3 votes received vs 1 expected (4 other voters × 1/4)
  close(a.lieRate, 1); // fake doctor claim
  close(a.persuasion, 1 / 4); // accused s2; of 4 other votes, 1 hit s2
  close(a.survivalMafia, 1); // reached day 1 alive
  close(a.fallbackRate, 0 / 3); // kill_vote, speech, vote
  close(a.costPerGame, 0.02);
  assert.equal(a.latencyP50, 100);
  assert.equal(a.latencyP95, 300);
});

test('fixture: town-side metrics for B', () => {
  const b = summarize(computeMetrics([fixture()]).get('B')!);
  assert.equal(b.townGames, 1, 'one game as town even with four town seats');
  assert.equal(b.townWinRate, 1);
  close(b.townVoteAccuracy, 3 / 4);
  close(b.detectiveHitRate, 1);
  close(b.detectiveBaseRate, 1 / 4); // fresh pool s1,s3,s4,s5 → 1 mafia of 4
  close(b.detectiveConversion, 2 / 3); // town votes excl. detective: s3,s4 follow, s5 doesn't
  close(b.doctorBlockRate, 1);
  close(b.persuasion, 4 / 8); // s2: 2 of 4 others hit s1; s3: 2 of 4 others hit s1
  close(b.survivalTown, 1);
  close(b.fallbackRate, 1 / 10); // 10 actions by B seats, 1 fallback
  assert.ok(Number.isNaN(b.lieRate));
});

test('draws count in the denominator, not as wins or losses', () => {
  const g = { ...fixture(), outcome: 'draw' as const };
  const m = computeMetrics([g, fixture()]);
  const a = m.get('A')!;
  assert.deepEqual(a.mafia, { games: 2, wins: 0, losses: 1, draws: 1 });
  assert.deepEqual(m.get('B')!.town, { games: 2, wins: 1, losses: 0, draws: 1 });
  assert.equal(summarize(m.get('B')!).townWinRate, 0.5);
});

test('metrics aggregate across games (pooled tallies)', () => {
  const b = computeMetrics([fixture(), fixture(), fixture()]).get('B')!;
  assert.deepEqual(b.townVoteAccuracy, { num: 9, den: 12 });
  assert.equal(b.games, 3);
});

test('percentile (nearest rank)', () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.ok(Number.isNaN(percentile([], 50)));
});

test('sanity on real engine games: rates in range, h2h team splits add up', async () => {
  const { tmpdir } = await import('node:os');
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const res = await runBench({ format: 'h2h', a: 'random', b: 'claude-haiku', games: 20, preset: 'classic6', dryRun: true, outDir: mkdtempSync(join(tmpdir(), 'bench-')) });
  const m = computeMetrics(res.records);
  for (const id of ['random', 'claude-haiku']) {
    const s = summarize(m.get(id)!);
    assert.equal(s.mafiaGames, 10);
    assert.equal(s.townGames, 10);
    for (const k of ['mafiaWinRate', 'townWinRate', 'townVoteAccuracy', 'detectiveHitRate', 'doctorBlockRate', 'persuasion', 'fallbackRate'] as const) {
      if (!Number.isNaN(s[k])) assert.ok(s[k] >= 0 && s[k] <= 1, `${id}.${k}=${s[k]}`);
    }
  }
  // the two sides of every game are complementary
  const a = summarize(m.get('random')!);
  const b = summarize(m.get('claude-haiku')!);
  const draws = res.records.filter((r) => r.outcome === 'draw').length;
  assert.equal(a.mafiaWinRate * 10 + b.townWinRate * 10 + a.townWinRate * 10 + b.mafiaWinRate * 10 + draws * 2, 20);
});
