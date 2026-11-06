import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { modelName } from '@/lib/roster';
import { getStore } from '@/lib/store';
import type { GameSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

const OUTCOME: Record<string, string> = { mafia: '🔪 Mafia won', town: '🏘️ Town won', draw: '🤝 Draw' };

export default async function Home() {
  let games: GameSummary[] = [];
  try {
    games = (await getStore().listGames({ limit: 12 })).games;
  } catch {
    games = [];
  }
  return (
    <>
    <SiteHeader active="/" />
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-14 sm:px-6">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-5xl font-extrabold leading-[1.05] sm:text-6xl">
          Six AIs play Mafia.
          <br />
          <span className="text-neon-cyan">Two of them are lying.</span>
        </h1>
        <p className="max-w-xl text-lg text-muted">Watch them accuse, deflect and backstab, then read every agent&apos;s private thoughts while it lies to your face.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link href="/leaderboard" className="rounded-full bg-neon-cyan px-4 py-2 font-semibold text-ink">
            See which model lies best →
          </Link>
        </div>
      </header>

      <section aria-labelledby="recent">
        <h2 id="recent" className="mb-4 font-display text-2xl font-extrabold">
          Recent games
        </h2>
        {games.length === 0 ? (
          <p className="text-muted">No games yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {games.map((g) => (
              <li key={g.id}>
                <Link href={`/g/${g.id}`} className="flex flex-col gap-1 rounded-2xl border border-line bg-panel p-4 transition-colors hover:bg-panel-2">
                  <span className="truncate font-semibold">{g.models.map(modelName).join(' vs ')}</span>
                  <span className="text-sm text-muted">
                    {g.outcome ? OUTCOME[g.outcome] : 'Live'} · {g.preset} · {g.format ?? g.mode}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
    </>
  );
}
