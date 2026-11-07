import type { GameEvent, Outcome, Phase, Role } from '@ai-mafia/engine';

export type BeatKind =
  | 'start'
  | 'phase'
  | 'speech'
  | 'mafia_chat'
  | 'night_action'
  | 'vote'
  | 'death'
  | 'survived'
  | 'eliminated'
  | 'no_elimination'
  | 'notes'
  | 'game_over';

/** One step of playback: a displayable event plus the private thought that explains it (spectator view only). */
export interface Beat {
  kind: BeatKind;
  event: GameEvent;
  thought?: GameEvent;
  /** True when the beat itself is hidden information (mafia channel, night actions, notes). */
  secret: boolean;
}

const KIND: Partial<Record<GameEvent['type'], BeatKind>> = {
  game_start: 'start',
  phase: 'phase',
  speech: 'speech',
  mafia_chat: 'mafia_chat',
  kill_vote: 'night_action',
  save: 'night_action',
  investigate_result: 'night_action',
  vote: 'vote',
  death: 'death',
  survived_attack: 'survived',
  eliminated: 'eliminated',
  no_elimination: 'no_elimination',
  notes: 'notes',
  game_over: 'game_over',
};

/** Events → beats. Thoughts attach to the event they explain; role reveals and fallbacks aren't beats. */
export function buildTimeline(events: readonly GameEvent[]): Beat[] {
  const thoughts = new Map<number, GameEvent>();
  for (const e of events) if (e.type === 'thought' && e.replyToSeq !== undefined) thoughts.set(e.replyToSeq, e);
  const beats: Beat[] = [];
  for (const e of events) {
    const kind = KIND[e.type];
    if (!kind) continue;
    beats.push({ kind, event: e, thought: thoughts.get(e.seq), secret: e.visibility.kind !== 'public' });
  }
  return beats;
}

export interface VoteEdge {
  from: string;
  to: string;
}

export interface TableState {
  day: number;
  phase: Phase;
  alive: Set<string>;
  /** Roles known at this point (deaths, eliminations, game over). */
  revealed: Map<string, Role>;
  /** Votes cast so far in the current day's vote. */
  votes: VoteEdge[];
  /** Last completed vote (for the vote graph after it resolves). */
  lastVotes: VoteEdge[];
  outcome?: Outcome;
  /** Seat currently speaking/acting (for highlighting). */
  actor?: string;
}

/** Table state after the first `count` beats. Pure; cheap enough to recompute on every tick for a few hundred beats. */
export function stateAt(beats: readonly Beat[], seatIds: readonly string[], count: number): TableState {
  const s: TableState = { day: 0, phase: 'setup', alive: new Set(seatIds), revealed: new Map(), votes: [], lastVotes: [] };
  for (const b of beats.slice(0, Math.max(0, count))) {
    const e = b.event;
    s.day = e.day;
    s.actor = e.actorSeatId;
    switch (b.kind) {
      case 'phase': {
        s.phase = (e.payload?.phase as Phase) ?? e.phase;
        if (s.phase === 'vote') s.votes = [];
        break;
      }
      case 'vote':
        if (e.actorSeatId && e.targetSeatId) s.votes = [...s.votes, { from: e.actorSeatId, to: e.targetSeatId }];
        break;
      case 'death':
      case 'eliminated':
        if (e.targetSeatId) {
          s.alive = new Set([...s.alive].filter((x) => x !== e.targetSeatId));
          if (e.payload?.role) s.revealed = new Map(s.revealed).set(e.targetSeatId, e.payload.role as Role);
        }
        if (b.kind === 'eliminated') s.lastVotes = s.votes;
        break;
      case 'no_elimination':
        s.lastVotes = s.votes;
        break;
      case 'game_over': {
        s.phase = 'end';
        s.outcome = e.payload?.outcome as Outcome;
        const roles = (e.payload?.roles ?? {}) as Record<string, Role>;
        s.revealed = new Map(Object.entries(roles));
        break;
      }
    }
  }
  return s;
}

/** How long a beat stays on screen at 1× before the next one (reading time for speech). */
/** How long a beat stays on screen at `speed`. With `withThought` (spectator mode) the private thought's reading time is added. */
export function beatDelayMs(b: Beat, speed: number, withThought = false): number {
  const base =
    b.kind === 'speech' || b.kind === 'mafia_chat' || b.kind === 'notes'
      ? 900 + Math.min(b.event.text.length, 280) * 22
      : b.kind === 'phase' || b.kind === 'death' || b.kind === 'eliminated' || b.kind === 'game_over'
        ? 1800
        : b.kind === 'vote'
          ? 700
          : 1000;
  const thought = withThought && b.thought ? 600 + Math.min(b.thought.text.length, 400) * 18 : 0;
  return speed === Infinity ? 0 : (base + thought) / speed;
}

/** Index of the first beat at or after `seq` (for ?t= deep links). */
export function indexForSeq(beats: readonly Beat[], seq: number): number {
  const i = beats.findIndex((b) => b.event.seq >= seq);
  return i === -1 ? beats.length : i + 1; // show through that beat
}

export interface Marker {
  index: number;
  kind: 'night' | 'day' | 'vote' | 'death';
  label: string;
}

/** Scrubber markers: 🌙 ☀️ 🗳️ phase starts and 💀 deaths. */
export function markers(beats: readonly Beat[]): Marker[] {
  const out: Marker[] = [];
  beats.forEach((b, i) => {
    if (b.kind === 'phase') {
      const p = b.event.payload?.phase as Phase;
      if (p === 'night' || p === 'day' || p === 'vote') out.push({ index: i, kind: p, label: `${p === 'night' ? 'Night' : p === 'day' ? 'Day' : 'Vote'} ${b.event.day}` });
    }
    if (b.kind === 'death' || b.kind === 'eliminated') out.push({ index: i, kind: 'death', label: b.event.text });
  });
  return out;
}

/** Simple lie heuristic for the 🤥 marker (§10.3): mafia speech that fake-claims a role or accuses a town player. */
export function isLikelyLie(b: Beat, roles: ReadonlyMap<string, Role>): boolean {
  if (b.kind !== 'speech' || !b.event.actorSeatId) return false;
  if (roles.get(b.event.actorSeatId) !== 'mafia') return false;
  const claim = b.event.payload?.claimRole as Role | undefined;
  if (claim && claim !== 'mafia') return true;
  const accused = b.event.payload?.accuses as string | undefined;
  return !!accused && roles.has(accused) && roles.get(accused) !== 'mafia';
}
