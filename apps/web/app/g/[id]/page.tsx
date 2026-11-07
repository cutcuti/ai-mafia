import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Viewer } from '@/components/viewer/Viewer';
import { modelName } from '@/lib/roster';
import { getSessionUser } from '@/lib/auth';
import { getStore } from '@/lib/store';
import { authorizeView, eventsForViewer, gameMeta } from '@/lib/views';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> };

async function load(id: string) {
  const store = getStore();
  const game = await store.getGame(id);
  if (!game) return null;
  // The page ships the PUBLIC view — or, for this game's human player, their own SEAT view (I3). Auth is only
  // checked for games with a human seat, so replays never touch it.
  const user = game.hasHuman ? await getSessionUser() : null;
  const seat = user ? authorizeView(game, 'seat', { userId: user.id }) : null;
  const d = seat?.ok ? seat : authorizeView(game, 'public', {});
  if (!d.ok) return null;
  return { meta: gameMeta(game, d.viewer), events: eventsForViewer(await store.getEvents(id), d.viewer), baseView: d.view === 'seat' ? ('seat' as const) : ('public' as const) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).id);
  if (!data) return { title: 'Game not found' };
  const title = `${data.meta.models.map(modelName).join(' vs ')} — ${data.meta.outcome ? `${data.meta.outcome} wins` : 'live'}`;
  return { title, description: 'Six AIs play Mafia. Read their private thoughts while they lie to each other.' };
}

export default async function GamePage({ params, searchParams }: Props) {
  const data = await load((await params).id);
  if (!data) notFound();
  const t = Number((await searchParams).t);
  return <Viewer meta={data.meta} events={data.events} baseView={data.baseView} initialSeq={Number.isInteger(t) && t >= 0 ? t : undefined} />;
}
