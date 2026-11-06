'use client';

import { Avatar } from '@/components/Avatar';
import { modelName, type RosterSeat } from '@/lib/roster';
import { ROLE_META, seatColor } from '@/lib/theme';
import type { TableState } from '@/lib/timeline';
import type { Role } from '@ai-mafia/engine';

export function RoleBadge({ role, size = 'sm' }: { role: Role; size?: 'sm' | 'md' }) {
  const m = ROLE_META[role];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold ${size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-sm'}`}
      style={{ color: m.color, borderColor: `color-mix(in oklab, ${m.color} 45%, transparent)`, background: `color-mix(in oklab, ${m.color} 12%, transparent)` }}
    >
      <span aria-hidden>{m.emoji}</span>
      {m.label}
    </span>
  );
}

/** Seats: alive/dead, who's acting, roles once revealed (or always, in spectator mode). */
export function SeatRail({ seats, state, spectator }: { seats: RosterSeat[]; state: TableState; spectator: boolean }) {
  return (
    <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0" aria-label="Players">
      {seats.map((s) => {
        const dead = !state.alive.has(s.seatId);
        const role = state.revealed.get(s.seatId) ?? (spectator ? s.role : undefined);
        const acting = state.actor === s.seatId && !dead;
        return (
          <li
            key={s.seatId}
            className={`flex shrink-0 items-center gap-3 rounded-2xl border px-3 py-2 transition-colors lg:shrink ${acting ? 'border-transparent bg-panel-2' : 'border-line/60 bg-panel/70'}`}
            style={acting ? { boxShadow: `0 0 0 2px ${seatColor(s.seatId)}` } : undefined}
          >
            <Avatar seatId={s.seatId} name={s.name} seed={s.avatarSeed} size={36} dead={dead} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`font-semibold ${dead ? 'text-faint line-through' : ''}`} style={dead ? undefined : { color: seatColor(s.seatId) }}>
                  {s.name}
                </span>
                {dead && <span className="text-xs text-faint">💀</span>}
              </div>
              <div className="hidden truncate text-xs text-muted lg:block">{s.personaLabel}</div>
              {role && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <RoleBadge role={role} />
                  {(spectator || state.phase === 'end') && s.modelId && <span className="text-[11px] text-muted">{modelName(s.modelId)}</span>}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
