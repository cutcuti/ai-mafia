import { listGamesResponse } from '@/lib/api';
import { clientIp, getSessionUser } from '@/lib/auth';
import { ensureGuestId } from '@/lib/guest';
import { createGameResponse } from '@/lib/live/create';
import { getLiveStore } from '@/lib/live/live-store';
import { webModels } from '@/lib/live/models';
import { limitsFromEnv } from '@/lib/live/types';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return listGamesResponse(getStore(), new URL(req.url));
}

/** Start a live game (signed in or as a guest; rate-limited, budget-checked). */
export async function POST(req: Request) {
  const limits = limitsFromEnv();
  const user = await getSessionUser();
  // no login → guest id from (or newly set in) an httpOnly cookie
  const guestId = !user && limits.guestsEnabled ? await ensureGuestId() : null;
  return createGameResponse(
    {
      store: getLiveStore(),
      limits,
      allowedModels: webModels().map((m) => m.id),
      guestModels: webModels(process.env, { guest: true }).map((m) => m.id),
      now: () => new Date(),
      randomSeed: () => crypto.getRandomValues(new Uint32Array(1))[0],
      newId: () => crypto.randomUUID(),
    },
    req,
    user,
    await clientIp(),
    guestId,
  );
}
