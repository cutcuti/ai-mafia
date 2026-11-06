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
