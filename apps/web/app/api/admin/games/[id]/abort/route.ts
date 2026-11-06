import { getSessionUser, isAdmin } from '@/lib/auth';
import { abortResponse } from '@/lib/live/admin';
import { getLiveStore } from '@/lib/live/live-store';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getSessionUser();
  return abortResponse(getLiveStore(), id, user, isAdmin(user));
}
