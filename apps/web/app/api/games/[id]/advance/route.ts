import { createModelController, dryRunProvider } from '@ai-mafia/agents';
import { clientIp } from '@/lib/auth';
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
    },
    id,
    new URL(req.url),
    {}, // human seats + auth for seat view arrive in M7
    await clientIp(),
  );
}
