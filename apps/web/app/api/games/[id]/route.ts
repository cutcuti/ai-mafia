import { gameResponse } from '@/lib/api';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return gameResponse(getStore(), id, new URL(req.url), {}); // auth arrives in M7
}
