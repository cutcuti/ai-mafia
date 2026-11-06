export type Role = 'mafia' | 'detective' | 'doctor' | 'villager';
export type Team = 'mafia' | 'town';
export type Phase = 'setup' | 'night' | 'day' | 'vote' | 'end';

// ── Data model (BRD §4, §6) ──

export type Outcome = 'town' | 'mafia' | 'draw';

export interface Persona {
  id: string;
  label: string;
  description: string;
  avatarSeed: string;
}

export type Controller =
  | { kind: 'model'; modelId: string } // key into the models registry
  | { kind: 'human'; userId: string }
  | { kind: 'random' }; // tests / dev

export interface Seat {
  id: string; // stable seat id, e.g. "s3"
  name: string; // display name, e.g. "Zara" — what agents see
  role: Role;
  persona: Persona;
  controller: Controller;
  alive: boolean;
}

export type EventType =
  | 'game_start'
  | 'role_reveal'
  | 'team_reveal'
  | 'phase'
  | 'speech'
  | 'mafia_chat'
  | 'thought'
  | 'kill_vote'
  | 'save'
  | 'investigate_result'
  | 'death'
  | 'survived_attack'
  | 'vote'
  | 'eliminated'
  | 'no_elimination'
  | 'fallback'
  | 'game_over';

export type Visibility =
  | { kind: 'public' }
  | { kind: 'team'; team: 'mafia' }
  | { kind: 'seat'; seatId: string }
  | { kind: 'spectator' };

export interface GameEvent {
  gameId: string;
  seq: number; // 0-based, gapless, monotonic per game
  day: number;
  phase: Phase;
  type: EventType;
  visibility: Visibility;
  actorSeatId?: string;
  targetSeatId?: string;
  text: string; // human-readable line
  payload?: Record<string, unknown>;
  replyToSeq?: number; // thought → the action event it explains
  createdAt: string; // ISO
}

export interface RoleCounts {
  mafia: number;
  detective: number;
  doctor: number;
  villager: number;
}

export interface GameConfig {
  gameId: string;
  preset: string; // preset name, or 'custom'
  roles: RoleCounts;
  /** One controller per seat; length must equal the total role count. */
  controllers: Controller[];
  seed: number;
  rounds: number; // discussion rounds per day
  maxDays: number; // draw after this many days
  maxSpeechChars: number;
  /** 'neutral' gives every seat the same plain persona (benchmark mode, less variance). Default 'default'. */
  personaMode?: 'default' | 'neutral';
  /** Stamped on every event. Supplied by the caller so the engine never reads the clock (I4). */
  createdAt: string;
}

export type ChooseAction = 'kill' | 'save' | 'investigate' | 'vote';

export type InputRequest =
  | { id: string; seatId: string; kind: 'speak'; channel: 'public' | 'mafia'; maxChars: number }
  | { id: string; seatId: string; kind: 'choose'; action: ChooseAction; options: string[] };

export type InputResponse =
  | { kind: 'speak'; thought: string; speech: string; accuses?: string; claimRole?: Role }
  | { kind: 'choose'; thought: string; target: string };

/** What a queued request step will ask for. Options/ids are materialized when it reaches the head of the queue. */
export type Ask = 'speak_public' | 'speak_mafia' | ChooseAction;

export type AutoOp = 'start_phase' | 'resolve_night' | 'resolve_vote' | 'check_win';

export type Step =
  | { kind: 'request'; seatId: string; ask: Ask }
  | { kind: 'auto'; op: AutoOp; phase?: 'night' | 'day' | 'vote' };

export interface GameState {
  id: string;
  config: GameConfig;
  rngState: number; // mulberry32 internal state (uint32)
  seats: Seat[];
  events: GameEvent[];
  day: number;
  phase: Phase;
  queue: Step[]; // remaining steps
  memory: { lastSave?: string; investigated: string[] };
  status: 'running' | 'awaiting_input' | 'finished';
  outcome?: Outcome;
  version: number; // bumped on every applied response (optimistic concurrency)
}

/** Everything an agent may know when it acts. Built only from events it can see (I1). */
export interface AgentContext {
  self: { seatId: string; name: string; role: Role; persona: Persona };
  teammates: string[]; // names of other mafia; empty for town
  alive: string[]; // names
  /** seatId ↔ name for every seat (public info from game_start), so controllers can map ids to names. */
  roster: { seatId: string; name: string }[];
  day: number;
  phase: Phase;
  observations: GameEvent[];
  notes?: string;
}
