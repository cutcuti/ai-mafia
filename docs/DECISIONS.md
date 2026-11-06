# Decisions

One line each: date — decision — reason.

- 2026-11-06 — Test runner is `node:test` (via tsx) for all packages — v0 already used it; BRD says pick one and stick with it.
- 2026-11-06 — Workspace packages export TS source directly (`exports: ./src/index.ts`), no build step — tsx runs it, tsc typechecks it; simplest for M0.
- 2026-11-06 — CLI lives in `packages/agents/src/cli.ts` until `packages/bench` exists — it needs both engine and agents.
- 2026-11-06 — Engine tests use their own random responder (`tests/helpers.ts`) — engine must not depend on agents.
