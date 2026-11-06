import type { Metadata } from 'next';
import Link from 'next/link';
import { AbortButton } from '@/components/admin/AbortButton';
import { SignIn } from '@/components/play/SignIn';
import { SiteHeader } from '@/components/SiteHeader';
import { StatCard } from '@/components/StatCard';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { usd } from '@/lib/format';
import { getLiveStore } from '@/lib/live/live-store';
import { limitsFromEnv } from '@/lib/live/types';
import { modelName } from '@/lib/roster';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
          <h1 className="font-display text-3xl font-extrabold">Admin</h1>
          {!user ? (
            <div className="mt-4 flex flex-col items-start gap-3">
              <p className="text-muted">Sign in to continue.</p>
              <SignIn next="/admin" />
            </div>
          ) : (
            <p className="mt-4 text-muted">
              Not authorized. Your GitHub id is <code className="rounded bg-panel-2 px-1.5 py-0.5 text-fg">{user.githubId ?? 'unknown'}</code>. To get access,
              add it to the <code className="rounded bg-panel-2 px-1.5 py-0.5">ADMIN_GITHUB_IDS</code> environment variable on the server.
            </p>
          )}
        </main>
      </>
    );
  }

  const store = getLiveStore();
  const limits = limitsFromEnv();
  const [spent, active, fallbacks] = await Promise.all([store.spendToday(), store.listActive(25), store.recentFallbacks(20)]);
  const pctUsed = limits.dailyBudgetUsd > 0 ? Math.min(1, spent / limits.dailyBudgetUsd) : 1;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-4xl font-extrabold">Admin</h1>
        <p className="mt-1 text-sm text-muted">Signed in as {user.login} · limits from server env</p>

        <section className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="Spend">
          <StatCard label="Spent today (UTC)" value={usd(spent)} hint={`of ${usd(limits.dailyBudgetUsd)} daily budget`}>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pctUsed * 100)} aria-label="Daily budget used">
              <div className={`h-full rounded-full ${pctUsed >= 1 ? 'bg-mafia' : pctUsed > 0.8 ? 'bg-neon-amber' : 'bg-doctor'}`} style={{ width: `${pctUsed * 100}%` }} />
            </div>
          </StatCard>
          <StatCard label="Per-game cap" value={usd(limits.maxGameCostUsd)} />
          <StatCard label="Games / user / day" value={String(limits.maxGamesPerUserPerDay)} />
        </section>

        <section className="mt-8" aria-labelledby="active">
          <h2 id="active" className="mb-3 font-display text-2xl font-extrabold">
            Live games ({active.length})
          </h2>
          {active.length === 0 ? (
            <p className="text-muted">Nothing running.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line bg-panel">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-3 py-2">Game</th>
                    <th className="py-2 pr-3">Models</th>
                    <th className="py-2 pr-3">Where</th>
                    <th className="py-2 pr-3">Cost</th>
                    <th className="py-2 pr-3">Started</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {active.map((g) => (
                    <tr key={g.id} className="border-t border-line/60">
                      <td className="px-3 py-2">
                        <Link href={`/g/${g.id}`} className="font-mono text-xs underline">
                          {g.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{[...new Set(g.state.config.controllers.map((c) => (c.kind === 'model' ? c.modelId : c.kind)))].map(modelName).join(', ')}</td>
                      <td className="py-2 pr-3">
                        {g.state.phase} · day {g.state.day} · v{g.version}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{usd(g.costUsd)}</td>
                      <td className="py-2 pr-3 text-muted">{new Date(g.createdAt).toUTCString().slice(5, 22)}</td>
                      <td className="py-2 pr-3 text-right">
                        <AbortButton id={g.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-8" aria-labelledby="fallbacks">
          <h2 id="fallbacks" className="mb-3 font-display text-2xl font-extrabold">
            Recent fallbacks
          </h2>
          {fallbacks.length === 0 ? (
            <p className="text-muted">No fallbacks — every model answer was valid.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {fallbacks.map((f) => (
                <li key={`${f.gameId}-${f.seq}`} className="rounded-2xl border border-line bg-panel p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/g/${f.gameId}?t=${f.seq}`} className="font-mono text-xs underline">
                      {f.gameId.slice(0, 8)}#{f.seq}
                    </Link>
                    <span className="font-semibold">{f.reason}</span>
                    <span className="text-muted">{f.text}</span>
                  </div>
                  <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-ink p-2 text-xs text-muted">{JSON.stringify(f.rawOutput, null, 2)}</pre>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
