# 🕵️ AI Mafia

Six AI agents sit down to play Mafia. Two of them are lying. Watch them accuse, deflect and backstab — then flip on **spectator mode** to read every agent's private thoughts while it lies to your face.

```
── Day 2. Discuss. Alive: Zara, Omar, Priya, Leo, Kai
Kai:   ngl Omar defending Leo that hard is sus
   💭 Kai: I'm mafia. Leo is my teammate — I need to throw Omar under the bus before the detective gets to me.
Omar:  bro I literally saved— never mind.
```

## Run it

```bash
pnpm install
pnpm test                                     # engine invariants + agents (no API calls)
pnpm typecheck
pnpm game -- --seed 7                         # free: random agents
pnpm game -- --preset big8 --thoughts         # presets: classic6 (default), mini5, big8
pnpm game -- --agents claude --thoughts       # real game, spectator mode (needs ANTHROPIC_API_KEY in .env)
pnpm game -- --agents claude,random,claude,random,claude,random   # mix seats
```

Every game is saved as a replayable JSON event log in `games/`.

## How it works

```
packages/
├─ engine/   pure, deterministic state machine — zero deps, no IO, no Math.random, no clock
└─ agents/   controllers (random, Claude) + prompts; the CLI lives here until packages/bench exists
```

- **Step-based engine.** `createGame(config)` → `nextRequest(state)` → `applyResponse(state, requestId, response)` → … The whole game is a serializable `GameState`, so the same engine runs CLI batches, serverless live games (one step per request) and human seats that pause for input. `drive()` is the tiny shared loop.
- **Event-sourced.** The game is an append-only, gapless log. Each event carries a `visibility`: `public`, `team:mafia`, `seat:<id>`, or `spectator`. `replay(config, events)` rebuilds the exact state.
- **Information isolation is the core invariant.** An agent's context comes *only* from `contextFor(state, seat)`, which filters the log through `canSee()`. Spy tests across hundreds of seeded games per preset, plus fast-check property tests over random tables, assert that no seat ever sees mafia chat, someone else's role or investigation, or *any* private thought.
- **Deterministic.** A seeded RNG whose state is one `uint32` lives in `GameState`. Same config + seed + responses ⇒ identical log — tested, and a test scans the engine source for `Math.random` / `Date.now` / IO.
- **Untrusted agent output.** Responses are validated; bad targets, empty speech, thrown errors or plain garbage become a seeded random valid choice plus a `fallback` event. Games never crash or stall. Speech is capped at 280 chars.
- **Rules.** 6 players by default: 2 Mafia · 1 Detective · 1 Doctor · 2 Villagers. The doctor can't save the same player twice in a row; the detective never re-checks someone; no winner after 8 days is a draw.

Full spec: [`docs/BRD.md`](docs/BRD.md). Judgement calls: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Roadmap

- [x] v0: engine, visibility rules, random + Claude agents, CLI, tests
- [x] M0: pnpm monorepo, step-based pure engine, replay, presets, invariant + property tests, CI
- [ ] Batch runner: N games per model mix → `stats.json`
- [ ] Metrics: mafia win rate, detective hit rate, vote accuracy, "deception score" (mafia votes received)
- [ ] Leaderboard: Elo per model per role — *which model lies best?*
- [ ] More providers (OpenAI, Gemini, open models via an OpenAI-compatible endpoint)
- [ ] Next.js spectator UI: replay viewer with thought toggle, role reveals, vote graph
- [ ] Live games streamed to the browser
- [ ] Human seat: you vs. five AIs
- [ ] Memory across days (agent-written notes instead of the full transcript)
