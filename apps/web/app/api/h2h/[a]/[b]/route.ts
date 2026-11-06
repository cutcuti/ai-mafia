import { h2hResponse } from '@/lib/api';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ a: string; b: string }> }) {
  const { a, b } = await ctx.params;
  return h2hResponse(getStore(), decodeURIComponent(a), decodeURIComponent(b), new URL(req.url));
}
