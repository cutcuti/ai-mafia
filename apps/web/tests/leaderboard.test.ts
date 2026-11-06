import assert from 'node:assert/strict';
import { test } from 'node:test';
import { h2hResponse, leaderboardResponse, modelResponse } from '../lib/api';
import { FixtureStore } from '../lib/fixture-store';
import { buildLeaderboard, h2hSummary, type LeaderboardSnapshot, type ModelStats, type PairGame, type RatingRow } from '../lib/leaderboard';
import { wilson } from '../lib/stats';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-4, `${a} ≠ ${b}`);

test('wilson matches textbook values (same as the bench implementation)', () => {
  const a = wilson(50, 100);
  close(a.lo, 0.4038);
  close(a.hi, 0.5962);
  close(wilson(0, 10).hi, 0.2775);
});

function stats(mafiaGames: number, mafiaWins: number, townGames: number, townWins: number, extra: Partial<ModelStats> = {}): ModelStats {
  return {
    games: mafiaGames + townGames,
    mafiaGames,
    townGames,
    draws: 0,
    mafiaWin: wilson(mafiaWins, mafiaGames),
    townWin: wilson(townWins, townGames),
    townVoteAccuracy: 0.4,
    deceptionScore: 0.1,
    survivalMafia: 2,
    survivalTown: 1.5,
    detectiveHitRate: null,
    detectiveBaseRate: null,
    detectiveConversion: null,
    doctorBlockRate: null,
    persuasion: 0.2,
    lieRate: 0.1,
    fallbackRate: 0,
    costPerGame: 0.01,
    tokensPerGame: 1000,
    latencyP50: 1500,
    latencyP95: 3000,
    ...extra,
  };
}

const rating = (modelId: string, scope: RatingRow['scope'], ordinal: number, preset = 'classic6', promptVersion = 'p1'): RatingRow => ({
  modelId,
  scope,
  preset,
  promptVersion,
  mu: ordinal + 24,
  sigma: 8,
  ordinal,
  games: 100,
});

const snap: LeaderboardSnapshot = {
  ratings: [
    rating('big', 'as_mafia', 10),
    rating('small', 'as_mafia', 20), // higher ordinal but provisional
    rating('mid', 'as_mafia', 5),
    rating('big', 'overall', 7),
    rating('big', 'as_mafia', 99, 'big8'),
    rating('big', 'as_mafia', 50, 'classic6', 'p0'),
  ],
  stats: [
    { modelId: 'big', promptVersion: 'p1', preset: 'classic6', games: 120, stats: stats(60, 40, 60, 20) },
    { modelId: 'mid', promptVersion: 'p1', preset: 'classic6', games: 110, stats: stats(55, 30, 55, 25) },
    { modelId: 'small', promptVersion: 'p1', preset: 'classic6', games: 20, stats: stats(10, 9, 10, 2) },
  ],
  models: [
    { id: 'big', displayName: 'Big Model', provider: 'anthropic', model: 'x' },
    { id: 'mid', displayName: 'Mid Model', provider: 'openai', model: 'y' },
  ],
};

test('ranked models first by ordinal; provisional (<50 games per role) after, unranked', () => {
  const lb = buildLeaderboard(snap, { scope: 'as_mafia' });
  assert.deepEqual(lb.rows.map((r) => [r.modelId, r.rank, r.provisional]), [
    ['big', 1, false],
    ['mid', 2, false],
    ['small', null, true],
  ]);
  assert.equal(lb.rows[0].displayName, 'Big Model');
  assert.equal(lb.rows[2].displayName, 'small', 'falls back to the id');
});

test('win rate column follows the tab: as mafia, as town, or pooled with honest n', () => {
  const m = buildLeaderboard(snap, { scope: 'as_mafia' }).rows.find((r) => r.modelId === 'big')!;
  close(m.winRate.p, 40 / 60);
  assert.equal(m.winRate.n, 60);
  const o = buildLeaderboard(snap, { scope: 'overall' }).rows.find((r) => r.modelId === 'big')!;
  close(o.winRate.p, 60 / 120);
  assert.equal(o.winRate.n, 120);
  assert.ok(o.winRate.lo < 0.5 && o.winRate.hi > 0.5);
});

test('defaults: classic6 + newest prompt version; filters switch preset and version; bad input falls back', () => {
  const lb = buildLeaderboard(snap, {});
  assert.equal(lb.scope, 'as_mafia');
  assert.equal(lb.preset, 'classic6');
  assert.equal(lb.promptVersion, 'p1');
  assert.deepEqual(lb.presets, ['big8', 'classic6']);
  assert.deepEqual(lb.promptVersions, ['p0', 'p1']);
  assert.equal(buildLeaderboard(snap, { preset: 'big8' }).rows[0].ordinal, 99);
  assert.equal(buildLeaderboard(snap, { promptVersion: 'p0' }).rows[0].ordinal, 50);
  const bad = buildLeaderboard(snap, { scope: 'drop table', preset: 'nope', promptVersion: 'p9' });
  assert.equal(bad.scope, 'as_mafia');
  assert.equal(bad.preset, 'classic6');
});

const pg = (id: string, outcome: PairGame['outcome'], mafia: string, town: string, preset = 'classic6'): PairGame => ({
  id,
  outcome,
  preset,
  promptVersion: 'p1',
  mafiaModels: [mafia, mafia],
  townModels: [town, town, town, town],
});

test('h2h: both directions on shared seeds, self-play baselines, table baseline', () => {
  const games = [
    pg('1', 'mafia', 'A', 'B'),
    pg('2', 'town', 'A', 'B'),
    pg('3', 'mafia', 'A', 'B'),
    pg('4', 'town', 'B', 'A'),
    pg('5', 'town', 'B', 'A'),
    pg('6', 'draw', 'B', 'A'),
    pg('7', 'mafia', 'A', 'A'),
    pg('8', 'town', 'B', 'B'),
    pg('9', 'mafia', 'A', 'B', 'big8'),
  ];
  const s = h2hSummary(games, 'A', 'B');
  assert.equal(s.aMafia.games, 3);
  close(s.aMafia.mafiaWins.p, 2 / 3);
  assert.equal(s.bMafia.games, 3);
  assert.equal(s.bMafia.mafiaWins.p, 0);
  assert.equal(s.bMafia.draws, 1);
  assert.equal(s.selfA.games, 1);
  assert.equal(s.selfB.mafiaWins.p, 0);
  assert.equal(s.table.games, 8, 'other presets excluded');
});

test('API: leaderboard, model profile and h2h handlers', async () => {
  const store = new FixtureStore();
  store.setLeaderboard(snap);
  const lb = await leaderboardResponse(store, new URL('http://x/api/leaderboard?scope=as_town'));
  assert.equal(lb.status, 200);
  assert.match(lb.headers.get('cache-control')!, /s-maxage/);
  assert.equal((await lb.json()).scope, 'as_town');
  const m = await modelResponse(store, 'big');
  const mb = await m.json();
  assert.equal(mb.model.displayName, 'Big Model');
  assert.equal(mb.ratings.length, 4);
  assert.deepEqual(mb.recentGames, []);
  assert.equal((await modelResponse(store, 'unknown')).status, 404);
  assert.equal((await h2hResponse(store, 'A', 'A', new URL('http://x'))).status, 400);
  assert.equal((await h2hResponse(store, 'A', 'B', new URL('http://x'))).status, 200);
});
