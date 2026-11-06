import { createModelController } from '@ai-mafia/agents';
import { clientIp } from '@/lib/auth';
import { advanceResponse } from '@/lib/live/advance';
import { getLiveStore } from '@/lib/live/live-store';
import { realtimeNotifier } from '@/lib/live/notify';
import { limitsFromEnv } from '@/lib/live/types';

export const dynamic = 'force-dynamic';
// one model turn incl. one retry fits comfortably; the step lease (75s) outlives it
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return advanceResponse(
    {
      store: getLiveStore(),
      limits: limitsFromEnv(),
      // web turns: shorter timeout and one retry so a step always finishes inside the function's time limit
      makeResponder: (modelId, onCall) => createModelController(modelId, { onCall, reliability: { timeoutMs: 20_000, retries: 1 } }),
      notify: realtimeNotifier(),
    },
    id,
    new URL(req.url),
    {}, // human seats + auth for seat view arrive in M7
    await clientIp(),
  );
}
