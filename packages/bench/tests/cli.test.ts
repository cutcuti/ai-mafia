import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const cli = new URL('../src/cli.ts', import.meta.url).pathname;
const run = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  execFileSync(process.execPath, ['--import', 'tsx', cli, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });

test('M2 done-when: pnpm bench --format h2h produces a report with win rates, CIs, ratings and cost', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-cli-'));
  const out = join(dir, 'games');
  const reports = join(dir, 'reports');
  const stdout = run(['--format', 'h2h', '--a', 'claude-haiku', '--b', 'gpt-nano', '--games', '6', '--budget-usd', '5', '--dry-run', '--out', out, '--reports', reports]);
  assert.match(stdout, /claude-haiku\s+mafia \d+\.\d% \[/);
  const [file] = readdirSync(reports);
  const md = readFileSync(join(reports, file), 'utf8');
  assert.match(md, /## Win rates by role/);
  assert.match(md, /\d+\.\d% \[\d+\.\d%–\d+\.\d%\] \(n=3\)/, 'Wilson CI');
  assert.match(md, /## Ratings \(OpenSkill/);
  assert.match(md, /\| overall \| (claude-haiku|gpt-nano) \|/);
  assert.match(md, /Total cost \$\d+\.\d{4}/);
  assert.equal(readdirSync(join(out, readdirSync(out)[0])).length, 6);
  // second invocation resumes instead of re-playing
  assert.match(run(['--format', 'h2h', '--a', 'claude-haiku', '--b', 'gpt-nano', '--games', '6', '--dry-run', '--out', out, '--reports', reports]), /resumed: 6 games/);
});

test('bench CLI refuses to start without needed keys, and on bad options', () => {
  const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', OPENROUTER_API_KEY: '' };
  assert.throws(() => run(['--format', 'h2h', '--a', 'claude-haiku', '--b', 'gpt-nano', '--games', '2'], env), (e: { stderr: string }) => /missing ANTHROPIC_API_KEY, OPENROUTER_API_KEY/.test(e.stderr));
  assert.throws(() => run(['--format', 'h2h', '--a', 'claude-haiku', '--b', 'random', '--games', '3', '--dry-run']), (e: { stderr: string }) => /even/.test(e.stderr));
  assert.throws(() => run(['--format', 'nope']), (e: { stderr: string }) => /--format must be/.test(e.stderr));
  const noDb = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' };
  assert.throws(() => run(['--format', 'self', '--model', 'random', '--games', '1', '--upload'], noDb), (e: { stderr: string }) => /SUPABASE_SERVICE_ROLE_KEY/.test(e.stderr));
});
