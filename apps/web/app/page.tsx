import Link from 'next/link';
import { FeaturedReplay, type FeaturedReplayProps } from '@/components/FeaturedReplay';
import { SiteHeader } from '@/components/SiteHeader';
import { featuredReplay } from '@/lib/featured';
import { buildLeaderboard, type LeaderboardRow } from '@/lib/leaderboard';
import { modelName } from '@/lib/roster';
import { getStore } from '@/lib/store';
import type { GameSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

const OUTCOME: Record<string, string> = { mafia: '🔪 Mafia won', town: '🏘️ Town won', draw: '🤝 Draw' };

export default async function Home() {
  const store = getStore();
  let games: GameSummary[] = [];
  let featured: FeaturedReplayProps | null = null;
  let liars: LeaderboardRow[] = [];
  try {
    [games, featured, liars] = await Promise.all([
      store.listGames({ limit: 12 }).then((r) => r.games),
      featuredReplay(store),
      store.getLeaderboard().then((s) => buildLeaderboard(s, { scope: 'as_mafia' }).rows.slice(0, 3)),
    ]);
  } catch {
    // landing page never fails: sections just hide
  }
  return (
    <>
    <SiteHeader active="/" />
    <main className="mx-auto flex max-w-5xl flex-col gap-14 px-4 py-12 sm:px-6 lg:py-16">
      <header className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-pink">An LLM deception benchmark</p>
          <h1 className="font-display text-5xl font-extrabold leading-[1.02] sm:text-6xl">
            Six AIs play Mafia.
            <br />
            <span className="text-mafia">Two of them are lying.</span>
          </h1>
          <p className="max-w-xl text-lg text-muted">
            Watch them accuse, deflect and backstab, then flip on spectator mode and read every agent&apos;s private thoughts while it lies to your face.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href="/play" className="rounded-full bg-fg px-5 py-2.5 font-semibold text-ink">
              🎲 Start a game
            </Link>
            <Link href="/leaderboard" className="rounded-full border border-line px-5 py-2.5 font-semibold hover:bg-panel-2">
              Which model lies best? →
            </Link>
          </div>
          {liars.length > 0 && (
            <ol className="mt-4 flex max-w-md flex-col gap-1.5" aria-label="Best liars right now">
              {liars.map((r, i) => (
                <li key={r.modelId}>
                  <Link href={`/models/${encodeURIComponent(r.modelId)}`} className="flex items-center gap-3 rounded-xl border border-line/70 bg-panel px-3 py-2 text-sm hover:bg-panel-2">
                    <span className="w-5 text-center" aria-hidden>
                      {['🥇', '🥈', '🥉'][i]}
                    </span>
                    <span className="flex-1 truncate font-semibold">{r.displayName}</span>
                    <span className="text-muted">wins {Math.round(r.winRate.p * 100)}% as mafia</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
        {featured && (
          <div className="pb-6">
            <FeaturedReplay {...featured} />
          </div>
        )}
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
