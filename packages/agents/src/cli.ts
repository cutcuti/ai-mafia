import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createGame, drive, makeConfig } from '@ai-mafia/engine';
import type { Controller, GameEvent, GameState, Responder } from '@ai-mafia/engine';
import { ClaudeController } from './claude.js';
import { RandomController } from './random.js';

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
const seatKinds = values.agents!.includes(',') ? values.agents!.split(',') : Array<string>(6).fill(values.agents!);
const controllers: Controller[] = seatKinds.map((k) => (k === 'claude' ? { kind: 'model', modelId: values.model! } : { kind: 'random' }));
const config = makeConfig({ seed, controllers, rounds: Number(values.rounds), createdAt: new Date().toISOString() });
let state = createGame(config);

const responders = new Map<string, Responder>(
  state.seats.map((s, i) => [s.id, s.controller.kind === 'model' ? new ClaudeController(s.controller.modelId) : new RandomController(seed * 1000 + i)]),
);

const c = { dim: '\x1b[2m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m' };
const name = (id?: string) => state.seats.find((s) => s.id === id)?.name ?? '?';
function print(e: GameEvent) {
  const v = e.visibility.kind;
  if (v === 'spectator' && !values.thoughts) return;
  if (v === 'seat' || v === 'team') {
    if (!values.thoughts) return; // hidden info is spectator-only in the CLI too
    const who = e.type === 'mafia_chat' ? `(mafia chat) ${name(e.actorSeatId)}: ` : '';
    return console.log(`${c.red}  🔒 ${who}${e.text}${c.reset}`);
  }
  switch (e.type) {
    case 'phase':
      return console.log(`\n${c.bold}${c.cyan}── ${e.text}${c.reset}`);
    case 'speech':
      return console.log(`${c.bold}${name(e.actorSeatId)}:${c.reset} ${e.text}`);
    case 'thought':
      return console.log(`${c.dim}   💭 ${name(e.actorSeatId)}: ${e.text}${c.reset}`);
    case 'fallback':
      return console.log(`${c.dim}   ⚠️  ${e.text}${c.reset}`);
    case 'death':
    case 'eliminated':
    case 'game_over':
      return console.log(`${c.yellow}${c.bold}${e.text}${c.reset}`);
    default:
      return console.log(`${c.dim}${e.text}${c.reset}`);
  }
}

let printed = 0;
const flush = (s: GameState) => {
  state = s;
  for (; printed < s.events.length; printed++) print(s.events[printed]);
};

console.log(`${c.bold}AI MAFIA${c.reset}  seed=${seed}  seats=${state.seats.map((s) => `${s.name}:${s.controller.kind === 'model' ? s.controller.modelId : s.controller.kind}`).join(' ')}`);
flush(state);
const result = await drive(state, responders, { onState: flush });

mkdirSync(values.out!, { recursive: true });
const file = `${values.out}/game-${seed}.json`;
writeFileSync(file, JSON.stringify({ config, outcome: result.outcome, seats: result.seats, events: result.events }, null, 2));
console.log(`\nSaved replay → ${file}`);
