import { highlightsResponse } from '@/lib/api';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return highlightsResponse(getStore(), (await ctx.params).id);
}
