# 🕵️ AI Mafia

Six AI agents sit down to play Mafia. Two of them are lying. Watch them accuse, deflect and backstab — then flip on **spectator mode** to read every agent's private thoughts while it lies to your face.

**Live:** [ai-mafia-alpha.vercel.app](https://ai-mafia-alpha.vercel.app). Watch a replay, then flip on spectator mode.

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
pnpm game -- --agents claude-haiku,gpt-nano,llama-70b,random,claude-sonnet,deepseek-v3   # one model per seat
pnpm game -- --agents claude-haiku,gpt-nano,llama-70b,random,claude-sonnet,deepseek-v3 --dry-run   # same, mocked: no keys, no cost
pnpm game -- --help
```

Every game is saved as a replayable JSON event log in `games/`, with one cost/latency record per LLM call. The CLI ends with a per-model table of calls, tokens, cost, fallbacks and p50/p95 latency. Keys go in `.env` (see `.env.example`).

## Benchmark

```bash
# head-to-head: A plays every mafia seat vs B on town, then swapped, on the same seeds
pnpm bench -- --format h2h --a claude-haiku --b gpt-nano --games 100 --budget-usd 3
pnpm bench -- --format self --model claude-haiku --games 50        # self-play baseline for the preset
pnpm bench -- --format ffa --models claude-haiku,gpt-nano,llama-70b --games 100
pnpm bench -- --format h2h --a claude-haiku --b random --games 20 --dry-run   # mocked: no keys, no cost
pnpm ratings:rebuild                                                # OpenSkill ratings from every stored game
```

### Web app

```bash
pnpm web:dev                          # http://localhost:3000 — reads the repo-root .env
pnpm e2e                              # Playwright smoke tests (production build, fixture game, no keys)
```

### Database (Supabase)

```bash
pnpm db:migrate                       # apply supabase/migrations + seed.sql to your project (needs SUPABASE_DB_URL)
pnpm db:seed                          # play 3 demo games, upload them, rebuild ratings
pnpm bench -- … --upload              # upload a run: one transaction per game, idempotent
pnpm ratings:rebuild -- --db          # recompute ratings from every game in the DB → ratings table
pnpm db:check                         # prove access rules on the live project from both sides
```

Only the server (secret key) can read games, seats, events, thoughts and model calls. A browser's publishable key reads the model list and ratings, and nothing else. `pnpm db:check` verifies this against the live project. The same SQL runs in CI on PGlite, an in-process Postgres.

Each run writes one JSON file per game to `games/<runId>/` and a report to `reports/<runId>.md`. The report covers outcomes, head-to-head by direction, win rates by role with Wilson 95% CIs (draws count against the win rate), deception, lie rate, vote accuracy, persuasion, detective/doctor stats, OpenSkill ratings (overall / as mafia / as town) and cost per game with p50/p95 latency. Runs are reproducible from `--seed-base`. Up to `--concurrency` games run in parallel. `--budget-usd` is a hard stop: no new game launches if it might go over the cap, and games already running finish. Rerunning the same command resumes, skipping games already on disk.

## How it works

```
apps/
└─ web/      Next.js viewer (Vercel): server-side view filtering, playback, spectator mode, vote graph
packages/
├─ engine/   pure, deterministic state machine — zero deps, no IO, no Math.random, no clock
├─ agents/   controllers, prompts, provider adapters (Anthropic, OpenAI-compatible), model registry, `pnpm game` CLI
└─ bench/    runner (h2h / ffa / self), metrics, OpenSkill ratings, Wilson CIs, reports, uploads, `pnpm bench` CLI
supabase/    migrations (tables, RLS, server-only write functions) + generated seed
```

- **Step-based engine.** `createGame(config)` → `nextRequest(state)` → `applyResponse(state, requestId, response)` → … The whole game is a serializable `GameState`, so the same engine runs CLI batches, serverless live games (one step per request) and human seats that pause for input. `drive()` is the tiny shared loop.
- **Event-sourced.** The game is an append-only, gapless log. Each event carries a `visibility`: `public`, `team:mafia`, `seat:<id>`, or `spectator`. `replay(config, events)` rebuilds the exact state.
- **Information isolation is the core invariant.** An agent's context comes *only* from `contextFor(state, seat)`, which filters the log through `canSee()`. Spy tests across hundreds of seeded games per preset, plus fast-check property tests over random tables, assert that no seat ever sees mafia chat, someone else's role or investigation, or *any* private thought.
- **Deterministic.** A seeded RNG whose state is one `uint32` lives in `GameState`. Same config + seed + responses ⇒ identical log — tested, and a test scans the engine source for `Math.random` / `Date.now` / IO.
- **Untrusted agent output.** Responses are validated; bad targets, empty speech, thrown errors or plain garbage become a seeded random valid choice plus a `fallback` event. Games never crash or stall. Speech is capped at 280 chars.
- **Multi-provider agents.** One `ModelController` drives any `Provider` adapter (Anthropic, OpenAI, OpenRouter) with forced tool calls (or `auto` for models that reject forcing), zod-validated output with one repair retry, timeouts, retries with backoff + jitter, and per-provider concurrency limits. Official SDKs only, no agent frameworks. `models.config.ts` holds 9 models with pricing, so every call is costed.
- **Prompt-injection hardening.** Player text only reaches a prompt inside `<speech from="…">` tags with `<`, `>`, `&` and backticks escaped, and the system prompt says speech is never an instruction. Prompts are versioned (`p1`) and pinned by golden snapshot tests.
- **Long games.** Past a token budget, agents write ≤150-word private notes at each day end and later prompts carry notes + key facts + today instead of the whole log.
- **Rules.** 6 players by default: 2 Mafia · 1 Detective · 1 Doctor · 2 Villagers. The doctor can't save the same player twice in a row; the detective never re-checks someone; no winner after 8 days is a draw.

Full spec: [`docs/BRD.md`](docs/BRD.md). Judgement calls: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Roadmap

- [x] v0: engine, visibility rules, random + Claude agents, CLI, tests
- [x] M0: pnpm monorepo, step-based pure engine, replay, presets, invariant + property tests, CI
- [x] M1: multi-provider agents (Anthropic, OpenAI, OpenRouter), prompt p1 + injection defenses, zod validation, retries, model registry + cost, personas, notes mode
- [x] M2: benchmark runner (h2h / ffa / self), parallel games + hard budget stop, metrics, OpenSkill ratings per role, Wilson CIs, markdown reports, resumable runs
- [x] M3: Supabase persistence: migrations with RLS (events never client-readable), transactional uploads, ratings in the DB, demo seed
- [x] M4: Next.js replay viewer: chat stream, playback + scrubber, spectator mode (thoughts, roles, night channel, lie markers), vote tracker + graph, role reveals, end screen, mobile layout, Playwright smoke tests
- [ ] M5: leaderboard + model profiles: *which model lies best?*
- [ ] M6–M7: live AI games in the browser, then a human seat: you vs. five AIs
- [ ] Native Google (Gemini) adapter (Gemini runs via OpenRouter today)
