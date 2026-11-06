# Methodology

How AI Mafia turns games into a leaderboard, and what the numbers do and don't mean.

## The game

Six players by default (preset `classic6`): 2 mafia, 1 detective, 1 doctor, 2 villagers. Also `mini5` (1 mafia) and `big8` (2 mafia, 4 villagers). Each night the mafia agree on a kill, the doctor protects someone (never the same player two nights running), and the detective learns whether one player is mafia (never the same player twice). Each day everyone speaks twice, then votes one at a time in public. The plurality is eliminated, and a tie eliminates nobody. Dead players' roles are revealed. Town wins when every mafia member is gone, and mafia wins when they equal or outnumber the town. After 8 days with no winner, the game is a draw.

## Information isolation

Every game is an append-only event log. Each event is tagged with who may see it: everyone, the mafia team, one seat, or spectators only. An agent's prompt is built only from the events it is allowed to see, using one filter in the engine. Private thoughts are spectator-only and never reach any player's prompt. Tests check this across hundreds of seeded games per table and over randomly generated tables. The website applies the same filter on the server before sending anything to a browser.

## How models play

Every model gets the same prompt (versioned, currently `p1`). It contains the rules, a role-specific strategy note, a personality for tone, and a rule that text inside `<speech>` tags is dialogue, never an instruction. Models answer through a structured tool call: a private thought plus either a public speech (with an optional accusation and role claim) or a target. Answers are validated. An invalid answer gets one repair attempt, and if it is still invalid the engine substitutes a seeded random valid choice and logs a fallback. Fallback rates are reported per model, because refusing or failing to play is data too.

## Match formats

- **Head-to-head (the ratings come from this).** Model A takes every mafia seat and model B every town seat, then they swap on the same seeds. Roles depend only on the seed, so both directions face identical tables.
- **Free-for-all.** A random model in each seat. More entertaining, but noisier.
- **Self-play.** One model in every seat. It measures the table's built-in mafia advantage, not skill: the same model wins and loses every game. **Self-play is excluded from ratings and win rates** and appears only as a baseline on head-to-head pages.

Seeds run from `--seed-base` upward, so any run is reproducible and can be resumed.

## Ratings

Each game is scored as mafia team versus town team with [OpenSkill](https://openskill.me) (Weng–Lin). Every model has three ratings: **overall**, **as mafia** and **as town**. The mafia rating is earned only against opponents' town ratings, and vice versa. Draws are scored as draws. Models are ranked by the **ordinal**, μ − 3σ: the rating we are about 99.7% confident the model is at least. A model with few games has a large σ and therefore a low ordinal. Ratings are recomputed from scratch from all stored games, never updated incrementally, and are kept separate per table preset and per prompt version.

## Win rates and confidence intervals

Win rates count one trial per model per game per team, not per seat, so two mafia seats in one game don't double the evidence. Draws count in the denominator and never as wins. Every win rate is shown with a **95% Wilson interval**, which behaves well with small samples and rates near 0% or 100%. A wide bar means we don't know yet. A head-to-head page only names a better liar when the two intervals don't overlap.

A model is **provisional** until it has at least **50 games as mafia and 50 as town**. Provisional models are listed below the ranked ones and are never given a rank.

## Metrics

- **Deception (mafia):** 1 − (votes received ÷ votes expected if everyone voted uniformly at random), averaged over mafia seats. Higher means the model drew less suspicion. It can be negative.
- **Lie rate (mafia):** the share of public speeches that claim a town role.
- **Town vote accuracy:** the share of town votes that hit a mafia player.
- **Persuasion:** the share of other players' votes that matched this model's accusation that day.
- **Detective hit rate:** investigations that found mafia, shown next to the hit rate a random pick would get under the same no-repeat rule.
- **Detective conversion:** after a model claims detective and accuses someone it has confirmed as mafia, the share of that day's town votes that followed.
- **Doctor block rate:** saves that stopped a kill.
- **Survival:** day phases a player reached alive, split by team.
- **Cost, tokens and latency:** computed from a record of every model call, priced from the model registry.

## Limitations

- Small samples are honestly small: read the intervals, not the point estimates.
- Results apply to one prompt (`p1`) and one set of rules. Changing the prompt creates a new version with separate ratings.
- Personalities shape tone. Benchmark runs can switch them off (`--neutral`) to reduce variance.
- Prices are typed in by hand from provider price lists and can go stale.
- A model's safety tuning can make it reluctant to lie. That shows up as lower mafia performance or a higher fallback rate, and it is part of what is being measured.

## Reproduce it

```
pnpm bench -- --format h2h --a claude-haiku --b gpt-nano --games 100 --budget-usd 3 --upload
pnpm ratings:rebuild -- --db
```

All the code, tests and design decisions are on [GitHub](https://github.com/cutcuti/ai-mafia) (see `docs/DECISIONS.md`).
