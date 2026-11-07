'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Highlight } from '@ai-mafia/agents';
import type { GameEvent, InputRequest } from '@ai-mafia/engine';
import { modelName, rosterFrom } from '@/lib/roster';
import { beatDelayMs, buildTimeline, indexForSeq, isLikelyLie, markers as timelineMarkers, stateAt } from '@/lib/timeline';
import type { GameMeta } from '@/lib/views';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BeatRow } from './BeatRow';
import { Controls, SPEEDS, type Speed } from './Controls';
import { EndScreen } from './EndScreen';
import { GamePanel } from './GamePanel';
import { SeatRail } from './SeatRail';
import { YourTurn } from './YourTurn';

export interface ViewerProps {
  meta: GameMeta;
  /** Public events, filtered on the server. */
  events: GameEvent[];
  /** ?t=<seq> deep link: open paused at that moment. */
  initialSeq?: number;
  /** 'seat' when the viewer is this game's human player (their own seat's view, server-filtered). */
  baseView?: 'public' | 'seat';
  /** Judge's awards (finished games only; empty while the judge runs). */
  highlights?: Highlight[];
}

const SPECTATOR_PREF = 'ai-mafia:spectator';
const SPEED_PREF = 'ai-mafia:speed';

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

type WaitingOn = { kind: 'speak' | 'vote'; seatId: string } | { kind: 'night' } | null;

/** Append events with seq beyond what we have (responses can overlap). */
const appendNew = (have: GameEvent[], incoming: GameEvent[]) => {
  const last = have.at(-1)?.seq ?? -1;
  const add = incoming.filter((e) => e.seq > last).sort((a, b) => a.seq - b.seq);
  return add.length ? [...have, ...add] : have;
};

export function Viewer({ meta, events: initialEvents, initialSeq, baseView = 'public', highlights: initialHighlights = [] }: ViewerProps) {
  // ── live games (BRD §9.4): this browser drives /advance while it's watching and caught up ──
  const startsLive = meta.status === 'running' || meta.status === 'awaiting_input';
  const [liveStatus, setLiveStatus] = useState<string>(meta.status);
  const live = liveStatus === 'running' || liveStatus === 'awaiting_input';
  const [events, setEvents] = useState<GameEvent[]>(initialEvents);
  const [waiting, setWaiting] = useState<WaitingOn>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [yourTurn, setYourTurn] = useState<InputRequest | null>(null);
  // I8: spectator data is locked while a human plays; it opens the moment the game is over (the player's full replay)
  const spectatorOpen = meta.spectatorAvailable || liveStatus === 'finished';

  // Awards: shipped with finished games; a live game's are judged after its last step, so fetch them a few times.
  const [highlights, setHighlights] = useState<Highlight[]>(initialHighlights);
  const [awardsGaveUp, setAwardsGaveUp] = useState(false);
  useEffect(() => {
    if (liveStatus !== 'finished' || highlights.length) return;
    let tries = 0;
    let stop = false;
    const load = async () => {
      if (stop) return;
      if (tries++ >= 6) return setAwardsGaveUp(true);
      try {
        const r = await fetch(`/api/games/${meta.id}/highlights`);
        const body = r.ok ? ((await r.json()) as { highlights: Highlight[] }) : null;
        if (!stop && body?.highlights.length) return setHighlights(body.highlights);
      } catch {
        // offline: just no awards
      }
      if (!stop) setTimeout(load, 2500);
    };
    void load();
    return () => {
      stop = true;
    };
  }, [liveStatus, highlights.length, meta.id]);
  const awardBySeq = useMemo(() => new Map(highlights.filter((h) => h.seq !== null).map((h) => [h.seq!, h])), [highlights]);

  // ── spectator mode: thoughts + hidden events, fetched from the server only when allowed (I3, I8) ──
  const [spectator, setSpectator] = useState(false);
  const [specEvents, setSpecEvents] = useState<GameEvent[] | null>(null);
  const [specMeta, setSpecMeta] = useState<GameMeta | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [specError, setSpecError] = useState<string | null>(null);
  const [revealAll, setRevealAll] = useState(false);
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());

  const loadSpectator = useCallback(async () => {
    if (specEvents && !live) return true; // finished games never change; live ones are re-fetched
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
  }, [meta.id, specEvents, live]);

  const activeMeta = spectator && specMeta ? specMeta : meta;
  const activeEvents = spectator && specEvents ? specEvents : events;
  const seats = useMemo(() => rosterFrom(activeMeta.seats, activeEvents), [activeMeta.seats, activeEvents]);
  const seatMap = useMemo(() => new Map(seats.map((s) => [s.seatId, s])), [seats]);
  const seatIds = useMemo(() => seats.map((s) => s.seatId), [seats]);
  const beats = useMemo(() => buildTimeline(activeEvents), [activeEvents]);
  const marks = useMemo(() => timelineMarkers(beats), [beats]);
  const trueRoles = useMemo(() => new Map(seats.filter((s) => s.role).map((s) => [s.seatId, s.role!])), [seats]);

  // live games open caught up (everything so far), replays from the start
  const [count, setCount] = useState(() => (initialSeq !== undefined ? indexForSeq(beats, initialSeq) : startsLive ? beats.length : 1));
  const [playing, setPlaying] = useState(initialSeq === undefined);
  const [speed, setSpeedState] = useState<Speed>(1);
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(SPEED_PREF));
      if ((SPEEDS as readonly number[]).includes(v) && v !== Infinity) setSpeedState(v as Speed);
    } catch {
      // storage blocked: default speed
    }
  }, []);
  const setSpeed = useCallback((s: Speed) => {
    setSpeedState(s);
    try {
      if (s !== Infinity) window.localStorage.setItem(SPEED_PREF, String(s));
    } catch {
      // fine: just not remembered
    }
  }, []);
  const total = beats.length;
  const state = useMemo(() => stateAt(beats, seatIds, count), [beats, seatIds, count]);

  // playback clock: each beat stays on screen for its reading time
  useEffect(() => {
    if (!playing) return;
    if (count >= total) {
      if (!live) setPlaying(false); // live: keep "playing" so new beats glide in as they arrive
      return;
    }
    if (speed === Infinity) {
      setCount(total);
      return;
    }
    const t = setTimeout(() => setCount((c) => Math.min(total, c + 1)), beatDelayMs(beats[Math.max(0, count - 1)], speed, spectator));
    return () => clearTimeout(t);
  }, [playing, count, total, speed, beats, spectator]);

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

  // ── live driver: one /advance at a time, only when caught up, visible and playing ──
  const view = spectator ? 'spectator' : baseView;
  const activeLast = activeEvents.at(-1)?.seq ?? -1;
  const lastRef = useRef(activeLast);
  lastRef.current = activeLast;
  const caughtUp = count >= total;
  const [visible, setVisible] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const ingest = useCallback(
    (v: string, incoming: GameEvent[]) => {
      if (!incoming.length) return;
      if (v === 'spectator') setSpecEvents((s) => appendNew(s ?? [], incoming));
      else setEvents((s) => appendNew(s, incoming));
    },
    [],
  );

  useEffect(() => {
    const polling = liveStatus === 'running' || (liveStatus === 'awaiting_input' && !yourTurn);
    if (!live || !polling || !caughtUp || !visible || !playing) return;
    const ctrl = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const r = await fetch(`/api/games/${meta.id}/advance?view=${view}&after=${lastRef.current}`, { method: 'POST', signal: ctrl.signal });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `advance failed (${r.status})`);
        setLiveError(null);
        ingest(view, body.events as GameEvent[]);
        setWaiting(body.waitingOn ?? null);
        setYourTurn(body.yourTurn ?? null);
        if (body.status !== 'busy') setLiveStatus(body.status);
        // someone else is mid-turn, or nothing new: look again shortly (a Realtime ping may beat us to it)
        if (body.yourTurn) return; // our move: wait for the player
        if (body.status === 'busy' || !(body.events as GameEvent[]).length) retry = setTimeout(() => setTick((t) => t + 1), 1500);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setLiveError((e as Error).message);
        retry = setTimeout(() => setTick((t) => t + 1), 4000);
      }
    })();
    return () => {
      ctrl.abort();
      clearTimeout(retry);
    };
  }, [live, liveStatus, yourTurn, caughtUp, visible, playing, view, meta.id, ingest, activeLast, tick]);

  const submitMove = useCallback(
    async (body: Record<string, unknown>) => {
      const r = await fetch(`/api/games/${meta.id}/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const out = await r.json();
      if (!r.ok) return (out.error as string) ?? 'Could not send your move.';
      ingest(view, out.events as GameEvent[]);
      setYourTurn(null);
      setLiveStatus(out.status === 'finished' ? 'finished' : 'running');
      setPlaying(true);
      setTick((t) => t + 1);
      return null;
    },
    [meta.id, ingest, view],
  );

  const spectatorRef = useRef(spectator);
  spectatorRef.current = spectator;

  // Realtime: another viewer advanced the game → fetch the new filtered events (pings carry only a seq, I3)
  useEffect(() => {
    if (!startsLive || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    let cancelled = false;
    let cleanup = () => {};
    void import('@supabase/supabase-js').then(({ createClient }) => {
      if (cancelled) return;
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      const ch = sb
        .channel(`game:${meta.id}`)
        .on('broadcast', { event: 'seq' }, ({ payload }) => {
          const seq = Number((payload as { seq?: number })?.seq);
          if (!(seq > lastRef.current)) return;
          const v = spectatorRef.current ? 'spectator' : 'public';
          void fetch(`/api/games/${meta.id}/events?view=${v}&after=${lastRef.current}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((b) => b && ingest(v, b.events as GameEvent[]));
        })
        .subscribe();
      cleanup = () => void sb.removeChannel(ch);
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [startsLive, meta.id, ingest]);

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

  const lastPhaseSeq = shown.findLast((b) => b.kind === 'phase')?.event.seq;

  return (
    <div className="stage flex h-dvh flex-col" data-phase={state.phase}>
      <header className="flex items-center gap-3 border-b-[3px] border-shadow bg-panel px-4 py-3 sm:px-6">
        <a href="/" className="flex items-center gap-2 font-display text-lg">
          <span aria-hidden className="grid h-6 w-6 place-items-center border-2 border-shadow bg-neon-pink text-[0.7rem] text-[var(--color-shadow)]">♦</span>
          <span className="hidden sm:inline">
            AI <span className="text-neon-pink">Mafia</span>
          </span>
        </a>
        {liveStatus === 'running' && (
          <span className="flex items-center gap-1.5 rounded-full bg-mafia/15 px-2.5 py-1 text-xs font-extrabold tracking-wider text-mafia" aria-label="Live game">
            <span className="blink h-2 w-2 bg-mafia" aria-hidden />
            LIVE
          </span>
        )}
        <span className="hidden truncate text-sm text-muted sm:inline">
          {meta.models.map(modelName).join(' vs ')} · {meta.preset}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          {state.outcome && (
            <button type="button" onClick={() => setShowEnd(true)} className="btn btn-sm" aria-label="Results">
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
            disabled={!spectatorOpen || specLoading}
            onClick={() => void switchView(!spectator)}
            title={spectatorOpen ? 'See every private thought, role and night action' : 'Unlocks when this game ends'}
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
      {liveStatus === 'aborted' && (
        <p role="status" className="border-b border-line/60 bg-neon-amber/10 px-4 py-2 text-center text-sm text-neon-amber">
          This game was stopped before it finished (it hit its cost limit or was ended by an admin).
        </p>
      )}
      {live && liveError && (
        <p role="status" className="border-b border-line/60 bg-mafia/10 px-4 py-2 text-center text-sm text-mafia">
          Connection hiccup: {liveError}. Retrying…
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
                award={state.outcome ? awardBySeq.get(b.event.seq) : undefined}
                stickyPhase={b.event.seq === lastPhaseSeq}
              />
            ))}
            {live && caughtUp && !yourTurn && (
              <p className="flex items-center gap-2 py-3 pl-12 text-sm text-muted" aria-live="polite">
                <span className="inline-flex gap-1" aria-hidden>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
                </span>
                {!playing
                  ? 'Paused — press play to keep the game going'
                  : waiting && 'seatId' in waiting
                    ? `${seatMap.get(waiting.seatId)?.name ?? 'Someone'} is ${waiting.kind === 'vote' ? 'deciding their vote' : 'typing'}…`
                    : waiting?.kind === 'night'
                      ? '🌙 Night falls… someone is making moves'
                      : 'Thinking…'}
              </p>
            )}
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
          awards={highlights}
          awardsPending={!highlights.length && !awardsGaveUp}
          gameId={meta.id}
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

      {yourTurn && caughtUp && <YourTurn key={yourTurn.id} req={yourTurn} seats={seatMap} onSubmit={submitMove} />}

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
