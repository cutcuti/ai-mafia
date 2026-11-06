'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent } from '@ai-mafia/engine';
import { modelName, rosterFrom } from '@/lib/roster';
import { beatDelayMs, buildTimeline, indexForSeq, markers as timelineMarkers, stateAt } from '@/lib/timeline';
import type { GameMeta } from '@/lib/views';
import { BeatRow } from './BeatRow';
import { Controls, type Speed } from './Controls';
import { SeatRail } from './SeatRail';

export interface ViewerProps {
  meta: GameMeta;
  /** Public events, filtered on the server. */
  events: GameEvent[];
  /** ?t=<seq> deep link: open paused at that moment. */
  initialSeq?: number;
}

export function Viewer({ meta, events, initialSeq }: ViewerProps) {
  const seats = useMemo(() => rosterFrom(meta.seats, events), [meta.seats, events]);
  const seatMap = useMemo(() => new Map(seats.map((s) => [s.seatId, s])), [seats]);
  const seatIds = useMemo(() => seats.map((s) => s.seatId), [seats]);
  const beats = useMemo(() => buildTimeline(events), [events]);
  const marks = useMemo(() => timelineMarkers(beats), [beats]);

  const [count, setCount] = useState(() => (initialSeq !== undefined ? indexForSeq(beats, initialSeq) : 1));
  const [playing, setPlaying] = useState(initialSeq === undefined);
  const [speed, setSpeed] = useState<Speed>(1);
  const total = beats.length;
  const state = useMemo(() => stateAt(beats, seatIds, count), [beats, seatIds, count]);

  // playback clock: each beat stays on screen for its reading time
  useEffect(() => {
    if (!playing) return;
    if (count >= total) {
      setPlaying(false);
      return;
    }
    if (speed === Infinity) {
      setCount(total);
      return;
    }
    const t = setTimeout(() => setCount((c) => Math.min(total, c + 1)), beatDelayMs(beats[Math.max(0, count - 1)], speed));
    return () => clearTimeout(t);
  }, [playing, count, total, speed, beats]);

  const seek = useCallback((n: number) => setCount(Math.max(0, Math.min(total, n))), [total]);
  const step = useCallback(
    (d: number) => {
      setPlaying(false);
      setCount((c) => Math.max(0, Math.min(total, c + d)));
    },
    [total],
  );
  const playPause = useCallback(() => {
    setPlaying((p) => {
      if (!p && count >= total) setCount(1); // replay from the start
      return !p;
    });
  }, [count, total]);

  // keyboard: space, ←, →  (ignored while typing or when a control has focus)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, button, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey)) return;
      if (e.key === ' ') {
        e.preventDefault();
        playPause();
      } else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playPause, step]);

  const share = useCallback(
    (seq: number) => {
      const url = `${window.location.origin}/g/${meta.id}?t=${seq}`;
      void navigator.clipboard?.writeText(url);
    },
    [meta.id],
  );

  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [count]);

  const shown = beats.slice(0, count);

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

        <main className="min-h-0 overflow-y-auto px-3 sm:px-6" aria-live="polite" aria-relevant="additions">
          <div className="mx-auto max-w-3xl pb-10">
            {shown.map((b) => (
              <BeatRow
                key={b.event.seq}
                beat={b}
                seats={seatMap}
                showThought={false}
                thoughtRevealed={false}
                onRevealThought={() => {}}
                lie={false}
                onShare={() => share(b.event.seq)}
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

      <Controls
        count={count}
        total={total}
        playing={playing}
        speed={speed}
        markers={marks}
        onPlayPause={playPause}
        onStep={step}
        onSeek={(n) => {
          setPlaying(false);
          seek(n);
        }}
        onSpeed={setSpeed}
      />
    </div>
  );
}
