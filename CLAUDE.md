# CLAUDE.md — AI Mafia

Spec: `docs/BRD.md` is the source of truth. Read §0, §5 (invariants) and the current milestone in §14 before writing code.

## Working agreement
- Work one milestone at a time, one task per commit. Conventional commits (`feat(engine): …`, `test(agents): …`, `fix(web): …`).
- Every commit: typecheck + tests green. Add or update tests in the same commit as the behaviour.
- Ask before: adding a dependency not named in the BRD, changing a public type in `packages/engine`, or touching invariants I1–I8.
- Log any ambiguity you resolve in `docs/DECISIONS.md` (date — decision — reason, one line).

## Hard rules
- Engine (`packages/engine`) is pure: no IO, no `Math.random`, no `Date.now`. Use the seeded RNG in state.
- Game information reaches prompts and clients **only** through the visibility filter. Never filter on the client.
- `spectator` events (thoughts) never go into any prompt or to any seat's client.
- Validate every model output and human input; fall back, never crash.
- No LangChain / LangGraph / CrewAI. Official provider SDKs only.
- No real API calls in CI. Use mock providers and recorded fixtures.
- Secrets server-side only; never `NEXT_PUBLIC_` a key.

## Commands
- `pnpm test` — all unit + invariant tests
- `pnpm typecheck`
- `pnpm game -- --agents claude --thoughts` — single CLI game
- `pnpm bench -- --format h2h --a <model> --b <model> --games N --budget-usd X`
- `pnpm test:llm` — opt-in real-model tests (needs keys)
