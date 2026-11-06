import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeMetrics, summarize, type ModelMetrics } from './metrics.js';
import { computeRatings } from './ratings.js';
import type { BenchOptions, GameRecord } from './runner.js';
import { MIN_GAMES_PER_ROLE, wilson, type Interval } from './stats.js';

export interface ReportInput {
  runId: string;
  options: Pick<BenchOptions, 'format' | 'a' | 'b' | 'model' | 'models' | 'preset' | 'seedBase' | 'personaMode' | 'dryRun' | 'budgetUsd'>;
  records: readonly GameRecord[];
  planned: number;
  skippedForBudget: number;
  /** Games carried over from an earlier invocation of the same run. */
  resumed?: number;
  /** ISO date for the header; passed in so report generation stays pure. */
  generatedAt: string;
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');
const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const usd = (x: number) => (Number.isFinite(x) ? `$${x.toFixed(4)}` : '—');
const ci = (i: Interval) => (i.n ? `${pct(i.p)} [${pct(i.lo)}–${pct(i.hi)}] (n=${i.n})` : '—');

function table(head: string[], rows: string[][]): string {
  return [`| ${head.join(' | ')} |`, `| ${head.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/** Win-rate intervals for one model's team records (draws stay in the denominator). */
export function winIntervals(m: ModelMetrics) {
  return { mafia: wilson(m.mafia.wins, m.mafia.games), town: wilson(m.town.wins, m.town.games) };
}

export interface ReportResult {
  markdown: string;
  /** Compact lines for the terminal. */
  summary: string[];
}

export function buildReport(input: ReportInput): ReportResult {
  const { records, options: o } = input;
  const metrics = computeMetrics(records);
  const models = [...metrics.keys()].sort();
  const sums = new Map(models.map((id) => [id, summarize(metrics.get(id)!)]));
  const ratings = computeRatings(records);
  const outcomes = { town: 0, mafia: 0, draw: 0 };
  for (const r of records) outcomes[r.outcome]++;
  const n = records.length;
  const cost = records.reduce((a, r) => a + r.costUsd, 0);
  const seeds = records.map((r) => r.seed);
  const promptVersions = [...new Set(records.map((r) => r.promptVersion))].join(', ') || '—';
  const who = o.format === 'h2h' ? `**${o.a}** vs **${o.b}**` : o.format === 'self' ? `**${o.model}** (self-play)` : (o.models ?? []).map((m) => `**${m}**`).join(', ');

  const md: string[] = [];
  md.push(`# Bench report — ${input.runId}`);
  md.push('');
  md.push(`${who} · format \`${o.format}\` · preset \`${o.preset}\` · prompt \`${promptVersions}\` · personas \`${o.personaMode ?? 'default'}\`${o.dryRun ? ' · **DRY RUN (mocked models — numbers are not real)**' : ''}`);
  md.push('');
  md.push(`Generated ${input.generatedAt}. ${n} of ${input.planned} planned games played${input.resumed ? ` (${input.resumed} resumed from an earlier invocation)` : ''}${input.skippedForBudget ? ` (${input.skippedForBudget} skipped: budget ${usd(o.budgetUsd ?? NaN)} reached)` : ''}; seeds ${seeds.length ? `${Math.min(...seeds)}–${Math.max(...seeds)}` : '—'}. Total cost ${usd(cost)}.`);
  md.push('');

  md.push('## Outcomes');
  md.push('');
  md.push(table(['', 'games', 'share'], [
    ['Town wins', String(outcomes.town), pct(n ? outcomes.town / n : NaN)],
    ['Mafia wins', String(outcomes.mafia), pct(n ? outcomes.mafia / n : NaN)],
    ['Draws', String(outcomes.draw), pct(n ? outcomes.draw / n : NaN)],
  ]));
  md.push('');
  md.push(`Mafia win rate across all games: ${ci(wilson(outcomes.mafia, n))}.${o.format === 'self' ? ' This is the self-play baseline for this preset — compare head-to-head results against it.' : ''}`);
  md.push('');

  if (o.format === 'h2h') {
    md.push('## Head to head');
    md.push('');
    const dir = (d: 'a-mafia' | 'b-mafia') => records.filter((r) => r.direction === d);
    const mafiaWins = (rs: readonly GameRecord[]) => wilson(rs.filter((r) => r.outcome === 'mafia').length, rs.length);
    md.push(table(['mafia side', 'town side', 'mafia win rate (95% CI)', 'draws'], [
      [o.a!, o.b!, ci(mafiaWins(dir('a-mafia'))), String(dir('a-mafia').filter((r) => r.outcome === 'draw').length)],
      [o.b!, o.a!, ci(mafiaWins(dir('b-mafia'))), String(dir('b-mafia').filter((r) => r.outcome === 'draw').length)],
    ]));
    md.push('');
    md.push(`Same seeds both ways, so the gap between the rows is the skill difference net of the table's structural mafia/town edge. Run \`--format self\` on each model for the baseline.`);
    md.push('');
  }

  md.push('## Win rates by role');
  md.push('');
  md.push(table(['model', 'as mafia (95% CI)', 'as town (95% CI)', 'draws', 'status'], models.map((id) => {
    const m = metrics.get(id)!;
    const w = winIntervals(m);
    const provisional = m.mafia.games < MIN_GAMES_PER_ROLE || m.town.games < MIN_GAMES_PER_ROLE;
    return [id, ci(w.mafia), ci(w.town), String(m.mafia.draws + m.town.draws), provisional ? `provisional (<${MIN_GAMES_PER_ROLE}/role)` : 'ranked'];
  })));
  md.push('');

  md.push('## Behaviour');
  md.push('');
  md.push(table(['model', 'deception', 'lie rate', 'town vote acc.', 'persuasion', 'det. hit (base)', 'det. conversion', 'doctor block', 'survival M / T'], models.map((id) => {
    const s = sums.get(id)!;
    return [id, num(s.deceptionScore), pct(s.lieRate), pct(s.townVoteAccuracy), pct(s.persuasion), `${pct(s.detectiveHitRate)} (${pct(s.detectiveBaseRate)})`, pct(s.detectiveConversion), pct(s.doctorBlockRate), `${num(s.survivalMafia, 1)} / ${num(s.survivalTown, 1)}`];
  })));
  md.push('');
  md.push('Deception = 1 − votes received ÷ votes expected under uniform voting (higher = drew less suspicion; can be negative). Survival = day phases reached alive.');
  md.push('');

  md.push('## Ratings (OpenSkill, this run only)');
  md.push('');
  md.push(table(['scope', 'model', 'ordinal (μ−3σ)', 'μ ± σ', 'games'], ratings.map((r) => [r.scope, r.modelId, num(r.ordinal), `${num(r.mu)} ± ${num(r.sigma)}`, String(r.games)])));
  md.push('');
  md.push('The leaderboard recomputes ratings from all stored games (`pnpm ratings:rebuild`); these are from this run alone.');
  md.push('');

  md.push('## Cost & reliability');
  md.push('');
  md.push(table(['model', 'cost / game', 'tokens / game', 'p50 latency', 'p95 latency', 'engine fallback rate', 'calls', 'failed calls'], models.map((id) => {
    const s = sums.get(id)!;
    const c = metrics.get(id)!.calls;
    return [id, usd(s.costPerGame), num(s.tokensPerGame, 0), Number.isFinite(s.latencyP50) ? `${s.latencyP50} ms` : '—', Number.isFinite(s.latencyP95) ? `${s.latencyP95} ms` : '—', pct(s.fallbackRate), String(c.calls), String(c.callFallbacks)];
  })));
  md.push('');
  md.push('---');
  md.push(`Win rates use Wilson 95% intervals; draws count in the denominator, never as wins. A model needs ≥${MIN_GAMES_PER_ROLE} games per team role to leave provisional status.`);
  md.push('');

  const summary = [
    `${n} games · town ${outcomes.town} · mafia ${outcomes.mafia} · draw ${outcomes.draw} · ${usd(cost)}${o.dryRun ? ' (simulated)' : ''}`,
    ...models.map((id) => {
      const m = metrics.get(id)!;
      const w = winIntervals(m);
      const r = (scope: string) => ratings.find((x) => x.modelId === id && x.scope === scope);
      return `  ${id.padEnd(16)} mafia ${ci(w.mafia).padEnd(32)} town ${ci(w.town).padEnd(32)} ordinal ${num(r('overall')?.ordinal ?? NaN)}  ${usd(sums.get(id)!.costPerGame)}/game`;
    }),
  ];
  return { markdown: md.join('\n'), summary };
}

export function writeReport(dir: string, runId: string, markdown: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${runId}.md`);
  writeFileSync(file, markdown);
  return file;
}
