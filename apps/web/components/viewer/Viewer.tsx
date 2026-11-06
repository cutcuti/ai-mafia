'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent } from '@ai-mafia/engine';
import { modelName, rosterFrom } from '@/lib/roster';
import { buildTimeline, stateAt } from '@/lib/timeline';
import type { GameMeta } from '@/lib/views';
import { BeatRow } from './BeatRow';
import { SeatRail } from './SeatRail';

export interface ViewerProps {
  meta: GameMeta;
  /** Public events, filtered on the server. */
  events: GameEvent[];
}

export function Viewer({ meta, events }: ViewerProps) {
  const seats = useMemo(() => rosterFrom(meta.seats, events), [meta.seats, events]);
  const seatMap = useMemo(() => new Map(seats.map((s) => [s.seatId, s])), [seats]);
  const beats = useMemo(() => buildTimeline(events), [events]);
  const [count] = useState(beats.length);
  const state = useMemo(() => stateAt(beats, seats.map((s) => s.seatId), count), [beats, seats, count]);
  const shown = beats.slice(0, count);

  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  return (
    <div className="stage flex h-dvh flex-col" data-phase={state.phase}>
      <header className="flex items-center gap-3 border-b border-line/60 px-4 py-3 sm:px-6">
        <a href="/" className="font-display text-lg font-extrabold tracking-tight">
          AI <span className="text-neon-pink">Mafia</span>
        </a>
        <span className="truncate text-sm text-muted">
          {meta.models.map(modelName).join(' vs ')} · {meta.preset}
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] lg:grid-cols-[260px_minmax(0,1fr)_280px] lg:grid-rows-1">
        <aside className="border-b border-line/60 p-3 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <SeatRail seats={seats} state={state} spectator={false} />
        </aside>

        <main className="min-h-0 overflow-y-auto px-3 sm:px-6" aria-live="polite">
          <div className="mx-auto max-w-3xl pb-24">
            {shown.map((b) => (
              <BeatRow
                key={b.event.seq}
                beat={b}
                seats={seatMap}
                showThought={false}
                thoughtRevealed={false}
                onRevealThought={() => {}}
                lie={false}
                onShare={() => {}}
              />
            ))}
            <div ref={end} />
          </div>
        </main>

        <aside className="hidden border-l border-line/60 p-4 lg:block">
          <div className="rounded-2xl border border-line bg-panel p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Now</div>
            <div className="mt-1 font-display text-2xl font-extrabold">
              {state.phase === 'night' ? `🌙 Night ${state.day}` : state.phase === 'day' ? `☀️ Day ${state.day}` : state.phase === 'vote' ? `🗳️ Vote · Day ${state.day}` : state.phase === 'end' ? '🏁 Game over' : 'Setup'}
            </div>
            <div className="mt-2 text-sm text-muted">{state.alive.size} alive</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
