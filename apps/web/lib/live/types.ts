import type { GameEvent, GameState } from '@ai-mafia/engine';
import type { AgentCall } from '@ai-mafia/agents';

/** A signed-in user, as far as the server is concerned. */
export interface SessionUser {
  /** Supabase auth user id (uuid). */
  id: string;
  /** GitHub numeric user id (from the provider identity, not user-editable metadata). */
  githubId: string | null;
  login: string | null;
  avatarUrl: string | null;
}

export interface LiveGame {
  id: string;
  state: GameState;
  version: number;
  status: 'running' | 'awaiting_input' | 'finished' | 'aborted';
  costUsd: number;
  mode: 'bench' | 'live' | 'human';
  createdBy: string | null;
  createdAt: string;
}

export interface StepCommit {
  state: GameState;
  newEvents: GameEvent[];
  calls: AgentCall[];
  costUsd: number;
}

/** Server-side persistence for live games (Supabase in prod, memory in tests). All writes are service-role. */
export interface LiveStore {
  createLiveGame(state: GameState, createdBy: string): Promise<string>;
  loadLive(id: string): Promise<LiveGame | null>;
  /** Lease the next step at `version`; true = this caller may call the model. */
  claimStep(id: string, version: number, leaseMs: number): Promise<boolean>;
  /** Compare-and-swap on version. false = someone else already advanced. */
  commitStep(id: string, version: number, c: StepCommit): Promise<boolean>;
  abort(id: string): Promise<boolean>;
  takeToken(key: string, capacity: number, refillPerSec: number): Promise<boolean>;
  spendToday(): Promise<number>;
  gamesCreatedToday(userId: string): Promise<number>;
  listActive(limit: number): Promise<LiveGame[]>;
}

/** Cost and abuse limits (BRD §9.5). */
export interface Limits {
  dailyBudgetUsd: number;
  maxGameCostUsd: number;
  maxGamesPerUserPerDay: number;
  /** Token-bucket sizes for POST /api/games (refilled over an hour). */
  createPerUserPerHour?: number;
  createPerIpPerHour?: number;
}

export function limitsFromEnv(env: Record<string, string | undefined> = process.env): Limits {
  const n = (v: string | undefined, d: number) => {
    const x = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(x) && x >= 0 ? x : d;
  };
  return {
    dailyBudgetUsd: n(env.DAILY_BUDGET_USD, 2),
    maxGameCostUsd: n(env.MAX_GAME_COST_USD, 0.25),
    maxGamesPerUserPerDay: n(env.MAX_LIVE_GAMES_PER_USER_PER_DAY, 3),
    createPerUserPerHour: n(env.CREATE_PER_USER_PER_HOUR, 5),
    createPerIpPerHour: n(env.CREATE_PER_IP_PER_HOUR, 10),
  };
}
