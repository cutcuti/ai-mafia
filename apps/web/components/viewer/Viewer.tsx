'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent } from '@ai-mafia/engine';
import { modelName, rosterFrom } from '@/lib/roster';
import { beatDelayMs, buildTimeline, indexForSeq, isLikelyLie, markers as timelineMarkers, stateAt } from '@/lib/timeline';
import type { GameMeta } from '@/lib/views';
import { BeatRow } from './BeatRow';
import { Controls, type Speed } from './Controls';
import { EndScreen } from './EndScreen';
import { GamePanel } from './GamePanel';
import { SeatRail } from './SeatRail';

export interface ViewerProps {
  meta: GameMeta;
  /** Public events, filtered on the server. */
  events: GameEvent[];
  /** ?t=<seq> deep link: open paused at that moment. */
  initialSeq?: number;
}

const SPECTATOR_PREF = 'ai-mafia:spectator';

function readPref(): boolean {
  try {
    return window.localStorage.getItem(SPECTATOR_PREF) === '1';
  } catch {
    return false;
  }
}
function writePref(on: boolean) {
  try {
    window.localStorage.setItem(SPECTATOR_PREF, on ? '1' : '0');
  } catch {
    // private mode etc. — fine, it just won't be remembered
  }
}

export function Viewer({ meta, events, initialSeq }: ViewerProps) {
  // ── spectator mode: thoughts + hidden events, fetched from the server only when allowed (I3, I8) ──
  const [spectator, setSpectator] = useState(false);
  const [specEvents, setSpecEvents] = useState<GameEvent[] | null>(null);
  const [specMeta, setSpecMeta] = useState<GameMeta | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [specError, setSpecError] = useState<string | null>(null);
  const [revealAll, setRevealAll] = useState(false);
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());

  const loadSpectator = useCallback(async () => {
    if (specEvents) return true;
    setSpecLoading(true);
    setSpecError(null);
    try {
      const [ev, m] = await Promise.all([
        fetch(`/api/games/${meta.id}/events?view=spectator`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 403 ? 'locked' : 'failed')))),
        fetch(`/api/games/${meta.id}?view=spectator`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed')))),
      ]);
      setSpecEvents(ev.events as GameEvent[]);
      setSpecMeta(m as GameMeta);
      return true;
    } catch (e) {
      setSpecError((e as Error).message === 'locked' ? 'Spectator mode unlocks when this game ends.' : 'Couldn’t load spectator data.');
      return false;
    } finally {
      setSpecLoading(false);
    }
  }, [meta.id, specEvents]);

  const activeMeta = spectator && specMeta ? specMeta : meta;
  const activeEvents = spectator && specEvents ? specEvents : events;
  const seats = useMemo(() => rosterFrom(activeMeta.seats, activeEvents), [activeMeta.seats, activeEvents]);
  const seatMap = useMemo(() => new Map(seats.map((s) => [s.seatId, s])), [seats]);
  const seatIds = useMemo(() => seats.map((s) => s.seatId), [seats]);
  const beats = useMemo(() => buildTimeline(activeEvents), [activeEvents]);
  const marks = useMemo(() => timelineMarkers(beats), [beats]);
  const trueRoles = useMemo(() => new Map(seats.filter((s) => s.role).map((s) => [s.seatId, s.role!])), [seats]);

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
      if (e.key === 'Escape') {
        setSheet(false);
        return;
      }
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

  // Switching views swaps the beat list; keep the playhead on the same moment (by seq).
  const [pendingSeq, setPendingSeq] = useState<number | null>(null);
  const lastSeq = useRef<number>(-1);
  useEffect(() => {
    lastSeq.current = count > 0 ? (beats[count - 1]?.event.seq ?? -1) : -1;
  }, [count, beats]);
  const switchView = useCallback(
    async (on: boolean) => {
      if (on && !(await loadSpectator())) return;
      const keep = lastSeq.current;
      setSpectator(on);
      writePref(on);
      setPendingSeq(keep);
    },
    [loadSpectator],
  );
  useEffect(() => {
    if (pendingSeq === null) return;
    const i = beats.findIndex((b) => b.event.seq > pendingSeq);
    setCount(i === -1 ? beats.length : i);
    setPendingSeq(null);
  }, [beats, pendingSeq]);

  // remembered preference (only if this game allows spectating)
  useEffect(() => {
    if (meta.spectatorAvailable && readPref()) void switchView(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const share = useCallback(
    (seq: number) => {
      const url = `${window.location.origin}/g/${meta.id}?t=${seq}`;
      void navigator.clipboard?.writeText(url);
    },
    [meta.id],
  );

  const [sheet, setSheet] = useState(false);

  // end screen: opens once when playback reaches game over; can be reopened from the header
  const [showEnd, setShowEnd] = useState(false);
  const [endSeen, setEndSeen] = useState(false);
  useEffect(() => {
    if (count >= total && state.outcome && !endSeen) {
      const t = setTimeout(() => {
        setShowEnd(true);
        setEndSeen(true);
      }, 900);
      return () => clearTimeout(t);
    }
  }, [count, total, state.outcome, endSeen]);

  const end = useRef<HTMLDivElement>(null);
  const prevCount = useRef<number | null>(null);
  useEffect(() => {
    // jump on load / seeks, glide during normal playback
    const smooth = prevCount.current !== null && Math.abs(count - prevCount.current) === 1;
    prevCount.current = count;
    end.current?.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'instant' });
  }, [count, beats]);

  const shown = beats.slice(0, count);

  return (
    <div className="stage flex h-dvh flex-col" data-phase={state.phase}>
      <header className="flex items-center gap-3 border-b border-line/60 px-4 py-3 sm:px-6">
        <a href="/" className="font-display text-lg font-extrabold tracking-tight">
          AI <span className="text-neon-pink">Mafia</span>
        </a>
        <span className="hidden truncate text-sm text-muted sm:inline">
          {meta.models.map(modelName).join(' vs ')} · {meta.preset}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {state.outcome && (
            <button type="button" onClick={() => setShowEnd(true)} className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-muted hover:text-fg" aria-label="Results">
              🏁<span className="hidden sm:inline"> Results</span>
            </button>
          )}
          {spectator && (
            <label className="hidden items-center gap-2 text-sm text-muted sm:flex">
              <input type="checkbox" checked={revealAll} onChange={(e) => setRevealAll(e.target.checked)} className="accent-[var(--color-neon-pink)]" />
              Reveal all thoughts
            </label>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={spectator}
            disabled={!meta.spectatorAvailable || specLoading}
            onClick={() => void switchView(!spectator)}
            title={meta.spectatorAvailable ? 'See every private thought, role and night action' : 'Unlocks when this game ends'}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
              spectator ? 'border-neon-pink bg-neon-pink/15 text-neon-pink' : 'border-line text-muted hover:text-fg'
            }`}
          >
            <span aria-hidden>{spectator ? '👁️' : '🙈'}</span>
            <span className={spectator ? '' : 'hidden sm:inline'}>{specLoading ? 'Loading…' : 'Spectator'}</span>
            <span className="hidden sm:inline">{specLoading ? '' : ' mode'}</span>
            <span className={`relative h-4 w-7 rounded-full ${spectator ? 'bg-neon-pink' : 'bg-line'}`} aria-hidden>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-ink transition-all ${spectator ? 'left-3.5' : 'left-0.5'}`} />
            </span>
          </button>
        </div>
      </header>
      {specError && (
        <p role="status" className="border-b border-line/60 bg-mafia/10 px-4 py-2 text-center text-sm text-mafia">
          {specError}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] lg:grid-cols-[260px_minmax(0,1fr)_280px] lg:grid-rows-1">
        <aside className="min-w-0 border-b border-line/60 px-3 py-2 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-3">
          <SeatRail seats={seats} state={state} spectator={spectator} />
        </aside>

        <main className="min-h-0 overflow-y-auto px-3 sm:px-6" aria-live="polite" aria-relevant="additions">
          <div className="mx-auto max-w-3xl pb-10">
            {shown.map((b) => (
              <BeatRow
                key={b.event.seq}
                beat={b}
                seats={seatMap}
                showThought={spectator}
                thoughtRevealed={revealAll || revealed.has(b.event.seq)}
                onRevealThought={() =>
                  setRevealed((r) => {
                    const n = new Set(r);
                    if (n.has(b.event.seq)) n.delete(b.event.seq);
                    else n.add(b.event.seq);
                    return n;
                  })
                }
                lie={spectator && isLikelyLie(b, trueRoles)}
                onShare={() => share(b.event.seq)}
              />
            ))}
            <div ref={end} />
          </div>
        </main>

        <aside className="hidden overflow-y-auto border-l border-line/60 p-4 lg:block">
          <GamePanel state={state} seats={seats} seatMap={seatMap} spectator={spectator} />
        </aside>
      </div>

      {/* Mobile: game panel as a bottom sheet (BRD §10.3) */}
      {sheet && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Game panel" onClick={() => setSheet(false)}>
          <div className="absolute inset-0 bg-ink/60" />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[75dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-ink p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" aria-hidden />
            <GamePanel state={state} seats={seats} seatMap={seatMap} spectator={spectator} />
          </div>
        </div>
      )}

      {showEnd && state.outcome && (
        <EndScreen
          outcome={state.outcome}
          seats={seats}
          roles={state.revealed}
          alive={state.alive}
          shareUrl={typeof window === 'undefined' ? `/g/${meta.id}` : `${window.location.origin}/g/${meta.id}`}
          spectator={spectator}
          onClose={() => setShowEnd(false)}
          onReplay={() => {
            setShowEnd(false);
            setCount(1);
            setPlaying(true);
          }}
          onSpectator={() => {
            setShowEnd(false);
            void switchView(true).then(() => {
              setCount(1);
              setPlaying(true);
            });
          }}
        />
      )}

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
        onPanel={() => setSheet(true)}
        panelBadge={state.phase === 'vote' && state.votes.length ? state.votes.length : undefined}
      />
    </div>
  );
}
