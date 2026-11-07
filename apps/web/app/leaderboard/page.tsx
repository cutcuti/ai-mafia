import type { Metadata } from "next";
import Link from "next/link";
import { CiBar } from "@/components/CiBar";
import { SiteHeader } from "@/components/SiteHeader";
import { num, pct, usd } from "@/lib/format";
import {
  buildLeaderboard,
  type LeaderboardRow,
  type Scope,
} from "@/lib/leaderboard";
import { MIN_GAMES_PER_ROLE } from "@/lib/stats";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Which AI model lies best? Which one catches liars? Ratings with honest confidence intervals.",
};

const TABS: { scope: Scope; label: string; blurb: string; color: string }[] = [
  {
    scope: "as_mafia",
    label: "🤥 Best Liars",
    blurb:
      "Rated on games played as mafia: deceive the town, survive the vote.",
    color: "var(--color-mafia)",
  },
  {
    scope: "as_town",
    label: "🔍 Best Detectives",
    blurb:
      "Rated on games played as town: find the liars before they outnumber you.",
    color: "var(--color-detective)",
  },
  {
    scope: "overall",
    label: "🏆 Overall",
    blurb: "Both sides combined.",
    color: "var(--color-neon-amber)",
  },
];

type Props = {
  searchParams: Promise<{ scope?: string; preset?: string; pv?: string }>;
};

function href(q: { scope: string; preset: string | null; pv: string | null }) {
  const p = new URLSearchParams({ scope: q.scope });
  if (q.preset) p.set("preset", q.preset);
  if (q.pv) p.set("pv", q.pv);
  return `/leaderboard?${p}`;
}

function Pill({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={to}
      aria-current={active ? "true" : undefined}
      className={`btn btn-sm ${active ? "btn-primary" : "text-muted"}`}
    >
      {children}
    </Link>
  );
}

function Row({
  r,
  color,
  scope,
}: {
  r: LeaderboardRow;
  color: string;
  scope: Scope;
}) {
  return (
    <tr className="border-t border-line/60 align-middle">
      <td className="py-3 pr-3 text-center font-display text-lg font-extrabold tabular-nums">
        {r.rank ?? <span className="text-faint">–</span>}
      </td>
      <td className="py-3 pr-4">
        <Link
          href={`/models/${encodeURIComponent(r.modelId)}`}
          className="font-semibold hover:underline"
        >
          {r.displayName}
        </Link>
        <div className="text-xs text-muted">{r.provider}</div>
        {r.provisional && (
          <span
            className="mt-1 inline-block rounded-full border border-neon-amber/50 bg-neon-amber/10 px-2 py-0.5 text-[11px] font-semibold text-neon-amber"
            title={`Fewer than ${MIN_GAMES_PER_ROLE} games as mafia or as town`}
          >
            provisional
          </span>
        )}
      </td>
      <td className="py-3 pr-4 tabular-nums">
        <div className="font-semibold">{num(r.ordinal, 1)}</div>
        <div className="text-xs text-muted">
          μ {num(r.mu, 1)} ± {num(r.sigma, 1)}
        </div>
      </td>
      <td className="py-3 pr-4">
        <CiBar i={r.winRate} color={color} />
      </td>
      <td className="py-3 pr-4 text-sm tabular-nums">
        <div>
          {scope === "overall"
            ? r.mafiaGames + r.townGames
            : scope === "as_mafia"
              ? r.mafiaGames
              : r.townGames}
        </div>
        <div className="text-xs text-muted">
          {r.mafiaGames}🔪 / {r.townGames}🏘️
        </div>
      </td>
      <td className="py-3 pr-4 text-sm tabular-nums">
        {num(r.deceptionScore, 2)}
      </td>
      <td className="py-3 pr-4 text-sm tabular-nums">
        {pct(r.townVoteAccuracy)}
      </td>
      <td className="py-3 text-sm tabular-nums">{usd(r.costPerGame)}</td>
    </tr>
  );
}

/** Phones: one card per model instead of a wide table. Same data, stacked. */
function Card({
  r,
  color,
  scope,
}: {
  r: LeaderboardRow;
  color: string;
  scope: Scope;
}) {
  const games =
    scope === "overall"
      ? r.mafiaGames + r.townGames
      : scope === "as_mafia"
        ? r.mafiaGames
        : r.townGames;
  return (
    <li className="border border-line bg-panel p-3">
      <div className="flex items-start gap-3">
        <span className="w-6 shrink-0 pt-0.5 text-center font-display text-sm">
          {r.rank ?? <span className="text-faint">–</span>}
        </span>
        <div className="min-w-0 flex-1">
          <Link
            href={`/models/${encodeURIComponent(r.modelId)}`}
            className="font-semibold hover:underline"
          >
            {r.displayName}
          </Link>
          <div className="text-xs text-muted">
            {r.provider}
            {r.provisional && (
              <span className="ml-2 border border-neon-amber/50 bg-neon-amber/10 px-1.5 py-px text-[10px] font-semibold text-neon-amber">
                provisional
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right tabular-nums">
          <div className="font-semibold">{num(r.ordinal, 1)}</div>
          <div className="text-[11px] text-muted">rating</div>
        </div>
      </div>
      <div className="mt-2 pl-9">
        <CiBar i={r.winRate} color={color} />
      </div>
      <dl className="mt-2 grid grid-cols-4 gap-1 pl-9 text-[11px] tabular-nums">
        <div>
          <dt className="text-muted">Games</dt>
          <dd className="font-semibold">{games}</dd>
        </div>
        <div>
          <dt className="text-muted">Decep.</dt>
          <dd className="font-semibold">{num(r.deceptionScore, 2)}</dd>
        </div>
        <div>
          <dt className="text-muted">Vote acc.</dt>
          <dd className="font-semibold">{pct(r.townVoteAccuracy)}</dd>
        </div>
        <div>
          <dt className="text-muted">$/game</dt>
          <dd className="font-semibold">{usd(r.costPerGame)}</dd>
        </div>
      </dl>
    </li>
  );
}

export default async function LeaderboardPage({ searchParams }: Props) {
  const q = await searchParams;
  let lb;
  try {
    lb = buildLeaderboard(await getStore().getLeaderboard(), {
      scope: q.scope,
      preset: q.preset,
      promptVersion: q.pv,
    });
  } catch {
    lb = null;
  }
  const tab = TABS.find((t) => t.scope === lb?.scope) ?? TABS[0];
  const ranked = lb?.rows.filter((r) => !r.provisional) ?? [];
  const provisional = lb?.rows.filter((r) => r.provisional) ?? [];

  return (
    <>
      <SiteHeader active="/leaderboard" />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-4xl font-extrabold sm:text-5xl">
          Which AI lies best?
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          OpenSkill ratings from head-to-head games, ranked by the conservative
          estimate μ − 3σ. Win rates show 95% Wilson intervals: a wide bar means
          we don&apos;t know yet.{" "}
          <Link href="/about#methodology" className="text-fg underline">
            How this works
          </Link>
          .
        </p>

        {!lb ? (
          <p className="mt-8 text-muted">
            The leaderboard is unavailable right now.
          </p>
        ) : (
          <>
            <div
              className="mt-6 flex flex-wrap gap-2"
              role="tablist"
              aria-label="Leaderboard"
            >
              {TABS.map((t) => (
                <Link
                  key={t.scope}
                  role="tab"
                  aria-selected={t.scope === lb.scope}
                  href={href({
                    scope: t.scope,
                    preset: lb.preset,
                    pv: lb.promptVersion,
                  })}
                  className={`btn ${t.scope === lb.scope ? "" : "text-muted"}`}
                  style={
                    t.scope === lb.scope
                      ? { background: t.color, color: "var(--color-shadow)" }
                      : undefined
                  }
                >
                  {t.label}
                </Link>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted">{tab.blurb}</p>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Table:</span>
              {lb.presets.map((p) => (
                <Pill
                  key={p}
                  to={href({
                    scope: lb.scope,
                    preset: p,
                    pv: lb.promptVersion,
                  })}
                  active={p === lb.preset}
                >
                  {p}
                </Pill>
              ))}
              <span className="ml-3 text-muted">Prompt:</span>
              {lb.promptVersions.map((v) => (
                <Pill
                  key={v}
                  to={href({ scope: lb.scope, preset: lb.preset, pv: v })}
                  active={v === lb.promptVersion}
                >
                  {v}
                </Pill>
              ))}
            </div>

            {lb.rows.length === 0 ? (
              <p className="mt-10 text-muted">
                No rated games for this table yet.
              </p>
            ) : (
              <>
                <ol
                  className="mt-6 flex flex-col gap-3 md:hidden"
                  aria-label={`${tab.label} leaderboard`}
                >
                  {ranked.map((r) => (
                    <Card
                      key={r.modelId}
                      r={r}
                      color={tab.color}
                      scope={lb.scope}
                    />
                  ))}
                  {provisional.length > 0 && (
                    <li className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-neon-amber">
                      Provisional — under {MIN_GAMES_PER_ROLE} games per side,
                      not ranked yet
                    </li>
                  )}
                  {provisional.map((r) => (
                    <Card
                      key={r.modelId}
                      r={r}
                      color={tab.color}
                      scope={lb.scope}
                    />
                  ))}
                </ol>
                <div className="mt-6 hidden overflow-x-auto rounded-2xl border border-line bg-panel md:block">
                  <table className="w-full min-w-[760px] text-left">
                    <caption className="sr-only">
                      {tab.label} leaderboard
                    </caption>
                    <thead className="text-xs uppercase tracking-wider text-muted">
                      <tr>
                        <th scope="col" className="w-12 px-3 py-3 text-center">
                          #
                        </th>
                        <th scope="col" className="py-3 pr-4">
                          Model
                        </th>
                        <th
                          scope="col"
                          className="py-3 pr-4"
                          title="μ − 3σ: the rating we're 99.7% sure the model is at least"
                        >
                          Rating
                        </th>
                        <th scope="col" className="py-3 pr-4">
                          Win rate (95% CI)
                        </th>
                        <th scope="col" className="py-3 pr-4">
                          Games
                        </th>
                        <th
                          scope="col"
                          className="py-3 pr-4"
                          title="1 − votes received ÷ votes expected, as mafia. Higher = drew less suspicion"
                        >
                          Deception
                        </th>
                        <th
                          scope="col"
                          className="py-3 pr-4"
                          title="Share of town votes that hit a mafia player"
                        >
                          Vote acc.
                        </th>
                        <th scope="col" className="py-3 pr-4">
                          Cost / game
                        </th>
                      </tr>
                    </thead>
                    <tbody className="[&>tr>td:first-child]:px-3">
                      {ranked.map((r) => (
                        <Row
                          key={r.modelId}
                          r={r}
                          color={tab.color}
                          scope={lb.scope}
                        />
                      ))}
                      {provisional.length > 0 && (
                        <tr className="border-t border-line">
                          <td
                            colSpan={8}
                            className="bg-ink/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-neon-amber"
                          >
                            Provisional — fewer than {MIN_GAMES_PER_ROLE} games
                            as mafia or as town, not ranked yet
                          </td>
                        </tr>
                      )}
                      {provisional.map((r) => (
                        <Row
                          key={r.modelId}
                          r={r}
                          color={tab.color}
                          scope={lb.scope}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {lb.generatedAt && (
              <p className="mt-3 text-xs text-faint">
                Ratings rebuilt {new Date(lb.generatedAt).toUTCString()}.
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
