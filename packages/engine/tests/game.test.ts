import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSee } from '../src/events.js';
import { Game, checkWinner, tally } from '../src/game.js';
import { makeRng } from '../src/rng.js';
import { createPlayers } from '../src/setup.js';
import type { Agent, V0AgentContext, Player } from '../src/types.js';
import { RandomAgent } from './helpers.js';

/** Wraps an agent and records every context it was handed. */
class SpyAgent implements Agent {
  seen: V0AgentContext[] = [];
  constructor(private inner: Agent) {}
  speak(ctx: V0AgentContext, ch: 'public' | 'mafia') {
    this.seen.push(ctx);
    return this.inner.speak(ctx, ch);
  }
  choose(ctx: V0AgentContext, a: Parameters<Agent['choose']>[1], o: string[]) {
    this.seen.push(ctx);
    return this.inner.choose(ctx, a, o);
  }
}

async function play(seed: number) {
  const rng = makeRng(seed);
  const players = createPlayers(rng, Array(6).fill('random'));
  const spies = new Map(players.map((p) => [p.id, new SpyAgent(new RandomAgent(makeRng(seed * 7)))]));
  const result = await new Game(players, spies, rng).run();
  return { players, spies, result };
}

test('200 random games all finish with a valid winner', async () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { result } = await play(seed);
    assert.ok(['town', 'mafia'].includes(result.winner));
    assert.equal(checkWinner(result.players), result.winner);
  }
});

test('no agent ever receives an event it should not see', async () => {
  for (let seed = 1; seed <= 100; seed++) {
    const { players, spies } = await play(seed);
    for (const p of players) {
      for (const ctx of spies.get(p.id)!.seen) {
        for (const e of ctx.observations) {
          assert.ok(canSee(p, e), `${p.id} (${p.role}) leaked event: ${JSON.stringify(e)}`);
          assert.notEqual(e.visibility.kind, 'spectator', 'private thoughts leaked to a player');
        }
        if (p.role !== 'mafia') assert.deepEqual(ctx.teammates, [], 'town player learned mafia teammates');
      }
    }
  }
});

test('dead players never act', async () => {
  const { result, spies } = await play(42);
  const deathSeq = new Map<string, number>();
  for (const e of result.events) if ((e.type === 'death' || e.type === 'eliminated') && e.target) deathSeq.set(e.target, e.seq);
  for (const [id, seq] of deathSeq) {
    const acted = result.events.some((e) => e.actor === id && e.seq > seq && e.type !== 'game_over');
    assert.ok(!acted, `${id} acted after dying`);
    assert.ok(spies.get(id)!.seen.every((c) => c.observations.length <= seq + 1));
  }
});

test('win conditions', () => {
  const mk = (role: Player['role'], alive = true): Player => ({ id: Math.random().toString(), role, persona: '', model: '', alive });
  assert.equal(checkWinner([mk('mafia', false), mk('villager')]), 'town');
  assert.equal(checkWinner([mk('mafia'), mk('villager')]), 'mafia');
  assert.equal(checkWinner([mk('mafia'), mk('villager'), mk('doctor')]), null);
});

test('tally: plurality wins, ties return null', () => {
  assert.equal(tally(['a', 'a', 'b']), 'a');
  assert.equal(tally(['a', 'b']), null);
  assert.equal(tally([]), null);
});
