import { getSessionUser } from '@/lib/auth';
import { inputResponse } from '@/lib/live/input';
import { getLiveStore } from '@/lib/live/live-store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inputResponse(getLiveStore(), id, req, await getSessionUser());
}
