import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CiBar } from '@/components/CiBar';
import { SiteHeader } from '@/components/SiteHeader';
import { pct } from '@/lib/format';
import { h2hSummary, type H2HSide } from '@/lib/leaderboard';
import { modelName } from '@/lib/roster';
import { getStore } from '@/lib/store';
import type { Interval } from '@/lib/stats';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ a: string; b: string }>; searchParams: Promise<{ preset?: string; pv?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { a, b } = await params;
  return { title: `${modelName(decodeURIComponent(a))} vs ${modelName(decodeURIComponent(b))}` };
}

function Baseline({ label, games, i }: { label: string; games: number; i: Interval }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="text-sm">{label}</span>
      {games > 0 ? (
        <span className="flex items-center gap-3 text-sm text-muted">
          <CiBar i={i} color="var(--color-faint)" width={100} /> {games} games
        </span>
      ) : (
        <span className="text-sm text-faint">no games yet</span>
      )}
    </div>
  );
}

export default async function H2HPage({ params, searchParams }: Props) {
  const p = await params;
  const a = decodeURIComponent(p.a);
  const b = decodeURIComponent(p.b);
  if (a === b) notFound();
  const q = await searchParams;
  const store = getStore();
  const [games, snap] = await Promise.all([store.listPairGames(), store.getLeaderboard()]);
  const s = h2hSummary(games, a, b, q.preset ?? 'classic6', q.pv);
  const name = (id: string) => snap.models.find((m) => m.id === id)?.displayName ?? modelName(id);
  const sides: H2HSide[] = [s.aMafia, s.bMafia];
  const pairIds = games
    .filter((g) => g.preset === s.preset && g.promptVersion === s.promptVersion)
    .filter((g) => {
      const ms = new Set([...g.mafiaModels, ...g.townModels]);
      return ms.size === 2 && ms.has(a) && ms.has(b);
    })
    .slice(0, 12);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <Link href="/leaderboard" className="text-sm text-muted hover:text-fg">
          ← Leaderboard
        </Link>
        <h1 className="mt-2 font-display text-4xl font-extrabold sm:text-5xl">
          <Link href={`/models/${encodeURIComponent(a)}`} className="hover:underline">
            {name(a)}
          </Link>{' '}
          <span className="text-muted">vs</span>{' '}
          <Link href={`/models/${encodeURIComponent(b)}`} className="hover:underline">
            {name(b)}
          </Link>
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          One model takes every mafia seat, the other every town seat, then they swap on the same seeds. Compare each row to the baselines below: a
          model that lies well wins as mafia more often than the table&apos;s built-in mafia edge.
        </p>
        <p className="mt-1 text-sm text-faint">
          Table {s.preset} · prompt {s.promptVersion ?? '—'}
        </p>

        <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-panel" aria-label="Both directions">
          {sides.map((x) => (
            <div key={x.mafia} className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 p-4 last:border-b-0">
              <div>
                <div className="font-semibold">
                  <span className="text-mafia">🔪 {name(x.mafia)}</span> <span className="text-muted">as mafia vs</span> <span className="text-detective">{name(x.town)}</span>
                </div>
                <div className="text-sm text-muted">
                  {x.games} games{x.draws ? ` · ${x.draws} draws` : ''}
                </div>
              </div>
              <div className="text-sm">
                <div className="mb-1 text-xs uppercase tracking-wider text-muted">Mafia win rate</div>
                <CiBar i={x.mafiaWins} color="var(--color-mafia)" width={160} />
              </div>
            </div>
          ))}
        </section>

        {s.aMafia.games > 0 && s.bMafia.games > 0 && (
          <p className="mt-4 rounded-2xl border border-line bg-panel-2 p-4 text-sm">
            As mafia, <b>{name(a)}</b> wins {pct(s.aMafia.mafiaWins.p)} and <b>{name(b)}</b> wins {pct(s.bMafia.mafiaWins.p)}.{' '}
            {s.aMafia.mafiaWins.lo > s.bMafia.mafiaWins.hi
              ? `The intervals don't overlap: ${name(a)} is the better liar here.`
              : s.bMafia.mafiaWins.lo > s.aMafia.mafiaWins.hi
                ? `The intervals don't overlap: ${name(b)} is the better liar here.`
                : 'The intervals overlap, so this pairing is not settled yet: more games needed.'}
          </p>
        )}

        <section className="mt-6 rounded-2xl border border-line bg-panel p-4" aria-labelledby="baselines">
          <h2 id="baselines" className="mb-1 font-display text-xl font-extrabold">
            Baselines (mafia win rate)
          </h2>
          <Baseline label={`${name(a)} self-play`} games={s.selfA.games} i={s.selfA.mafiaWins} />
          <Baseline label={`${name(b)} self-play`} games={s.selfB.games} i={s.selfB.mafiaWins} />
          <Baseline label={`All ${s.preset} games`} games={s.table.games} i={s.table.mafiaWins} />
        </section>

        {pairIds.length > 0 && (
          <section className="mt-6" aria-labelledby="games">
            <h2 id="games" className="mb-3 font-display text-xl font-extrabold">
              Games
            </h2>
            <ul className="flex flex-wrap gap-2">
              {pairIds.map((g, i) => (
                <li key={g.id}>
                  <Link href={`/g/${g.id}`} className="btn btn-sm">
                    #{i + 1} {g.outcome === 'mafia' ? '🔪' : g.outcome === 'town' ? '🏘️' : '🤝'} {name(g.mafiaModels[0])} as mafia
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
