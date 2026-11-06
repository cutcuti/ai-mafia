'use client';

import { Avatar } from '@/components/Avatar';
import type { RosterSeat } from '@/lib/roster';
import { ROLE_META, seatColor } from '@/lib/theme';
import type { Beat } from '@/lib/timeline';
import type { Phase, Role } from '@ai-mafia/engine';
import { RevealCard } from './RevealCard';
import { RoleBadge } from './SeatRail';

const PHASE_LABEL: Record<string, { icon: string; label: (d: number) => string }> = {
  night: { icon: '🌙', label: (d) => `Night ${d}` },
  day: { icon: '☀️', label: (d) => `Day ${d}` },
  vote: { icon: '🗳️', label: (d) => `Day ${d} · Vote` },
};

export interface BeatRowProps {
  beat: Beat;
  seats: Map<string, RosterSeat>;
  /** Thought shown under the message (spectator mode only). */
  showThought: boolean;
  thoughtRevealed: boolean;
  onRevealThought: () => void;
  lie: boolean;
  onShare: () => void;
}

function Who({ id, seats }: { id?: string; seats: Map<string, RosterSeat> }) {
  const s = id ? seats.get(id) : undefined;
  if (!s) return <span>someone</span>;
  return (
    <span className="font-semibold" style={{ color: seatColor(s.seatId) }}>
      {s.name}
    </span>
  );
}

function Thought({ text, revealed, onReveal }: { text: string; revealed: boolean; onReveal: () => void }) {
  return (
    <button
      type="button"
      onClick={onReveal}
      aria-label={revealed ? 'Private thought' : 'Reveal private thought'}
      aria-expanded={revealed}
      className="mt-1.5 block w-full rounded-xl border border-dashed border-line bg-ink/40 px-3 py-2 text-left text-sm text-muted"
    >
      <span className="mr-1.5" aria-hidden>
        💭
      </span>
      <span className="spoiler" data-revealed={revealed}>
        {text}
      </span>
    </button>
  );
}

export function BeatRow({ beat, seats, showThought, thoughtRevealed, onRevealThought, lie, onShare }: BeatRowProps) {
  const e = beat.event;
  const actor = e.actorSeatId ? seats.get(e.actorSeatId) : undefined;

  switch (beat.kind) {
    case 'start':
      return <p className="py-2 text-center text-sm text-muted">{e.text}</p>;

    case 'phase': {
      const p = PHASE_LABEL[(e.payload?.phase as Phase) ?? e.phase];
      if (!p) return null;
      return (
        <div className="sticky top-0 z-10 flex justify-center py-3" role="separator">
          <span className="rounded-full border border-line bg-panel/90 px-4 py-1 font-display text-sm font-semibold backdrop-blur">
            {p.icon} {p.label(e.day)}
          </span>
        </div>
      );
    }

    case 'speech':
    case 'mafia_chat': {
      const night = beat.kind === 'mafia_chat';
      const accused = e.payload?.accuses ?? e.payload?.suggests;
      const claim = e.payload?.claimRole as Role | undefined;
      return (
        <div className="group flex gap-3 py-1.5" data-seq={e.seq}>
          {actor && <Avatar seatId={actor.seatId} name={actor.name} seed={actor.avatarSeed} size={36} />}
          <div className="min-w-0 max-w-[42rem] flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Who id={e.actorSeatId} seats={seats} />
              {night && <span className="rounded-full bg-mafia/15 px-2 py-0.5 text-[11px] font-semibold text-mafia">🔒 mafia channel</span>}
              {claim && <span className="text-xs text-muted">claims</span>}
              {claim && <RoleBadge role={claim} />}
              {lie && (
                <span className="text-sm" title="Likely lie: a mafia player fake-claiming or accusing someone innocent">
                  🤥
                </span>
              )}
              <button
                type="button"
                onClick={onShare}
                className="ml-auto text-xs text-faint opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                aria-label="Copy link to this moment"
              >
                🔗 share
              </button>
            </div>
            <div
              className={`inline-block rounded-[var(--radius-bubble)] rounded-tl-md px-4 py-2.5 leading-relaxed ${night ? 'border border-mafia/40 bg-mafia/10' : 'bg-panel-2'}`}
            >
              {e.text}
              {typeof accused === 'string' && (
                <span className="ml-2 whitespace-nowrap text-xs text-muted">
                  👉 <Who id={accused} seats={seats} />
                </span>
              )}
            </div>
            {showThought && beat.thought && <Thought text={beat.thought.text} revealed={thoughtRevealed} onReveal={onRevealThought} />}
          </div>
        </div>
      );
    }

    case 'night_action': {
      const icon = e.type === 'kill_vote' ? '🔪' : e.type === 'save' ? '💉' : '🔍';
      return (
        <div className="py-1 pl-12">
          <div className="inline-flex items-center gap-2 rounded-xl border border-line/70 bg-night/60 px-3 py-1.5 text-sm text-muted">
            <span aria-hidden>{icon}</span>
            <Who id={e.actorSeatId} seats={seats} />
            <span>{e.type === 'kill_vote' ? 'wants to kill' : e.type === 'save' ? 'protects' : 'investigates'}</span>
            <Who id={e.targetSeatId} seats={seats} />
            {e.type === 'investigate_result' && (
              <span className={e.payload?.isMafia ? 'font-semibold text-mafia' : 'font-semibold text-doctor'}>→ {e.payload?.isMafia ? 'MAFIA' : 'not mafia'}</span>
            )}
          </div>
          {showThought && beat.thought && <Thought text={beat.thought.text} revealed={thoughtRevealed} onReveal={onRevealThought} />}
        </div>
      );
    }

    case 'vote':
      return (
        <div className="py-0.5 pl-12 text-sm">
          <span className="text-muted">🗳️ </span>
          <Who id={e.actorSeatId} seats={seats} /> <span className="text-muted">votes</span> <Who id={e.targetSeatId} seats={seats} />
          {showThought && beat.thought && <Thought text={beat.thought.text} revealed={thoughtRevealed} onReveal={onRevealThought} />}
        </div>
      );

    case 'death':
    case 'eliminated': {
      const role = e.payload?.role as Role | undefined;
      const s = e.targetSeatId ? seats.get(e.targetSeatId) : undefined;
      return (
        <div className="my-3 flex justify-center">
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3" style={role ? { borderColor: `color-mix(in oklab, ${ROLE_META[role].color} 50%, transparent)` } : undefined}>
            {s && <Avatar seatId={s.seatId} name={s.name} seed={s.avatarSeed} size={40} dead />}
            {role && <RevealCard role={role} size={34} />}
            <div>
              <div className="font-semibold">
                {beat.kind === 'death' ? '💀 ' : '⚖️ '}
                <Who id={e.targetSeatId} seats={seats} /> {beat.kind === 'death' ? 'was found dead' : 'was voted out'}
              </div>
              {role && (
                <div className="mt-1 flex items-center gap-2 text-sm text-muted">
                  They were <RoleBadge role={role} />
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    case 'survived':
      return <p className="my-2 text-center text-sm font-semibold text-doctor">🛡️ Somebody was attacked last night… and survived.</p>;

    case 'no_elimination':
      return <p className="my-2 text-center text-sm text-muted">🤝 The vote is tied. Nobody is eliminated.</p>;

    case 'notes':
      return (
        <div className="py-1 pl-12 text-sm text-muted">
          📝 <Who id={e.actorSeatId} seats={seats} /> wrote private notes
          {showThought && <Thought text={e.text} revealed={thoughtRevealed} onReveal={onRevealThought} />}
        </div>
      );

    case 'game_over': {
      const outcome = e.payload?.outcome as string;
      return (
        <div className="my-4 rounded-2xl border border-line bg-panel px-4 py-4 text-center font-display text-xl font-extrabold">
          {outcome === 'mafia' ? '🔪 Mafia wins' : outcome === 'town' ? '🏘️ Town wins' : '🤝 Draw'}
        </div>
      );
    }
  }
}
