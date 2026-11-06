import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeRng } from '@ai-mafia/engine';
import type { V0AgentContext } from '@ai-mafia/engine';
import { RandomAgent } from '../src/random.js';

const ctx: V0AgentContext = {
  self: { id: 'Zara', role: 'villager', persona: '' },
  teammates: [],
  alive: ['Zara', 'Omar', 'Priya'],
  day: 1,
  phase: 'day',
  observations: [],
};

test('RandomAgent picks only from the given options', async () => {
  const a = new RandomAgent(makeRng(1));
  for (let i = 0; i < 50; i++) {
    const r = await a.choose(ctx, 'vote', ['Omar', 'Priya']);
    assert.ok(['Omar', 'Priya'].includes(r.target));
  }
});

test('RandomAgent never accuses itself', async () => {
  const a = new RandomAgent(makeRng(2));
  for (let i = 0; i < 50; i++) assert.ok(!(await a.speak(ctx)).speech.includes('Zara'));
});
