import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { computeRatings, loadRecords, type RatingRow } from '../src/ratings.ts';
import { runBench, type GameRecord } from '../src/runner.ts';

type G = Pick<GameRecord, 'gameId' | 'seats' | 'outcome' | 'promptVersion' | 'preset'>;

/** h2h-shaped game: `mafiaModel` on 2 mafia seats, `townModel` on 4 town seats. */
function game(id: string, mafiaModel: string, townModel: string, outcome: G['outcome']): G {
  const roles = ['mafia', 'mafia', 'detective', 'doctor', 'villager', 'villager'] as const;
  return {
    gameId: id,
    outcome,
    promptVersion: 'p1',
    preset: 'classic6',
    seats: roles.map((role, i) => ({ id: `s${i + 1}`, name: `n${i}`, role, modelId: role === 'mafia' ? mafiaModel : townModel })),
  };
}

const row = (rows: RatingRow[], modelId: string, scope: string) => rows.find((r) => r.modelId === modelId && r.scope === scope)!;

/** A wins every game, on both sides. */
const dominant = (): G[] =>
  Array.from({ length: 10 }, (_, i) => [game(`g${i}a`, 'A', 'B', 'mafia'), game(`g${i}b`, 'B', 'A', 'town')]).flat();

test('known example: a model that always wins outranks its opponent in every scope', () => {
  const rows = computeRatings(dominant());
  for (const scope of ['overall', 'as_mafia', 'as_town']) {
    assert.ok(row(rows, 'A', scope).ordinal > row(rows, 'B', scope).ordinal, scope);
    assert.ok(row(rows, 'A', scope).mu > 25 && row(rows, 'B', scope).mu < 25, scope);
  }
  assert.equal(row(rows, 'A', 'overall').games, 20);
  assert.equal(row(rows, 'A', 'as_mafia').games, 10);
  assert.equal(row(rows, 'A', 'as_town').games, 10);
  // ordinal = μ − 3σ
  const r = row(rows, 'A', 'overall');
  assert.ok(Math.abs(r.ordinal - (r.mu - 3 * r.sigma)) < 1e-9);
});

test('role split: a great liar but a bad detective shows up only in the right scope', () => {
  // A wins whenever it is mafia, loses whenever it is town
  const games = Array.from({ length: 10 }, (_, i) => [game(`g${i}a`, 'A', 'B', 'mafia'), game(`g${i}b`, 'B', 'A', 'mafia')]).flat();
  const rows = computeRatings(games);
  assert.ok(row(rows, 'A', 'as_mafia').ordinal > row(rows, 'A', 'as_town').ordinal);
  assert.ok(row(rows, 'B', 'as_mafia').ordinal > row(rows, 'A', 'as_town').ordinal, 'B also wins as mafia');
});

test('rebuild is idempotent and independent of input order', () => {
  const games = dominant();
  const a = computeRatings(games);
  const b = computeRatings([...games].reverse());
  const c = computeRatings(games);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

test('draws are rated as draws (different from a win)', () => {
  const draws = computeRatings([game('d1', 'A', 'B', 'draw')]);
  const win = computeRatings([game('w1', 'A', 'B', 'mafia')]);
  assert.ok(row(win, 'A', 'as_mafia').mu > row(draws, 'A', 'as_mafia').mu);
});

test('ratings are grouped by prompt version and preset', () => {
  const g = dominant();
  const rows = computeRatings([...g, ...g.map((x) => ({ ...x, gameId: `${x.gameId}-p2`, promptVersion: 'p2' }))]);
  assert.equal(new Set(rows.map((r) => r.promptVersion)).size, 2);
  assert.equal(rows.filter((r) => r.promptVersion === 'p2' && r.scope === 'overall').length, 2);
});

test('ffa: a model on both teams in one game gets one averaged update', () => {
  const g: G = { ...game('f1', 'A', 'B', 'town'), seats: game('f1', 'A', 'B', 'town').seats.map((s, i) => (i === 0 ? s : { ...s, modelId: i === 2 ? 'A' : s.modelId })) };
  const rows = computeRatings([g]);
  assert.equal(row(rows, 'A', 'overall').games, 1);
});

test('loadRecords reads bench records recursively and ignores other JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-'));
  await runBench({ format: 'self', model: 'random', games: 3, preset: 'mini5', outDir: dir });
  writeFileSync(join(dir, 'game-7.json'), JSON.stringify({ config: {}, events: [] })); // single CLI game
  mkdirSync(join(dir, 'junk'));
  writeFileSync(join(dir, 'junk', 'x.json'), '{not json');
  assert.equal(loadRecords(dir).length, 3);
  assert.deepEqual(loadRecords(join(dir, 'missing')), []);
});
