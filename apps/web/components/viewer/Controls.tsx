'use client';

import type { Marker } from '@/lib/timeline';

export const SPEEDS = [1, 2, 4, Infinity] as const;
export type Speed = (typeof SPEEDS)[number];
const speedLabel = (s: Speed) => (s === Infinity ? 'instant' : `${s}×`);
const MARK: Record<Marker['kind'], string> = { night: '🌙', day: '☀️', vote: '🗳️', death: '💀' };

export interface ControlsProps {
  count: number;
  total: number;
  playing: boolean;
  speed: Speed;
  markers: Marker[];
  onPlayPause: () => void;
  onStep: (delta: number) => void;
  onSeek: (count: number) => void;
  onSpeed: (s: Speed) => void;
  /** Mobile: open the game panel sheet. */
  onPanel?: () => void;
  panelBadge?: number;
}

/** Playback bar: play/pause, step, speed, timeline scrubber with phase & death markers. */
export function Controls({ count, total, playing, speed, markers, onPlayPause, onStep, onSeek, onSpeed, onPanel, panelBadge }: ControlsProps) {
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
  const pct = (i: number) => (total ? (i / total) * 100 : 0);
  return (
    <div className="border-t border-line/60 bg-ink/85 px-3 pb-2 pt-1 backdrop-blur sm:px-6" role="group" aria-label="Playback">
      <div className="mx-auto flex max-w-5xl items-end gap-2 sm:gap-3">
        <button type="button" onClick={() => onStep(-1)} className="hidden rounded-lg px-2 py-1 text-muted hover:text-fg sm:block" aria-label="Previous moment (←)">
          ⏮
        </button>
        <button
          type="button"
          onClick={onPlayPause}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-neon-cyan text-lg font-bold text-ink shadow-[0_0_24px_-4px_var(--color-neon-cyan)]"
          aria-label={playing ? 'Pause (space)' : 'Play (space)'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" onClick={() => onStep(1)} className="rounded-lg px-2 py-1 text-muted hover:text-fg" aria-label="Next moment (→)">
          ⏭
        </button>
        <div className="min-w-0 flex-1 self-stretch">
          {/* markers sit in the same box as the slider so percentages line up (thumb inset ≈ 8px each side) */}
          <div className="relative mx-2 h-5" aria-hidden>
            {markers.map((m) => (
              <button
                key={`${m.kind}-${m.index}`}
                type="button"
                tabIndex={-1}
                title={m.label}
                onClick={() => onSeek(m.index + 1)}
                className="absolute -translate-x-1/2 text-xs leading-5 opacity-70 transition-opacity hover:opacity-100"
                style={{ left: `${pct(m.index + 1)}%` }}
              >
                {MARK[m.kind]}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={total}
            value={count}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="block h-2 w-full cursor-pointer accent-[var(--color-neon-cyan)]"
            aria-label="Timeline"
            aria-valuetext={`moment ${count} of ${total}`}
          />
        </div>
        <span className="hidden w-16 text-right text-xs tabular-nums text-muted sm:block">
          {count}/{total}
        </span>
        {/* small screens: one tap-to-cycle speed button + the game panel sheet */}
        <button
          type="button"
          onClick={() => onSpeed(nextSpeed)}
          className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs font-semibold sm:hidden"
          aria-label={`Speed ${speedLabel(speed)}, tap for ${speedLabel(nextSpeed)}`}
        >
          {speedLabel(speed)}
        </button>
        {onPanel && (
          <button type="button" onClick={onPanel} className="relative shrink-0 rounded-full border border-line px-2.5 py-1 text-xs font-semibold lg:hidden" aria-label="Open votes panel">
            🗳️
            {panelBadge !== undefined && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-neon-pink px-1 text-[10px] text-ink">{panelBadge}</span>
            )}
          </button>
        )}
        <div className="hidden rounded-full border border-line p-0.5 sm:flex" role="radiogroup" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button
              key={String(s)}
              type="button"
              role="radio"
              aria-checked={speed === s}
              onClick={() => onSpeed(s)}
              className={`rounded-full px-2 py-0.5 text-xs font-semibold sm:px-2.5 ${speed === s ? 'bg-fg text-ink' : 'text-muted hover:text-fg'}`}
            >
              {speedLabel(s)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
