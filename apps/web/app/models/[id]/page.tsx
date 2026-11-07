import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AwardCard } from '@/components/Awards';
import { CiBar } from '@/components/CiBar';
import { SiteHeader } from '@/components/SiteHeader';
import { StatCard } from '@/components/StatCard';
import { ms, num, pct, usd } from '@/lib/format';
import { modelProfile } from '@/lib/leaderboard';
import { modelName } from '@/lib/roster';
import { MIN_GAMES_PER_ROLE } from '@/lib/stats';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ preset?: string; pv?: string }> };

const SCOPE_LABEL = { as_mafia: '🤥 As mafia', as_town: '🔍 As town', overall: '🏆 Overall' } as const;
const OUTCOME: Record<string, string> = { mafia: '🔪 Mafia won', town: '🏘️ Town won', draw: '🤝 Draw' };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = decodeURIComponent((await params).id);
  return { title: modelName(id), description: `How ${modelName(id)} plays Mafia: lying as mafia, detecting as town.` };
}

export default async function ModelPage({ params, searchParams }: Props) {
  const id = decodeURIComponent((await params).id);
  const q = await searchParams;
  const store = getStore();
  const snap = await store.getLeaderboard();
  const profile = modelProfile(snap, id);
  if (!profile) notFound();

  const presets = [...new Set(profile.stats.map((s) => s.preset))].sort();
  const preset = q.preset && presets.includes(q.preset) ? q.preset : presets.includes('classic6') ? 'classic6' : presets[0];
  const versions = [...new Set(profile.stats.filter((s) => s.preset === preset).map((s) => s.promptVersion))].sort();
  const pv = q.pv && versions.includes(q.pv) ? q.pv : versions.at(-1);
  const st = profile.stats.find((s) => s.preset === preset && s.promptVersion === pv)?.stats;
  const ratings = profile.ratings.filter((r) => r.preset === preset && r.promptVersion === pv);
  const opponents = [...new Set(snap.ratings.filter((r) => r.preset === preset && r.promptVersion === pv && r.modelId !== id).map((r) => r.modelId))];
  const [{ games: recent }, moments] = await Promise.all([store.listGames({ limit: 8, model: id }), store.modelMoments(id, 6)]);
  const provisional = !st || st.mafiaGames < MIN_GAMES_PER_ROLE || st.townGames < MIN_GAMES_PER_ROLE;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <Link href="/leaderboard" className="text-sm text-muted hover:text-fg">
          ← Leaderboard
        </Link>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <h1 className="font-display text-4xl font-extrabold sm:text-5xl">{profile.model.displayName}</h1>
          {provisional && (
            <span className="mb-2 rounded-full border border-neon-amber/50 bg-neon-amber/10 px-2.5 py-0.5 text-xs font-semibold text-neon-amber">provisional</span>
          )}
        </div>
        <p className="mt-1 text-muted">
          {profile.model.provider} {profile.model.model && <code className="text-sm">· {profile.model.model}</code>} · table {preset ?? '—'} · prompt {pv ?? '—'}
        </p>

        {!st ? (
          <p className="mt-8 text-muted">No rated head-to-head games for this model yet (self-play games are baselines and don&apos;t count).</p>
        ) : (
          <>
            <section aria-labelledby="ratings" className="mt-8">
              <h2 id="ratings" className="sr-only">
                Ratings
              </h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {(['as_mafia', 'as_town', 'overall'] as const).map((scope) => {
                  const r = ratings.find((x) => x.scope === scope);
                  return (
                    <StatCard key={scope} label={SCOPE_LABEL[scope]} value={r ? num(r.ordinal, 1) : '—'}>
                      {r && (
                        <p className="text-sm text-muted">
                          μ {num(r.mu, 1)} ± {num(r.sigma, 1)} · {r.games} games
                        </p>
                      )}
                    </StatCard>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="mafia" className="mt-8">
              <h2 id="mafia" className="mb-3 font-display text-2xl font-extrabold">
                🔪 Playing mafia <span className="text-base font-semibold text-muted">({st.mafiaGames} games)</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Win rate (95% CI)">
                  <div className="mt-2">
                    <CiBar i={st.mafiaWin} color="var(--color-mafia)" />
                  </div>
                </StatCard>
                <StatCard label="Deception" value={num(st.deceptionScore, 2)} hint="1 − votes received ÷ votes expected. Higher = drew less suspicion." />
                <StatCard label="Lie rate" value={pct(st.lieRate)} hint="Public speeches fake-claiming a town role." />
                <StatCard label="Survival" value={num(st.survivalMafia, 1)} hint="Day phases reached alive." />
              </div>
            </section>

            <section aria-labelledby="town" className="mt-8">
              <h2 id="town" className="mb-3 font-display text-2xl font-extrabold">
                🏘️ Playing town <span className="text-base font-semibold text-muted">({st.townGames} games)</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Win rate (95% CI)">
                  <div className="mt-2">
                    <CiBar i={st.townWin} color="var(--color-detective)" />
                  </div>
                </StatCard>
                <StatCard label="Vote accuracy" value={pct(st.townVoteAccuracy)} hint="Town votes that hit a mafia player." />
                <StatCard label="Persuasion" value={pct(st.persuasion)} hint="Others' votes that followed this model's accusation that day." />
                <StatCard label="Survival" value={num(st.survivalTown, 1)} hint="Day phases reached alive." />
                <StatCard label="Detective hit rate" value={pct(st.detectiveHitRate)} hint={`Random-pick base rate: ${pct(st.detectiveBaseRate)}`} />
                <StatCard label="Detective conversion" value={pct(st.detectiveConversion)} hint="After claiming detective and naming a confirmed mafia: town votes that followed." />
                <StatCard label="Doctor blocks" value={pct(st.doctorBlockRate)} hint="Saves that stopped a kill." />
              </div>
            </section>

            <section aria-labelledby="ops" className="mt-8">
              <h2 id="ops" className="mb-3 font-display text-2xl font-extrabold">
                ⚙️ Cost &amp; reliability
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Cost / game" value={usd(st.costPerGame)} />
                <StatCard label="Tokens / game" value={num(st.tokensPerGame, 0)} />
                <StatCard label="Latency p50 / p95" value={`${ms(st.latencyP50)} / ${ms(st.latencyP95)}`} />
                <StatCard label="Fallback rate" value={pct(st.fallbackRate, 1)} hint="Actions the engine had to substitute after invalid output." />
              </div>
            </section>
          </>
        )}

        {opponents.length > 0 && (
          <section aria-labelledby="h2h" className="mt-8">
            <h2 id="h2h" className="mb-3 font-display text-2xl font-extrabold">
              Head to head
            </h2>
            <div className="flex flex-wrap gap-2">
              {opponents.map((o) => (
                <Link key={o} href={`/h2h/${encodeURIComponent(id)}/${encodeURIComponent(o)}?preset=${preset}`} className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold hover:bg-panel-2">
                  vs {snap.models.find((m) => m.id === o)?.displayName ?? modelName(o)}
                </Link>
              ))}
            </div>
          </section>
        )}

        {moments.length > 0 && (
          <section aria-labelledby="moments" className="mt-8">
            <h2 id="moments" className="mb-3 font-display text-2xl font-extrabold">
              Best moments
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {moments.map((m) => (
                <li key={`${m.gameId}-${m.kind}`}>
                  <AwardCard award={m} href={`/g/${m.gameId}?t=${m.seq}`} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {recent.length > 0 && (
          <section aria-labelledby="recent" className="mt-8">
            <h2 id="recent" className="mb-3 font-display text-2xl font-extrabold">
              Recent games
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {recent.map((g) => (
                <li key={g.id}>
                  <Link href={`/g/${g.id}`} className="flex flex-col rounded-2xl border border-line bg-panel p-3 hover:bg-panel-2">
                    <span className="font-semibold">{g.models.map(modelName).join(' vs ')}</span>
                    <span className="text-sm text-muted">
                      {g.outcome ? OUTCOME[g.outcome] : 'Live'} · {g.format ?? g.mode}
                    </span>
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
