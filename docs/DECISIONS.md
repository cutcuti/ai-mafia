# Decisions

One line each: date — decision — reason.

- 2026-11-06 — Test runner is `node:test` (via tsx) for all packages — v0 already used it; BRD says pick one and stick with it.
- 2026-11-06 — Workspace packages export TS source directly (`exports: ./src/index.ts`), no build step — tsx runs it, tsc typechecks it; simplest for M0.
- 2026-11-06 — CLI lives in `packages/agents/src/cli.ts` until `packages/bench` exists — it needs both engine and agents.
- 2026-11-06 — Engine tests use their own random responder (`tests/helpers.ts`) — engine must not depend on agents.
- 2026-11-06 — Queue request steps store `{seatId, ask}`, not a full InputRequest — BRD's `{kind:'request', ...InputRequest}` collides on `kind`, and options/ids must be computed when the step reaches the head (alive set changes).
- 2026-11-06 — `GameConfig.createdAt` is supplied by the caller and stamped on every event — engine may not read the clock (I4); DB `created_at` still records insert time.
- 2026-11-06 — `AgentContext` gains `roster` (seatId↔name, public via game_start) — controllers need it to map names to seat ids at the boundary.
- 2026-11-06 — `drive()` and the `Responder` interface live in the engine (`drive.ts`) — driver has no IO itself; agents' controllers satisfy `Responder` structurally.
- 2026-11-06 — A throwing responder is turned into an empty response by `drive()` so the engine's normal fallback path handles it (I5) — one fallback code path.
- 2026-11-06 — Thought events are emitted right after the action they explain (`replyToSeq` = action seq); fallback events right before it.
- 2026-11-06 — Speech is trimmed then hard-cut to `maxSpeechChars` (no ellipsis), flagged `payload.truncated`.
- 2026-11-06 — `replay()` re-executes the engine, re-feeding each step's response recovered from the log (raw output from `fallback` events; truncated speech padded by one char) and verifies every event matches — rngState and queue can't be derived any other way.
- 2026-11-06 — `makeConfig` with `roles` but no `preset` yields preset 'custom'; a named preset must match its role table exactly — presets stay meaningful for leaderboard filtering.
- 2026-11-06 — Notes (§7.8) are a `notes` event with `seat` visibility (author only), requested by the engine at day end — BRD said "spectator", which contradicts I2 since notes feed later prompts; approved by Protik.
- 2026-11-06 — Engine public types gain optional `GameConfig.personaMode` and a `notes` request kind / event type — approved by Protik; additive, old configs/logs stay valid.
- 2026-11-06 — Invalid optional speak fields (`accuses`, `claimRole`) are dropped, not fatal; only missing/invalid `speech`/`target` trigger the repair retry — a wrong optional tag shouldn't cost a call. The engine's fallback `rawOutput` is the controller's final response; the model's raw output goes to agent-call logs (§7.7).
- 2026-11-06 — Provider fixtures are hand-written to the documented response shapes (no key available to record real ones); replace with recorded responses when `pnpm test:llm` first runs.
- 2026-11-06 — OpenAI-compatible adapter uses Chat Completions (not Responses API) — it's what OpenRouter and most open-model hosts speak.
- 2026-11-06 — Claude Opus 5.5 / Sonnet 5.5 / Fable 5.1 return 400 on forced `tool_choice`; those registry entries use `toolChoice: 'auto'` + an explicit 'call the tool' instruction, with zod validation + repair retry as the safety net. Haiku 5.5 keeps forced tools.
- 2026-11-06 — Non-Anthropic prices come from OpenRouter's public /models list (OpenAI direct assumed equal to OpenRouter pass-through); Gemini runs via OpenRouter until a Google adapter exists. AgentCall records are emitted per provider attempt (a repair retry is its own call).
- 2026-11-06 — Notes-mode trigger uses a char/4 token estimate of a seat's visible log (engine stays pure, no tokenizer); once any seat crosses the budget, all living seats write notes every remaining day end. Notes-mode prompts keep key facts (setup, own role/team, deaths) plus the current day.
- 2026-11-06 — `--games` is the total game count; for h2h it must be even (games/2 seeds, each played both ways) — matches "≥100 games per pairing" in G2.
- 2026-11-06 — h2h seats models by role using a role-only probe of the seed (roles never depend on controllers); ffa draws seat models from an RNG stream independent of the game's own.
- 2026-11-06 — `random` is a valid bench model id — free baseline and what CI benches with.
- 2026-11-06 — Budget guard: one probe game always runs; before any game finishes the expected cost is a registry-price prior (8 calls/seat × 2.5k in / 300 out tokens), after that the observed average; in-flight games count as committed spend and workers wait (not stop) while estimates may still improve.
- 2026-11-06 — Win records count one trial per (model, game, team), not per seat — otherwise h2h would double n and shrink CIs dishonestly.
- 2026-11-06 — Deception expected votes = Σ over vote days of (other voters ÷ (voters − 1)) (uniform random voting ⇒ ≈1 per day alive); score can go negative for heavily suspected mafia.
- 2026-11-06 — Survival = day phases a seat reached alive. Detective base rate = mafia share of the engine's actual candidate pool (fresh alive others). Persuasion uses a seat's last accusation of the day. Lie = mafia public speech claiming any non-mafia role. Rates are pooled (Σnum/Σden); deception and survival are means.
- 2026-11-06 — Ratings: each game is mafia-team vs town-team. 'overall' uses one pool per model; as_mafia/as_town use separate pools (a model's mafia rating is played against opponents' town ratings). A model filling several slots gets the average of its slot updates. Local rebuild writes ratings.json until M3 adds the DB.
- 2026-11-06 — Resume key is the game file `<out>/<runId>/<gameId>.json` (valid schema-1 record); the default run id is derived from the options, so rerunning the same command resumes. Budget counts only the current invocation's spend; resumed games feed the cost estimate. M3 swaps the file check for 'already in DB'.
- 2026-11-06 — Database: a hosted Supabase project (Protik's choice). CI tests the real migrations on PGlite (in-process Postgres; dev-only dependency, approved), with Supabase's roles and default grants stubbed in.
- 2026-11-06 — `games.external_id` (unique) stores the engine/bench game id; uploads are idempotent on it, and it is what "skip seeds already in DB" keys on. Not in BRD §9.2.
- 2026-11-06 — RLS is stricter than BRD §9.2. Every table has RLS on. Only `models` and `ratings` are publicly readable. games/seats/events/agent_calls/highlights have no policies and no table grants for anon/authenticated, since seats leak roles and games.state holds the full log. All of it is served through API routes (I3).
- 2026-11-06 — Multi-table writes are plpgsql functions (`upload_game`, `replace_ratings`) called over RPC: one call is one transaction, because supabase-js has no client transactions. They execute as the service role only. upload_game rejects seq gaps (I7).
- 2026-11-06 — Bench --upload runs after the run finishes and uploads every record of the run (resumed ones included; upload is idempotent), one transaction per game; failures are listed and exit code 2, they never lose local data. Resume stays local-file based. replay() now compares events key-order-insensitively because jsonb reorders object keys.
- 2026-11-06 — supabase/seed.sql is generated from the model registry (a test fails on drift). db:seed plays demo self-play games (run id 'demo', or 'demo-dry' if mocked), uploads them and rebuilds ratings. Migrations are applied with the pinned official Supabase CLI via npx (`supabase db push --db-url --include-seed`); no Docker needed.
