import { ogMoment } from '@/lib/og';
import { renderMomentCard } from '@/lib/og-render';
import { getStore } from '@/lib/store';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; seq: string }> }) {
  const { id, seq } = await ctx.params;
  const d = await ogMoment(getStore(), id, Number(seq));
  return d ? renderMomentCard(d) : new Response('not found', { status: 404 });
}
