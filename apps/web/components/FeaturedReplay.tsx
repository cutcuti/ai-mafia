'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { seatColor } from '@/lib/theme';

export interface FeaturedLine {
  seq: number;
  kind: 'speech' | 'banner' | 'system';
  seatId?: string;
  text: string;
}

export interface FeaturedReplayProps {
  gameId: string;
  title: string;
  seats: { seatId: string; name: string; avatarSeed: string }[];
  /** Public events only, already filtered on the server. */
  lines: FeaturedLine[];
}

const VISIBLE = 7;

/** Auto-playing, looping preview of a real game's public chat, in a phone frame. No spoilers: public view only. */
export function FeaturedReplay({ gameId, title, seats, lines }: FeaturedReplayProps) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? Math.min(VISIBLE, lines.length) : 1);
  const [hover, setHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (reduce || hover || !lines.length) return;
    const cur = lines[(n - 1) % lines.length];
    const delay = n >= lines.length ? 4000 : cur.kind === 'speech' ? Math.min(3200, 900 + cur.text.length * 18) : 1400;
    timer.current = setTimeout(() => setN((x) => (x >= lines.length ? 1 : x + 1)), delay);
    return () => clearTimeout(timer.current);
  }, [n, hover, reduce, lines]);

  const seat = new Map(seats.map((s) => [s.seatId, s]));
  const shown = lines.slice(Math.max(0, n - VISIBLE), n);
  const last = shown.at(-1);

  return (
    <div className="relative mx-auto w-full max-w-[360px]" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="rounded-[2.6rem] border border-line bg-panel p-2.5 shadow-[0_30px_80px_-20px_rgba(255,79,163,0.35)]">
        <div className="overflow-hidden rounded-[2.1rem] bg-ink">
          <div className="flex items-center justify-between border-b border-line/60 px-4 py-3 text-xs">
            <span className="flex items-center gap-1.5 font-semibold">
              <span className="h-2 w-2 animate-pulse rounded-full bg-mafia" aria-hidden /> Replay
            </span>
            <span className="truncate pl-3 text-muted">{title}</span>
          </div>
          <div className="flex h-[440px] flex-col justify-end gap-2 overflow-hidden px-3 pb-3" aria-live="off">
            <AnimatePresence initial={false} mode="popLayout">
              {shown.map((l) => {
                if (l.kind !== 'speech') {
                  return (
                    <motion.p
                      key={l.seq}
                      layout
                      initial={reduce ? false : { opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={`text-center text-xs ${l.kind === 'banner' ? 'mx-auto rounded-full border border-line px-3 py-1 font-display font-semibold' : 'text-muted'}`}
                    >
                      {l.text}
                    </motion.p>
                  );
                }
                const s = l.seatId ? seat.get(l.seatId) : undefined;
                return (
                  <motion.div
                    key={l.seq}
                    layout
                    initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    className="flex gap-2"
                  >
                    {s && <Avatar seatId={s.seatId} name={s.name} seed={s.avatarSeed} size={26} />}
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold" style={{ color: s ? seatColor(s.seatId) : undefined }}>
                        {s?.name ?? '?'}
                      </div>
                      <div className="rounded-2xl rounded-tl-md bg-panel-2 px-3 py-1.5 text-[13px] leading-snug">{l.text}</div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {last?.kind === 'speech' && !reduce && (
              <span className="flex gap-1 pl-9 pt-1" aria-hidden>
                <span className="h-1 w-1 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-muted" />
              </span>
            )}
          </div>
        </div>
      </div>
      <Link
        href={`/g/${gameId}`}
        className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-neon-pink px-5 py-2.5 text-sm font-semibold text-ink shadow-lg"
      >
        ▶ Watch the whole game
      </Link>
    </div>
  );
}
