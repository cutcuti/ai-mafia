import type { Metadata } from 'next';
import Link from 'next/link';
import { PlayForm } from '@/components/play/PlayForm';
import { SignIn } from '@/components/play/SignIn';
import { SiteHeader } from '@/components/SiteHeader';
import { authConfigured, getSessionUser } from '@/lib/auth';
import { getLiveStore } from '@/lib/live/live-store';
import { webModels } from '@/lib/live/models';
import { limitsFromEnv } from '@/lib/live/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Start a live game', description: 'Pick the models, start a live game, and watch the AIs lie in real time.' };

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ auth?: string }> }) {
  const { auth } = await searchParams;
  const user = await getSessionUser();
  const limits = limitsFromEnv();
  let gamesLeft = 0;
  let tired = false;
  if (user) {
    try {
      const store = getLiveStore();
      const [made, spent] = await Promise.all([store.gamesCreatedToday(user.id), store.spendToday()]);
      gamesLeft = Math.max(0, limits.maxGamesPerUserPerDay - made);
      tired = spent >= limits.dailyBudgetUsd;
    } catch {
      gamesLeft = 0;
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-4xl font-extrabold sm:text-5xl">Start a live game</h1>
        <p className="mt-2 text-muted">
          Pick a table and the models. The game runs live while you watch: each turn is a real model call, and you can flip on spectator mode to read
          their thoughts as they happen.
        </p>
        {auth === 'failed' && (
          <p role="alert" className="mt-4 rounded-xl border border-mafia/40 bg-mafia/10 px-3 py-2 text-sm text-mafia">
            Sign-in didn&apos;t complete. Please try again.
          </p>
        )}

        <section className="mt-8 rounded-3xl border border-line bg-panel p-5 sm:p-6">
          {!authConfigured() ? (
            <p className="text-muted">Live games aren&apos;t available here. Watch a <Link href="/" className="underline">replay</Link> instead.</p>
          ) : !user ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-muted">Live games use real AI credit, so you&apos;ll need to sign in first. We only read your public GitHub profile.</p>
              <SignIn />
            </div>
          ) : tired ? (
            <p className="text-lg">
              😴 The AIs are tired for today: the daily budget is spent. Come back tomorrow, or{' '}
              <Link href="/" className="underline">
                watch a replay
              </Link>
              .
            </p>
          ) : (
            <>
              <div className="mb-5 flex items-center justify-between gap-3 text-sm text-muted">
                <span>
                  Signed in as <b className="text-fg">{user.login ?? 'GitHub user'}</b>
                </span>
                <form action="/auth/signout" method="post">
                  <button type="submit" className="underline hover:text-fg">
                    Sign out
                  </button>
                </form>
              </div>
              <PlayForm models={webModels()} gamesLeft={gamesLeft} />
            </>
          )}
        </section>
        <p className="mt-4 text-xs text-faint">
          Limits: {limits.maxGamesPerUserPerDay} games per person per day, a ${limits.dailyBudgetUsd.toFixed(2)} daily budget across everyone, and each
          game stops at ${limits.maxGameCostUsd.toFixed(2)}.
        </p>
      </main>
    </>
  );
}
