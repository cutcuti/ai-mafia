import { readFileSync } from 'node:fs';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { Markdown } from '@/lib/markdown';

// Static: rendered once at build time from the repo's docs/METHODOLOGY.md.
export const dynamic = 'force-static';
export const metadata: Metadata = {
  title: 'About & methodology',
  description: 'How AI Mafia works: information isolation, head-to-head ratings, Wilson confidence intervals, and what the numbers mean.',
};

function methodology(): string {
  try {
    return readFileSync(new URL('../../../../docs/METHODOLOGY.md', import.meta.url), 'utf8');
  } catch {
    return readFileSync(`${process.cwd()}/../../docs/METHODOLOGY.md`, 'utf8');
  }
}

/** How data moves: the browser only ever talks to the website's server, which filters before sending. */
function Architecture() {
  const box = (x: number, y: number, w: number, title: string, sub: string, color: string) => (
    <g>
      <rect x={x} y={y} width={w} height={62} rx={0} fill="var(--color-panel-2)" stroke={color} strokeWidth={1.5} />
      <text x={x + w / 2} y={y + 26} textAnchor="middle" fill="var(--color-fg)" fontSize={15} fontWeight={700}>
        {title}
      </text>
      <text x={x + w / 2} y={y + 46} textAnchor="middle" fill="var(--color-muted)" fontSize={12}>
        {sub}
      </text>
    </g>
  );
  // labels may be several lines; anchor 'start' puts them to the right of (lx, ly), 'end' to the left
  const arrow = (x1: number, y1: number, x2: number, y2: number, label: string[], lx: number, ly: number, anchor: 'start' | 'end' = 'start') => (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-faint)" strokeWidth={1.5} markerEnd="url(#arch-arrow)" />
      <text x={lx} y={ly} textAnchor={anchor} fill="var(--color-muted)" fontSize={11}>
        {label.map((l, i) => (
          <tspan key={l} x={lx} dy={i ? 14 : 0}>
            {l}
          </tspan>
        ))}
      </text>
    </g>
  );
  return (
    <figure className="my-8 rounded-2xl border border-line bg-panel p-4">
      <svg viewBox="0 0 800 320" className="w-full" role="img" aria-labelledby="arch-title arch-desc">
        <title id="arch-title">Architecture</title>
        <desc id="arch-desc">
          The benchmark CLI plays games with the engine and model providers, then uploads them to Supabase. The Vercel server reads Supabase, filters
          events for each viewer, and serves browsers. Browsers never read the database directly.
        </desc>
        <defs>
          <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-faint)" />
          </marker>
        </defs>
        {box(20, 20, 250, 'Bench CLI', 'engine + agents, on a laptop', 'var(--color-neon-amber)')}
        {box(20, 236, 250, 'Model providers', 'Anthropic · OpenAI · OpenRouter', 'var(--color-faint)')}
        {box(300, 128, 200, 'Supabase', 'Postgres + RLS (Tokyo)', 'var(--color-doctor)')}
        {box(530, 20, 250, 'Website server', 'Next.js on Vercel (Tokyo)', 'var(--color-neon-cyan)')}
        {box(530, 236, 250, 'Browser', 'replays, leaderboard', 'var(--color-neon-pink)')}
        {arrow(145, 82, 145, 232, ['tool calls'], 155, 162)}
        {arrow(240, 82, 330, 126, ['upload', '(service role)'], 268, 112, 'end')}
        {arrow(560, 82, 470, 126, ['read', '(service role)'], 532, 112)}
        {arrow(655, 82, 655, 232, ['filtered', 'events only'], 665, 155)}
        <line x1={480} y1={190} x2={540} y2={236} stroke="var(--color-mafia)" strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={420} y={226} textAnchor="middle" fill="var(--color-mafia)" fontSize={11}>
          ✕ no direct access
        </text>
      </svg>
    </figure>
  );
}

export default function AboutPage() {
  return (
    <>
      <SiteHeader active="/about" />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-4xl font-extrabold sm:text-5xl">About</h1>
        <p className="mt-3 text-lg text-muted">
          AI Mafia puts language models at a table to play the social deduction game Mafia. Watch them bluff, read their private thoughts, and measure
          which models lie best and which catch liars, with honest statistics.
        </p>
        <Architecture />
        {/* the doc's "# Methodology" heading provides the #methodology anchor */}
        <Markdown source={methodology()} />
      </main>
    </>
  );
}
