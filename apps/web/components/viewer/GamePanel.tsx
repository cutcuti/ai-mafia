'use client';

import { motion, useReducedMotion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import type { RosterSeat } from '@/lib/roster';
import { seatColor } from '@/lib/theme';
import type { TableState, VoteEdge } from '@/lib/timeline';

function phaseTitle(s: TableState) {
  switch (s.phase) {
    case 'night':
      return `🌙 Night ${s.day}`;
    case 'day':
      return `☀️ Day ${s.day}`;
    case 'vote':
      return `🗳️ Vote · Day ${s.day}`;
    case 'end':
      return '🏁 Game over';
    default:
      return '🎲 Setup';
  }
}

/** Tally bars per candidate; votes animate in one by one. */
export function VoteTracker({ votes, seats, live }: { votes: VoteEdge[]; seats: Map<string, RosterSeat>; live: boolean }) {
  const reduce = useReducedMotion();
  if (!votes.length) return null;
  const tally = new Map<string, string[]>();
  for (const v of votes) tally.set(v.to, [...(tally.get(v.to) ?? []), v.from]);
  const rows = [...tally.entries()].sort((a, b) => b[1].length - a[1].length);
  const max = rows[0][1].length;
  return (
    <section aria-label="Vote tally" className="rounded-2xl border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-widest text-muted">
        <span>{live ? 'Votes so far' : 'Last vote'}</span>
        <span className="tabular-nums">{votes.length} cast</span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {rows.map(([target, voters]) => {
          const s = seats.get(target);
          return (
            <li key={target}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-semibold" style={{ color: seatColor(target) }}>
                  {s?.name ?? target}
                </span>
                <span className="tabular-nums text-muted">{voters.length}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-ink">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: seatColor(target) }}
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${(voters.length / max) * 100}%` }}
                  transition={{ type: 'spring', stiffness: 220, damping: 26 }}
                />
              </div>
              <div className="mt-1 flex -space-x-1.5">
                {voters.map((v) => {
                  const vs = seats.get(v);
                  return vs ? <Avatar key={v} seatId={v} name={vs.name} seed={vs.avatarSeed} size={18} /> : null;
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Who voted for whom: seats on a circle, arrows voter → target (coloured by team in spectator mode). */
export function VoteGraph({ votes, seats, alive, spectator }: { votes: VoteEdge[]; seats: RosterSeat[]; alive: Set<string>; spectator: boolean }) {
  const reduce = useReducedMotion();
  if (!votes.length) return null;
  const R = 92;
  const C = 120;
  const pos = new Map(
    seats.map((s, i) => {
      const a = (i / seats.length) * Math.PI * 2 - Math.PI / 2;
      return [s.seatId, { x: C + R * Math.cos(a), y: C + R * Math.sin(a) }] as const;
    }),
  );
  const color = (from: string) => {
    if (!spectator) return seatColor(from);
    const role = seats.find((s) => s.seatId === from)?.role;
    return role === 'mafia' ? 'var(--color-mafia)' : 'var(--color-detective)';
  };
  return (
    <section aria-label="Vote graph" className="rounded-2xl border border-line bg-panel p-3">
      <svg viewBox="0 0 240 240" className="w-full" role="img" aria-label={votes.map((v) => `${seats.find((s) => s.seatId === v.from)?.name} voted ${seats.find((s) => s.seatId === v.to)?.name}`).join('; ')}>
        <defs>
          {votes.map((v) => (
            <marker key={`m-${v.from}`} id={`arrow-${v.from}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={color(v.from)} />
            </marker>
          ))}
        </defs>
        {votes.map((v, i) => {
          const a = pos.get(v.from);
          const b = pos.get(v.to);
          if (!a || !b) return null;
          // shorten so arrows stop at the avatar edge; curve slightly so A→B and B→A don't overlap
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const pad = 17;
          const x1 = a.x + (dx / len) * pad;
          const y1 = a.y + (dy / len) * pad;
          const x2 = b.x - (dx / len) * pad;
          const y2 = b.y - (dy / len) * pad;
          const mx = (x1 + x2) / 2 - (dy / len) * 14;
          const my = (y1 + y2) / 2 + (dx / len) * 14;
          return (
            <motion.path
              key={`${v.from}-${v.to}`}
              d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`}
              fill="none"
              stroke={color(v.from)}
              strokeWidth={2}
              strokeLinecap="round"
              markerEnd={`url(#arrow-${v.from})`}
              initial={reduce ? false : { pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.9 }}
              transition={{ duration: 0.5, delay: reduce ? 0 : i * 0.04 }}
            />
          );
        })}
        {seats.map((s) => {
          const p = pos.get(s.seatId)!;
          const dead = !alive.has(s.seatId);
          return (
            <g key={s.seatId} transform={`translate(${p.x - 14} ${p.y - 14})`} opacity={dead ? 0.35 : 1}>
              <foreignObject width="28" height="28">
                <Avatar seatId={s.seatId} name={s.name} seed={s.avatarSeed} size={28} dead={dead} />
              </foreignObject>
            </g>
          );
        })}
      </svg>
      {spectator && (
        <div className="mt-1 flex justify-center gap-4 text-[11px] text-muted">
          <span>
            <span className="text-mafia">━</span> mafia vote
          </span>
          <span>
            <span className="text-detective">━</span> town vote
          </span>
        </div>
      )}
    </section>
  );
}

export function GamePanel({ state, seats, seatMap, spectator }: { state: TableState; seats: RosterSeat[]; seatMap: Map<string, RosterSeat>; spectator: boolean }) {
  const live = state.phase === 'vote' && state.votes.length > 0;
  const votes = live ? state.votes : state.lastVotes;
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl border border-line bg-panel p-4">
        <div className="text-xs uppercase tracking-widest text-muted">Now</div>
        <div className="mt-1 font-display text-2xl font-extrabold">{phaseTitle(state)}</div>
        <div className="mt-2 text-sm text-muted">{state.alive.size} alive</div>
      </section>
      <VoteTracker votes={votes} seats={seatMap} live={live} />
      <VoteGraph votes={votes} seats={seats} alive={state.alive} spectator={spectator} />
    </div>
  );
}
