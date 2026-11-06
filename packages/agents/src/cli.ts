import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Game, createPlayers, makeRng } from '@ai-mafia/engine';
import type { Agent, V0Event } from '@ai-mafia/engine';
import { ClaudeAgent } from './claude.js';
import { RandomAgent } from './random.js';

const { values } = parseArgs({
  // `pnpm game -- --x` forwards the literal `--`; drop it so flags still parse.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    agents: { type: 'string', default: 'random' }, // "random" | "claude" | comma list per seat, e.g. "claude,random,..."
    model: { type: 'string', default: process.env.MAFIA_MODEL ?? 'claude-haiku-5-5' },
    seed: { type: 'string', default: String(Date.now() % 100000) },
    thoughts: { type: 'boolean', default: false }, // spectator mode: show private thoughts
    rounds: { type: 'string', default: '2' },
    out: { type: 'string', default: 'games' },
  },
});

const seed = Number(values.seed);
const rng = makeRng(seed);
const seatKinds = values.agents!.includes(',') ? values.agents!.split(',') : Array(6).fill(values.agents);
const models = seatKinds.map((k) => (k === 'claude' ? values.model! : 'random'));
const players = createPlayers(rng, models);

const agents = new Map<string, Agent>();
for (const p of players) {
  agents.set(p.id, p.model === 'random' ? new RandomAgent(makeRng(seed + p.id.length)) : new ClaudeAgent(p.model));
}

const c = { dim: '\x1b[2m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m' };
function print(e: V0Event) {
  const v = e.visibility.kind;
  if (v === 'spectator' && !values.thoughts) return;
  if (v === 'player' || v === 'team') {
    if (!values.thoughts) return; // hidden info is spectator-only in the CLI too
    const who = e.type === 'mafia_chat' ? `(mafia chat) ${e.actor}: ` : '';
    return console.log(`${c.red}  🔒 ${who}${e.text}${c.reset}`);
  }
  switch (e.type) {
    case 'phase':
      return console.log(`\n${c.bold}${c.cyan}── ${e.text}${c.reset}`);
    case 'speech':
      return console.log(`${c.bold}${e.actor}:${c.reset} ${e.text}`);
    case 'thought':
      return console.log(`${c.dim}   💭 ${e.actor}: ${e.text}${c.reset}`);
    case 'death':
    case 'eliminated':
    case 'game_over':
      return console.log(`${c.yellow}${c.bold}${e.text}${c.reset}`);
    default:
      return console.log(`${c.dim}${e.text}${c.reset}`);
  }
}

console.log(`${c.bold}AI MAFIA${c.reset}  seed=${seed}  seats=${players.map((p) => `${p.id}:${p.model}`).join(' ')}`);
const result = await new Game(players, agents, rng, { onEvent: print, discussionRounds: Number(values.rounds) }).run();

mkdirSync(values.out!, { recursive: true });
const file = `${values.out}/game-${seed}.json`;
writeFileSync(file, JSON.stringify({ seed, ...result }, null, 2));
console.log(`\nSaved replay → ${file}`);
