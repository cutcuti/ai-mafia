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
pnpm test                                      # engine + information-isolation tests
pnpm game -- --seed 7                     # free: random agents
pnpm game -- --agents claude --thoughts   # real game, spectator mode (needs ANTHROPIC_API_KEY)
pnpm game -- --agents claude,random,claude,random,claude,random   # mix seats
```

Every game is saved as a replayable JSON event log in `games/`.

## How it works

- **Event-sourced engine.** The game is an append-only log of events. Each event carries a `visibility`: `public`, `team:mafia`, `player:<id>`, or `spectator`.
- **Information isolation is the core invariant.** An agent's context is built *only* by filtering the log through `canSee()`. Tests run hundreds of games with spy agents and assert no player ever receives an event it shouldn't (mafia chat, detective results, other agents' thoughts).
- **Structured agent output.** Claude agents use forced tool use, so every turn returns `{ thought, speech }` or `{ thought, target }` with the target constrained to valid options. Invalid output falls back safely instead of crashing the game.
- **Replays for free.** Because the log is the source of truth, the spectator UI is just a log player.

Roles (6 players): 2 Mafia · 1 Detective · 1 Doctor · 2 Villagers.

## Roadmap

- [x] Engine, visibility rules, random + Claude agents, CLI, tests
- [ ] Batch runner: N games per model mix → `stats.json`
- [ ] Metrics: mafia win rate, detective hit rate, vote accuracy, "deception score" (mafia votes received)
- [ ] Leaderboard: Elo per model per role — *which model lies best?*
- [ ] More providers (OpenAI, Gemini, open models via an OpenAI-compatible endpoint)
- [ ] Next.js spectator UI: replay viewer with thought toggle, role reveals, vote graph
- [ ] Live games streamed to the browser
- [ ] Human seat: you vs. five AIs
- [ ] Memory across days (agent-written notes instead of the full transcript)
