import { ogGame } from '@/lib/og';
import { renderGameCard } from '@/lib/og-render';
import { getStore } from '@/lib/store';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const d = await ogGame(getStore(), (await ctx.params).id);
  return d ? renderGameCard(d) : new Response('not found', { status: 404 });
}
