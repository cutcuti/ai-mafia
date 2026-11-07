import { createGame, createRng, isPreset, makeConfig, PRESET_NAMES, type Controller } from '@ai-mafia/engine';
import type { Limits, LiveStore, SessionUser } from './types';

export interface CreateDeps {
  store: LiveStore;
  limits: Limits;
  /** Model ids allowed for web games right now. */
  allowedModels: string[];
  /** Model ids a guest (no login) may use — a cheaper subset of allowedModels. */
  guestModels?: string[];
  now: () => Date;
  randomSeed: () => number;
  newId: () => string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** Guests share a smaller slice of the daily budget; signed-in players can still use the rest. */
export const GUEST_TIRED = 'Guest games are used up for today. Sign in with GitHub to keep playing, or watch a replay!';

/** Friendly 429 used when the daily budget is spent (BRD §9.5). */
export const TIRED = 'The AIs are tired for today — the daily budget is spent. Come back tomorrow, or watch a replay!';

/**
 * POST /api/games — start an AI-only live game, signed in or as a guest.
 * Order: identity → hourly rate limits (player + IP) → validate → daily budget → daily per-player caps → create.
 * Guests (guestId from an httpOnly cookie) get cheaper models, a smaller share of the daily budget, and daily caps
 * per guest id and per IP (clearing cookies mints a new guest id, the IP cap still holds).
 */
export async function createGameResponse(deps: CreateDeps, req: Request, user: SessionUser | null, ip: string, guestId: string | null = null): Promise<Response> {
  const guest = !user && !!guestId && deps.limits.guestsEnabled !== false;
  const playerId = user?.id ?? (guest ? guestId! : null);
  if (!playerId) return json({ error: 'Sign in with GitHub to start a game.' }, 401);
  const perUser = deps.limits.createPerUserPerHour ?? 5;
  const perIp = deps.limits.createPerIpPerHour ?? 10;
  if (!(await deps.store.takeToken(`create:user:${playerId}`, perUser, perUser / 3600)) || !(await deps.store.takeToken(`create:ip:${ip}`, perIp, perIp / 3600))) {
    return json({ error: 'Slow down — too many games started. Try again later.' }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }
  const b = (body && typeof body === 'object' ? body : {}) as { preset?: unknown; models?: unknown; humanSeat?: unknown };
  const preset = typeof b.preset === 'string' ? b.preset : 'classic6';
  if (!isPreset(preset)) return json({ error: `preset must be one of ${PRESET_NAMES.join(', ')}` }, 400);
  const models = Array.isArray(b.models) ? [...new Set(b.models.filter((m): m is string => typeof m === 'string'))] : [];
  if (models.length < 1 || models.length > 3) return json({ error: 'Pick 1 to 3 models.' }, 400);
  const bad = models.filter((m) => !deps.allowedModels.includes(m));
  if (bad.length) return json({ error: `Not available for live games: ${bad.join(', ')}` }, 400);
  if (guest) {
    const signInOnly = models.filter((m) => !(deps.guestModels ?? []).includes(m));
    if (signInOnly.length) return json({ error: `Sign in with GitHub to use ${signInOnly.join(', ')}.`, code: 'sign_in_model' }, 403);
  }

  const spent = await deps.store.spendToday();
  if (spent >= deps.limits.dailyBudgetUsd) return json({ error: TIRED, code: 'daily_budget' }, 429);
  if (guest) {
    if (spent >= (deps.limits.guestDailyBudgetUsd ?? 1)) return json({ error: GUEST_TIRED, code: 'guest_budget' }, 429);
    const perDay = deps.limits.guestGamesPerDay ?? 2;
    const perIpDay = deps.limits.guestGamesPerIpPerDay ?? 4;
    // rolling-day token buckets: a guest has no auth.users row, so the games table can't count for them
    if (!(await deps.store.takeToken(`day:guest:${playerId}`, perDay, perDay / 86400)) || !(await deps.store.takeToken(`day:guest-ip:${ip}`, perIpDay, perIpDay / 86400))) {
      return json({ error: `Guests get ${perDay} games a day. Sign in with GitHub for more — replays are always free!`, code: 'guest_daily' }, 429);
    }
  } else if ((await deps.store.gamesCreatedToday(playerId)) >= deps.limits.maxGamesPerUserPerDay) {
    return json({ error: `You've started ${deps.limits.maxGamesPerUserPerDay} games today — that's the daily limit. Replays are free!`, code: 'user_daily' }, 429);
  }

  const seed = deps.randomSeed() >>> 0;
  const probe = createGame(makeConfig({ seed, preset }));
  const pick = createRng((seed ^ 0x9e3779b9) >>> 0); // independent of the game's own RNG stream
  const controllers: Controller[] = probe.seats.map(() => ({ kind: 'model', modelId: pick.pick(models) }));
  // "you vs the AIs": one random seat is the player's; AIs are not told which (BRD §10.4)
  if (b.humanSeat === true) controllers[Math.floor(pick.next() * controllers.length)] = { kind: 'human', userId: playerId };
  const state = createGame(
    makeConfig({ seed, preset, controllers, gameId: `live-${deps.newId()}`, createdAt: deps.now().toISOString() }),
  );
  const id = await deps.store.createLiveGame(state, guest ? null : playerId);
  return json({ id }, 201);
}
