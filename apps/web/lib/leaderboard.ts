import { MIN_GAMES_PER_ROLE, wilson, type Interval } from './stats';

export type Scope = 'overall' | 'as_mafia' | 'as_town';
export const SCOPES: readonly Scope[] = ['as_mafia', 'as_town', 'overall'];

export interface RatingRow {
  modelId: string;
  scope: Scope;
  promptVersion: string;
  preset: string;
  mu: number;
  sigma: number;
  ordinal: number;
  games: number;
}

/** Subset of the bench's per-model summary we display (null = not applicable; JSON has no NaN). */
export interface ModelStats {
  games: number;
  mafiaGames: number;
  townGames: number;
  draws: number;
  mafiaWin: Interval;
  townWin: Interval;
  townVoteAccuracy: number | null;
  deceptionScore: number | null;
  survivalMafia: number | null;
  survivalTown: number | null;
  detectiveHitRate: number | null;
  detectiveBaseRate: number | null;
  detectiveConversion: number | null;
  doctorBlockRate: number | null;
  persuasion: number | null;
  lieRate: number | null;
  fallbackRate: number | null;
  costPerGame: number | null;
  tokensPerGame: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
}

export interface StatsRow {
  modelId: string;
  promptVersion: string;
  preset: string;
  games: number;
  stats: ModelStats;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  provider: string;
  model: string;
}

export interface LeaderboardSnapshot {
  generatedAt?: string;
  ratings: RatingRow[];
  stats: StatsRow[];
  models: ModelInfo[];
}

export interface LeaderboardRow {
  rank: number | null; // null while provisional
  modelId: string;
  displayName: string;
  provider: string;
  ordinal: number;
  mu: number;
  sigma: number;
  /** The win rate that matches the scope (as mafia, as town, or both). */
  winRate: Interval;
  games: number;
  mafiaGames: number;
  townGames: number;
  provisional: boolean;
  deceptionScore: number | null;
  townVoteAccuracy: number | null;
  costPerGame: number | null;
}

export interface LeaderboardQuery {
  scope?: string | null;
  preset?: string | null;
  promptVersion?: string | null;
}

export interface Leaderboard {
  scope: Scope;
  preset: string | null;
  promptVersion: string | null;
  presets: string[];
  promptVersions: string[];
  rows: LeaderboardRow[];
  generatedAt?: string;
}

const uniq = (xs: string[]) => [...new Set(xs)].sort();

/** Pick sensible defaults: classic6 if present, newest prompt version. */
function defaults(s: LeaderboardSnapshot) {
  const presets = uniq(s.ratings.map((r) => r.preset));
  const promptVersions = uniq(s.ratings.map((r) => r.promptVersion));
  return {
    presets,
    promptVersions,
    preset: presets.includes('classic6') ? 'classic6' : (presets[0] ?? null),
    promptVersion: promptVersions.at(-1) ?? null,
  };
}

/**
 * Ranked rows for one tab. Ranked models (≥50 games in each team role) come first, by ordinal (μ − 3σ);
 * provisional models follow, unranked (BRD §8.5).
 */
export function buildLeaderboard(s: LeaderboardSnapshot, q: LeaderboardQuery = {}): Leaderboard {
  const d = defaults(s);
  const scope: Scope = (SCOPES as readonly string[]).includes(q.scope ?? '') ? (q.scope as Scope) : 'as_mafia';
  const preset = q.preset && d.presets.includes(q.preset) ? q.preset : d.preset;
  const promptVersion = q.promptVersion && d.promptVersions.includes(q.promptVersion) ? q.promptVersion : d.promptVersion;
  const info = new Map(s.models.map((m) => [m.id, m]));
  const stats = new Map(s.stats.filter((x) => x.preset === preset && x.promptVersion === promptVersion).map((x) => [x.modelId, x.stats]));

  const rows = s.ratings
    .filter((r) => r.scope === scope && r.preset === preset && r.promptVersion === promptVersion)
    .map((r): Omit<LeaderboardRow, 'rank'> => {
      const st = stats.get(r.modelId);
      const mafiaGames = st?.mafiaGames ?? 0;
      const townGames = st?.townGames ?? 0;
      const mw = st?.mafiaWin ?? wilson(0, 0);
      const tw = st?.townWin ?? wilson(0, 0);
      const winRate =
        scope === 'as_mafia' ? mw : scope === 'as_town' ? tw : wilson(Math.round(mw.p * mw.n || 0) + Math.round(tw.p * tw.n || 0), mw.n + tw.n);
      return {
        modelId: r.modelId,
        displayName: info.get(r.modelId)?.displayName ?? r.modelId,
        provider: info.get(r.modelId)?.provider ?? '',
        ordinal: r.ordinal,
        mu: r.mu,
        sigma: r.sigma,
        winRate,
        games: r.games,
        mafiaGames,
        townGames,
        provisional: mafiaGames < MIN_GAMES_PER_ROLE || townGames < MIN_GAMES_PER_ROLE,
        deceptionScore: st?.deceptionScore ?? null,
        townVoteAccuracy: st?.townVoteAccuracy ?? null,
        costPerGame: st?.costPerGame ?? null,
      };
    })
    .sort((a, b) => Number(a.provisional) - Number(b.provisional) || b.ordinal - a.ordinal);

  let rank = 0;
  return {
    scope,
    preset,
    promptVersion,
    presets: d.presets,
    promptVersions: d.promptVersions,
    generatedAt: s.generatedAt,
    rows: rows.map((r) => ({ ...r, rank: r.provisional ? null : ++rank })),
  };
}

/** Everything for one model's profile, across presets and prompt versions. */
export function modelProfile(s: LeaderboardSnapshot, id: string) {
  const info = s.models.find((m) => m.id === id);
  const ratings = s.ratings.filter((r) => r.modelId === id);
  const stats = s.stats.filter((r) => r.modelId === id);
  if (!info && ratings.length === 0) return null;
  return { model: info ?? { id, displayName: id, provider: '', model: '' }, ratings, stats };
}

// ── head to head (computed from games + seats, BRD §10.2 /h2h/[a]/[b]) ──

/** A finished game reduced to who sat on which team. */
export interface PairGame {
  id: string;
  outcome: 'town' | 'mafia' | 'draw';
  preset: string;
  promptVersion: string;
  mafiaModels: string[];
  townModels: string[];
}

const only = (xs: string[], m: string) => xs.length > 0 && xs.every((x) => x === m);

export interface H2HSide {
  mafia: string;
  town: string;
  games: number;
  mafiaWins: Interval;
  draws: number;
}

export interface H2HSummary {
  a: string;
  b: string;
  preset: string;
  promptVersion: string | null;
  aMafia: H2HSide;
  bMafia: H2HSide;
  /** Self-play baselines (one model in every seat): the table's structural mafia edge for that model. */
  selfA: { games: number; mafiaWins: Interval };
  selfB: { games: number; mafiaWins: Interval };
  /** All games of this preset, any models. */
  table: { games: number; mafiaWins: Interval };
}

function side(games: PairGame[], mafia: string, town: string): H2HSide {
  const gs = games.filter((g) => only(g.mafiaModels, mafia) && only(g.townModels, town));
  return { mafia, town, games: gs.length, mafiaWins: wilson(gs.filter((g) => g.outcome === 'mafia').length, gs.length), draws: gs.filter((g) => g.outcome === 'draw').length };
}

function selfPlay(games: PairGame[], m: string) {
  const gs = games.filter((g) => only(g.mafiaModels, m) && only(g.townModels, m));
  return { games: gs.length, mafiaWins: wilson(gs.filter((g) => g.outcome === 'mafia').length, gs.length) };
}

export function h2hSummary(all: readonly PairGame[], a: string, b: string, preset = 'classic6', promptVersion?: string | null): H2HSummary {
  const versions = uniq(all.filter((g) => g.preset === preset).map((g) => g.promptVersion));
  const pv = promptVersion && versions.includes(promptVersion) ? promptVersion : (versions.at(-1) ?? null);
  const games = all.filter((g) => g.preset === preset && g.promptVersion === pv);
  return {
    a,
    b,
    preset,
    promptVersion: pv,
    aMafia: side(games, a, b),
    bMafia: side(games, b, a),
    selfA: selfPlay(games, a),
    selfB: selfPlay(games, b),
    table: { games: games.length, mafiaWins: wilson(games.filter((g) => g.outcome === 'mafia').length, games.length) },
  };
}
