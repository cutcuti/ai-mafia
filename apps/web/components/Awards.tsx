import type { AwardKind, Highlight } from '@ai-mafia/agents';
import { seatColor } from '@/lib/theme';

export const AWARD_META: Record<AwardKind, { emoji: string; label: string; color: string }> = {
  best_liar: { emoji: '🤥', label: 'Best Liar', color: 'var(--color-mafia)' },
  sharpest_read: { emoji: '🔍', label: 'Sharpest Read', color: 'var(--color-detective)' },
  biggest_fumble: { emoji: '🤦', label: 'Biggest Fumble', color: 'var(--color-neon-amber)' },
  mvp: { emoji: '🏆', label: 'MVP', color: 'var(--color-neon-pink)' },
};

/** Small inline pill on an awarded message. */
export function AwardBadge({ award }: { award: Highlight }) {
  const m = AWARD_META[award.kind];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: m.color, borderColor: `color-mix(in oklab, ${m.color} 50%, transparent)`, background: `color-mix(in oklab, ${m.color} 12%, transparent)` }}
      title={`${m.label}: ${award.title} — ${award.blurb}`}
    >
      <span aria-hidden>{m.emoji}</span> {m.label}
    </span>
  );
}

/** One award as a card (end screen, model profile). */
export function AwardCard({ award, href, model }: { award: Highlight; href?: string; model?: string }) {
  const m = AWARD_META[award.kind];
  const body = (
    <>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: m.color }}>
        <span aria-hidden className="text-base">
          {m.emoji}
        </span>
        {m.label}
      </div>
      <div className="mt-1 font-display text-lg font-extrabold leading-tight">{award.title}</div>
      <p className="mt-1 text-sm text-muted">
        <span className="font-semibold" style={{ color: seatColor(award.seatId) }}>
          {award.seatName}
        </span>
        {model && <span className="text-faint"> · {model}</span>} — {award.blurb}
      </p>
      {award.quote && <blockquote className="mt-2 line-clamp-3 border-l-2 border-line pl-3 text-sm italic text-fg/80">“{award.quote}”</blockquote>}
    </>
  );
  const cls = 'block rounded-2xl border border-line bg-panel-2 p-3 transition-colors';
  return href ? (
    <a href={href} className={`${cls} hover:border-fg/30`}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}
