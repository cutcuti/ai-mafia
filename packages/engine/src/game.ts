import { observationsFor } from './events.js';
import type { Rng } from './rng.js';
import type {
  Action,
  Agent,
  V0AgentContext,
  ChooseResult,
  V0EventType,
  V0Event,
  GameResult,
  Phase,
  Player,
  Team,
  V0Visibility,
} from './types.js';

export interface GameOptions {
  discussionRounds?: number; // speeches per player per day
  maxDays?: number;
  onEvent?: (e: V0Event) => void; // live streaming hook (CLI now, websockets later)
}

const PUBLIC: V0Visibility = { kind: 'public' };
const MAFIA: V0Visibility = { kind: 'team', team: 'mafia' };
const SPECTATOR: V0Visibility = { kind: 'spectator' };
const only = (playerId: string): V0Visibility => ({ kind: 'player', playerId });

export function checkWinner(players: Player[]): Team | null {
  const alive = players.filter((p) => p.alive);
  const mafia = alive.filter((p) => p.role === 'mafia').length;
  const town = alive.length - mafia;
  if (mafia === 0) return 'town';
  if (mafia >= town) return 'mafia';
  return null;
}

/** Plurality winner; null on a tie or no votes. */
export function tally(votes: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  let tied = false;
  for (const [k, n] of counts) {
    if (n > bestN) [best, bestN, tied] = [k, n, false];
    else if (n === bestN) tied = true;
  }
  return tied ? null : best;
}

export class Game {
  readonly events: V0Event[] = [];
  private day = 0;
  private phase: Phase = 'setup';
  private readonly rounds: number;
  private readonly maxDays: number;

  constructor(
    readonly players: Player[],
    private readonly agents: Map<string, Agent>,
    private readonly rng: Rng,
    private readonly opts: GameOptions = {},
  ) {
    this.rounds = opts.discussionRounds ?? 2;
    this.maxDays = opts.maxDays ?? 10;
  }

  async run(): Promise<GameResult> {
    this.setup();
    let winner: Team | null = null;
    while (!winner && this.day < this.maxDays) {
      this.day++;
      await this.night();
      winner = checkWinner(this.players);
      if (winner) break;
      await this.dayPhase();
      winner = checkWinner(this.players);
    }
    winner ??= 'town'; // safety valve: stalled games go to town
    this.phase = 'end';
    const roles = this.players.map((p) => `${p.id} (${p.role})`).join(', ');
    this.emit('game_over', PUBLIC, `${winner.toUpperCase()} WINS. Roles were: ${roles}`);
    return { winner, days: this.day, players: this.players, events: this.events };
  }

  // ── phases ────────────────────────────────────────────────────────────────

  private setup() {
    this.emit('phase', PUBLIC, `Players at the table: ${this.players.map((p) => p.id).join(', ')}`);
    for (const p of this.players) {
      this.emit('role_reveal', only(p.id), `You are ${p.id}. Your secret role is ${p.role.toUpperCase()}.`);
    }
    const mafia = this.players.filter((p) => p.role === 'mafia').map((p) => p.id);
    this.emit('role_reveal', MAFIA, `The mafia team is: ${mafia.join(' and ')}.`);
  }

  private async night() {
    this.phase = 'night';
    this.emit('phase', PUBLIC, `Night ${this.day} falls. Everyone closes their eyes.`);

    // 1. Mafia talk privately, then each proposes a kill.
    const mafia = this.alive().filter((p) => p.role === 'mafia');
    for (const m of mafia) {
      const r = await this.agent(m).speak(this.ctx(m), 'mafia');
      this.emit('thought', SPECTATOR, r.thought, m.id);
      this.emit('mafia_chat', MAFIA, r.speech, m.id);
    }
    const killOptions = this.alive().filter((p) => p.role !== 'mafia').map((p) => p.id);
    const killVotes: string[] = [];
    for (const m of mafia) {
      const r = await this.decide(m, 'kill', killOptions);
      killVotes.push(r.target);
      this.emit('kill_vote', MAFIA, `${m.id} wants to kill ${r.target}.`, m.id, r.target);
    }
    const victim = tally(killVotes) ?? killVotes[0];

    // 2. Doctor protects someone (self allowed).
    let saved: string | null = null;
    const doctor = this.alive().find((p) => p.role === 'doctor');
    if (doctor) {
      const r = await this.decide(doctor, 'save', this.alive().map((p) => p.id));
      saved = r.target;
      this.emit('save', only(doctor.id), `You protected ${r.target} tonight.`, doctor.id, r.target);
    }

    // 3. Detective investigates someone else.
    const detective = this.alive().find((p) => p.role === 'detective');
    if (detective) {
      const options = this.alive().filter((p) => p.id !== detective.id).map((p) => p.id);
      const r = await this.decide(detective, 'investigate', options);
      const isMafia = this.byId(r.target).role === 'mafia';
      this.emit(
        'investigate_result',
        only(detective.id),
        `Investigation: ${r.target} is ${isMafia ? 'MAFIA' : 'NOT mafia'}.`,
        detective.id,
        r.target,
      );
    }

    // 4. Resolve.
    if (victim === saved) {
      this.emit('no_death', PUBLIC, `Morning comes. Somebody was attacked, but nobody died.`);
    } else {
      const v = this.byId(victim);
      v.alive = false;
      this.emit('death', PUBLIC, `Morning comes. ${v.id} was found dead. They were ${v.role.toUpperCase()}.`, undefined, v.id);
    }
  }

  private async dayPhase() {
    this.phase = 'day';
    this.emit('phase', PUBLIC, `Day ${this.day}. Discuss. Alive: ${this.alive().map((p) => p.id).join(', ')}`);

    for (let round = 0; round < this.rounds; round++) {
      // rotate speaking order each round so nobody always goes first
      const order = this.rng.shuffle(this.alive());
      for (const p of order) {
        const r = await this.agent(p).speak(this.ctx(p), 'public');
        this.emit('thought', SPECTATOR, r.thought, p.id);
        this.emit('speech', PUBLIC, r.speech, p.id);
      }
    }

    this.phase = 'vote';
    this.emit('phase', PUBLIC, `Voting time. Each player votes to eliminate someone.`);
    const votes: string[] = [];
    for (const p of this.alive()) {
      const options = this.alive().filter((o) => o.id !== p.id).map((o) => o.id);
      const r = await this.decide(p, 'vote', options);
      votes.push(r.target);
      this.emit('vote', PUBLIC, `${p.id} votes for ${r.target}.`, p.id, r.target);
    }
    const out = tally(votes);
    if (!out) {
      this.emit('no_elimination', PUBLIC, `The vote is tied. Nobody is eliminated.`);
      return;
    }
    const o = this.byId(out);
    o.alive = false;
    this.emit('eliminated', PUBLIC, `${o.id} is eliminated by vote. They were ${o.role.toUpperCase()}.`, undefined, o.id);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Ask an agent to pick a target; never trust the output — fall back to random if invalid. */
  private async decide(p: Player, action: Action, options: string[]): Promise<ChooseResult> {
    let r: ChooseResult;
    try {
      r = await this.agent(p).choose(this.ctx(p), action, options);
    } catch (err) {
      r = { thought: `(agent error: ${(err as Error).message})`, target: '' };
    }
    if (r.thought) this.emit('thought', SPECTATOR, r.thought, p.id);
    if (!options.includes(r.target)) {
      const fallback = this.rng.pick(options);
      this.emit('fallback', SPECTATOR, `${p.id} gave invalid ${action} target "${r.target}", using ${fallback}.`, p.id);
      r = { ...r, target: fallback };
    }
    return r;
  }

  private ctx(p: Player): V0AgentContext {
    return {
      self: { id: p.id, role: p.role, persona: p.persona },
      teammates: p.role === 'mafia' ? this.players.filter((o) => o.role === 'mafia' && o.id !== p.id).map((o) => o.id) : [],
      alive: this.alive().map((o) => o.id),
      day: this.day,
      phase: this.phase,
      observations: observationsFor(p, this.events),
    };
  }

  private emit(type: V0EventType, visibility: V0Visibility, text: string, actor?: string, target?: string) {
    const e: V0Event = { seq: this.events.length, day: this.day, phase: this.phase, type, visibility, text, actor, target };
    this.events.push(e);
    this.opts.onEvent?.(e);
  }

  private alive() {
    return this.players.filter((p) => p.alive);
  }
  private byId(id: string) {
    const p = this.players.find((o) => o.id === id);
    if (!p) throw new Error(`unknown player ${id}`);
    return p;
  }
  private agent(p: Player) {
    const a = this.agents.get(p.id);
    if (!a) throw new Error(`no agent for ${p.id}`);
    return a;
  }
}
