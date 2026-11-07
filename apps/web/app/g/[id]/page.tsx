import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Viewer } from '@/components/viewer/Viewer';
import { modelName } from '@/lib/roster';
import { viewerId } from '@/lib/guest';
import { getStore } from '@/lib/store';
import { authorizeView, eventsForViewer, gameMeta, highlightsFor } from '@/lib/views';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> };

async function load(id: string) {
  const store = getStore();
  const game = await store.getGame(id);
  if (!game) return null;
  // The page ships the PUBLIC view — or, for this game's human player, their own SEAT view (I3). Auth is only
  // checked for games with a human seat, so replays never touch it.
  const me = game.hasHuman ? await viewerId() : undefined;
  const seat = me ? authorizeView(game, 'seat', { userId: me }) : null;
  const d = seat?.ok ? seat : authorizeView(game, 'public', {});
  if (!d.ok) return null;
  const [events, highlights] = await Promise.all([store.getEvents(id), game.status === 'finished' ? store.getHighlights(id) : []]);
  return { meta: gameMeta(game, d.viewer), events: eventsForViewer(events, d.viewer), highlights: highlightsFor(game, highlights), baseView: d.view === 'seat' ? ('seat' as const) : ('public' as const) };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const id = (await params).id;
  const data = await load(id);
  if (!data) return { title: 'Game not found' };
  const title = `${data.meta.models.map(modelName).join(' vs ')} — ${data.meta.outcome ? `${data.meta.outcome} wins` : 'live'}`;
  const description = 'Six AIs play Mafia. Read their private thoughts while they lie to each other.';
  // ?t=<seq> on a public speech → that message's card ("share this moment"); otherwise the game card
  const t = Number((await searchParams).t);
  const moment = Number.isInteger(t) ? data.events.find((e) => e.seq === t && e.type === 'speech') : undefined;
  const image = moment ? `/api/og/moment/${id}/${t}` : `/api/og/game/${id}`;
  const og = { title, description, images: [{ url: image, width: 1200, height: 630 }] };
  return { title, description, openGraph: og, twitter: { card: 'summary_large_image', ...og } };
}

export default async function GamePage({ params, searchParams }: Props) {
  const data = await load((await params).id);
  if (!data) notFound();
  const t = Number((await searchParams).t);
  return <Viewer meta={data.meta} events={data.events} baseView={data.baseView} highlights={data.highlights} initialSeq={Number.isInteger(t) && t >= 0 ? t : undefined} />;
}
