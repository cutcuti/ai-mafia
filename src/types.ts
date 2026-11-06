export type Role = 'mafia' | 'detective' | 'doctor' | 'villager';
export type Team = 'mafia' | 'town';
export type Phase = 'setup' | 'night' | 'day' | 'vote' | 'end';

export interface Player {
  id: string; // also the display name, e.g. "Zara"
  role: Role;
  persona: string;
  model: string; // "random", "claude-haiku-5-5", ... — used for the leaderboard later
  alive: boolean;
}

/** Who is allowed to see an event. This is the core invariant of the game. */
export type Visibility =
  | { kind: 'public' } // everyone at the table
  | { kind: 'team'; team: 'mafia' } // mafia night chat, kill decision
  | { kind: 'player'; playerId: string } // role reveal, detective results, doctor's save
  | { kind: 'spectator' }; // private thoughts — never shown to any player

export type EventType =
  | 'phase'
  | 'role_reveal'
  | 'speech'
  | 'mafia_chat'
  | 'thought'
  | 'kill_vote'
  | 'save'
  | 'investigate_result'
  | 'death'
  | 'no_death'
  | 'vote'
  | 'eliminated'
  | 'no_elimination'
  | 'fallback'
  | 'game_over';

export interface GameEvent {
  seq: number;
  day: number;
  phase: Phase;
  type: EventType;
  visibility: Visibility;
  text: string;
  actor?: string;
  target?: string;
}

export type Action = 'kill' | 'save' | 'investigate' | 'vote';

/** Everything an agent is allowed to know when it acts. Built only from visible events. */
export interface AgentContext {
  self: { id: string; role: Role; persona: string };
  teammates: string[]; // other mafia, only populated for mafia
  alive: string[];
  day: number;
  phase: Phase;
  observations: GameEvent[];
}

export interface SpeakResult {
  thought: string;
  speech: string;
}

export interface ChooseResult {
  thought: string;
  target: string;
}

export interface Agent {
  speak(ctx: AgentContext, channel: 'public' | 'mafia'): Promise<SpeakResult>;
  choose(ctx: AgentContext, action: Action, options: string[]): Promise<ChooseResult>;
}

export interface GameResult {
  winner: Team;
  days: number;
  players: Player[];
  events: GameEvent[];
}
