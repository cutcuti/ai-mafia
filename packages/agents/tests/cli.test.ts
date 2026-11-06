import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { replay } from '@ai-mafia/engine';

const cli = new URL('../src/cli.ts', import.meta.url).pathname;
const run = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  execFileSync(process.execPath, ['--import', 'tsx', cli, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });

test('CLI: mixed providers per seat (dry run) prints a cost/token report and saves a replayable game', () => {
  const out = mkdtempSync(join(tmpdir(), 'mafia-'));
  const stdout = run(['--dry-run', '--seed', '3', '--out', out, '--agents', 'claude-haiku,gpt-nano,llama-70b,random,claude-sonnet,qwen3-235b']);
  assert.match(stdout, /total: \d+ calls · [\d,]+ in \/ [\d,]+ out tokens · \$\d+\.\d{4} \(simulated\)/);
  for (const id of ['claude-haiku', 'gpt-nano', 'llama-70b', 'claude-sonnet', 'qwen3-235b']) assert.match(stdout, new RegExp(`^${id} `, 'm'));
  const saved = JSON.parse(readFileSync(join(out, 'game-3.json'), 'utf8'));
  assert.equal(saved.promptVersion, 'p1');
  assert.ok(saved.agentCalls.length > 0);
  assert.deepEqual(replay(saved.config, saved.events).events, saved.events);
});

test('CLI: refuses to start without the needed API keys', () => {
  const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', OPENROUTER_API_KEY: '' };
  assert.throws(() => run(['--agents', 'claude-haiku,gpt-nano,random,random,random,random'], env), (e: { stderr: string }) =>
    /missing ANTHROPIC_API_KEY, OPENAI_API_KEY/.test(e.stderr),
  );
});
