import { listGamesResponse } from '@/lib/api';
import { clientIp, getSessionUser } from '@/lib/auth';
import { createGameResponse } from '@/lib/live/create';
import { getLiveStore } from '@/lib/live/live-store';
import { webModels } from '@/lib/live/models';
import { limitsFromEnv } from '@/lib/live/types';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return listGamesResponse(getStore(), new URL(req.url));
}

/** Start an AI-only live game (signed in, rate-limited, budget-checked). */
export async function POST(req: Request) {
  return createGameResponse(
    {
      store: getLiveStore(),
      limits: limitsFromEnv(),
      allowedModels: webModels().map((m) => m.id),
      now: () => new Date(),
      randomSeed: () => crypto.getRandomValues(new Uint32Array(1))[0],
      newId: () => crypto.randomUUID(),
    },
    req,
    await getSessionUser(),
    await clientIp(),
  );
}
