'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { modelName, type RosterSeat } from '@/lib/roster';
import { seatColor } from '@/lib/theme';
import type { Outcome, Role } from '@ai-mafia/engine';
import { RevealCard } from './RevealCard';

const BANNER: Record<Outcome, { title: string; sub: string; color: string; emoji: string }> = {
  mafia: { title: 'Mafia wins', sub: 'The liars outlasted the town.', color: 'var(--color-mafia)', emoji: '🔪' },
  town: { title: 'Town wins', sub: 'Every mafia member was caught.', color: 'var(--color-detective)', emoji: '🏘️' },
  draw: { title: 'Draw', sub: 'Nobody won before the clock ran out.', color: 'var(--color-neon-amber)', emoji: '🤝' },
};

export interface EndScreenProps {
  outcome: Outcome;
  seats: RosterSeat[];
  roles: ReadonlyMap<string, Role>;
  alive: Set<string>;
  shareUrl: string;
  spectator: boolean;
  onClose: () => void;
  onReplay: () => void;
  onSpectator: () => void;
}

/** Full reveal at game over: outcome banner, every role and model, share buttons (BRD §10.3). */
export function EndScreen({ outcome, seats, roles, alive, shareUrl, spectator, onClose, onReplay, onSpectator }: EndScreenProps) {
  const reduce = useReducedMotion();
  const b = BANNER[outcome];
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mafiaFirst = [...seats].sort((a, b2) => Number(roles.get(b2.seatId) === 'mafia') - Number(roles.get(a.seatId) === 'mafia'));
  const tweet = `I just watched ${seats.length} AIs play Mafia — ${b.title.toLowerCase()}. Read their private thoughts while they lie to each other:`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="end-title" onClick={onClose}>
      <motion.div
        className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-3xl border border-line bg-panel p-5 shadow-2xl sm:p-7"
        initial={reduce ? false : { opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Game over</p>
            <h2 id="end-title" className="mt-1 font-display text-4xl font-extrabold" style={{ color: b.color }}>
              {b.emoji} {b.title}
            </h2>
            <p className="mt-1 text-muted">{b.sub}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-full px-2 py-1 text-muted hover:text-fg" aria-label="Close results">
            ✕
          </button>
        </div>

        <ul className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {mafiaFirst.map((s, i) => {
            const role = roles.get(s.seatId);
            return (
              <motion.li
                key={s.seatId}
                className={`flex items-center gap-2 rounded-2xl border p-2 ${role === 'mafia' ? 'border-mafia/50 bg-mafia/10' : 'border-line bg-panel-2'}`}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduce ? 0 : 0.1 + i * 0.06 }}
              >
                {role && <RevealCard role={role} size={28} />}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Avatar seatId={s.seatId} name={s.name} seed={s.avatarSeed} size={18} dead={!alive.has(s.seatId)} />
                    <span className="truncate text-sm font-semibold" style={{ color: seatColor(s.seatId) }}>
                      {s.name}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-muted">
                    {alive.has(s.seatId) ? '' : '💀 '}
                    {s.modelId ? modelName(s.modelId) : ''}
                  </div>
                </div>
              </motion.li>
            );
          })}
        </ul>

        {!spectator && (
          <button type="button" onClick={onSpectator} className="mt-5 w-full rounded-2xl border border-neon-pink/60 bg-neon-pink/10 px-4 py-3 text-left font-semibold text-neon-pink">
            👁️ Rewatch with spectator mode — see what they were really thinking
          </button>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(shareUrl);
              setCopied(true);
            }}
            className="rounded-full bg-fg px-4 py-2 text-sm font-semibold text-ink"
          >
            {copied ? '✓ Link copied' : '🔗 Copy link'}
          </button>
          <a
            href={`https://x.com/intent/post?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(shareUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-panel-2"
          >
            Share on X
          </a>
          <button type="button" onClick={onReplay} className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-panel-2">
            ↺ Watch again
          </button>
        </div>
      </motion.div>
    </div>
  );
}
