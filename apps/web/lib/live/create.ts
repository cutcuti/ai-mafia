import { createGame, createRng, isPreset, makeConfig, PRESET_NAMES, type Controller } from '@ai-mafia/engine';
import type { Limits, LiveStore, SessionUser } from './types';

export interface CreateDeps {
  store: LiveStore;
  limits: Limits;
  /** Model ids allowed for web games right now. */
  allowedModels: string[];
  now: () => Date;
  randomSeed: () => number;
  newId: () => string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** Friendly 429 used when the daily budget is spent (BRD §9.5). */
export const TIRED = 'The AIs are tired for today — the daily budget is spent. Come back tomorrow, or watch a replay!';

/**
 * POST /api/games — start an AI-only live game.
 * Order: auth → rate limits (user + IP) → validate → daily budget → per-user daily cap → create.
 */
export async function createGameResponse(deps: CreateDeps, req: Request, user: SessionUser | null, ip: string): Promise<Response> {
  if (!user) return json({ error: 'Sign in with GitHub to start a game.' }, 401);
  if (!(await deps.store.takeToken(`create:user:${user.id}`, 5, 5 / 3600)) || !(await deps.store.takeToken(`create:ip:${ip}`, 10, 10 / 3600))) {
    return json({ error: 'Slow down — too many games started. Try again later.' }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }
  const b = (body && typeof body === 'object' ? body : {}) as { preset?: unknown; models?: unknown };
  const preset = typeof b.preset === 'string' ? b.preset : 'classic6';
  if (!isPreset(preset)) return json({ error: `preset must be one of ${PRESET_NAMES.join(', ')}` }, 400);
  const models = Array.isArray(b.models) ? [...new Set(b.models.filter((m): m is string => typeof m === 'string'))] : [];
  if (models.length < 1 || models.length > 3) return json({ error: 'Pick 1 to 3 models.' }, 400);
  const bad = models.filter((m) => !deps.allowedModels.includes(m));
  if (bad.length) return json({ error: `Not available for live games: ${bad.join(', ')}` }, 400);

  if ((await deps.store.spendToday()) >= deps.limits.dailyBudgetUsd) return json({ error: TIRED, code: 'daily_budget' }, 429);
  if ((await deps.store.gamesCreatedToday(user.id)) >= deps.limits.maxGamesPerUserPerDay) {
    return json({ error: `You've started ${deps.limits.maxGamesPerUserPerDay} games today — that's the daily limit. Replays are free!`, code: 'user_daily' }, 429);
  }

  const seed = deps.randomSeed() >>> 0;
  const probe = createGame(makeConfig({ seed, preset }));
  const pick = createRng((seed ^ 0x9e3779b9) >>> 0); // independent of the game's own RNG stream
  const controllers: Controller[] = probe.seats.map(() => ({ kind: 'model', modelId: pick.pick(models) }));
  const state = createGame(
    makeConfig({ seed, preset, controllers, gameId: `live-${deps.newId()}`, createdAt: deps.now().toISOString() }),
  );
  const id = await deps.store.createLiveGame(state, user.id);
  return json({ id }, 201);
}
