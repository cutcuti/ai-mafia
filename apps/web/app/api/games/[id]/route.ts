import { gameResponse } from '@/lib/api';
import { viewerId } from '@/lib/guest';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return gameResponse(getStore(), id, new URL(req.url), new URL(req.url).searchParams.get('view') === 'seat' ? { userId: await viewerId() } : {});
}
