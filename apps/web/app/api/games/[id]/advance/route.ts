import { after } from 'next/server';
import { createModelController, defaultProvider, dryRunProvider, getModel } from '@ai-mafia/agents';
import { dryRunJudge, judgeFinishedGame, modelJudge } from '@/lib/live/judge';
import { clientIp } from '@/lib/auth';
import { viewerId } from '@/lib/guest';
import { fixtureMode } from '@/lib/devmode';
import { advanceResponse } from '@/lib/live/advance';
import { getLiveStore } from '@/lib/live/live-store';
import { realtimeNotifier } from '@/lib/live/notify';
import { limitsFromEnv } from '@/lib/live/types';

export const dynamic = 'force-dynamic';
// one model turn incl. one retry fits comfortably; the step lease (75s) outlives it
export const maxDuration = 60;

// offline dev/e2e only: mocked models, no API calls (requires fixture mode, so never in production)
const mocked = () => fixtureMode() && process.env.MAFIA_DRY_RUN === '1';

/** Auth is only needed for the seat view; skip the Supabase round trip otherwise. */
async function callerFor(req: Request) {
  return new URL(req.url).searchParams.get('view') === 'seat' ? { userId: await viewerId() } : {};
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return advanceResponse(
    {
      store: getLiveStore(),
      limits: limitsFromEnv(),
      // web turns: shorter timeout and one retry so a step always finishes inside the function's time limit
      makeResponder: (modelId, onCall) =>
        createModelController(modelId, {
          onCall,
          reliability: { timeoutMs: 20_000, retries: 1 },
          ...(mocked() ? { makeProvider: (spec) => dryRunProvider(spec, Math.floor(Math.random() * 1e9)) } : {}),
        }),
      notify: mocked() ? undefined : realtimeNotifier(),
      // post-game awards: one cheap Haiku call, after the response is sent (BRD §10.6)
      onFinished: (gameId, state) =>
        after(() => judgeFinishedGame(getLiveStore(), gameId, state, mocked() ? dryRunJudge : modelJudge(defaultProvider(getModel('claude-haiku')), getModel('claude-haiku')))),
    },
    id,
    new URL(req.url),
    await callerFor(req),
    await clientIp(),
  );
}
