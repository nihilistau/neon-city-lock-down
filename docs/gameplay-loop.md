# Gameplay Loop

A survival roguelike day-loop with an active planning layer, perma-death, and light meta-progression.

## Run state (`src/sim/world.js`, `newRunState`)
- **Resources**: `food, water, meds, ammo, cells, parts, luxury`. `spend`/`gain` clamp at 0.
- **Systems**: `power, water, defence, elevator, cameras` — each `{hp, online}`.
- **Player**: `{ health, hunger, thirst, morale, skill }` (skill = combat aim).
- `threat` (0..100), `dayPlan {ap, apMax}`, `objectives {done:[]}`, `rationPolicy`, event bookkeeping.

## Day tick (`src/sim/tick.js`, per game-minute)
- **Hour boundary** → `survival.hourlyTick`: consumption per head (cast + player + refugees),
  hunger/thirst/health/morale cascades, low-reserve warnings.
- **Threat** (`threat.js`) → a day-scaled baseline eased toward, with event spikes decaying and
  player levers subtracting.
- **Scheduler** (`scheduler.js`) → maybe fire an event (see [Event Catalog](event-catalog.md)).
- **Objectives** (`objectives.js`) → completes any newly-met objective, applies its reward.
- **Day rollover** → passive **system degradation** (`DEGRADE`: power −4, water −3, defence −6,
  elevator −2, cameras −5; failing offline below 12%), and a fresh **Action-Point pool**.

## The active layer — Day Plan (`src/sim/dayPlan.js`, UI: press **P**)
Each day a pool of **Action Points** (default 4) is spent on:
| Action | AP | Cost | Effect |
|---|---|---|---|
| Repair a system | 1 | 1 part | +35% to the weakest system |
| Fortify the tower | 1 | 1 part | +20% defence, −8 threat |
| Forage the rooftop garden | 1 | — | +food/water, maybe a part |
| Drill combat | 1 | — | +7 player skill (cap 92) |
| Rest & regroup | 1 | — | +16 health, +12 morale |
| Broker a faction deal | 2 | 3 luxury | −20 threat, counts toward ceasefire |

`performAction(run, id, rng)` checks AP + affordability, mutates the run, returns `{ok, msg, ap}`.
This is the counter-pressure to passive system degradation and rising threat — the parts/repair and
luxury/deal economies now matter.

## Mid-run objectives (`src/sim/objectives.js`)
Four multi-day goals that reward the day-plan actions, complete once, and grant a reward:
- **stabilize** — every system ≥ 60% → +3 parts.
- **stockpile** — day 5 with 20+ food & water → +morale.
- **ceasefire** — two faction deals → threat eased, sets `flags.ceasefire`.
- **sharpshooter** — combat skill ≥ 85 → +20 rounds.
`objectiveState(run, clock)` feeds the plan panel's progress bars.

## Endgame & meta
- Scheduled beats: a day-3 dusk cutscene; day ≥ 7 dusk queues the **extraction offer** — a
  leave-or-stay choice that ends the run.
- **Perma-death** (`src/sim/death.js`): player health ≤ 0, starvation/dehydration, or the extraction
  choice → `endRun` builds a summary (days, kills, bonds, choices, resources) and emits `run.death`.
- **Meta** (`src/sim/meta.js`, localStorage `ncld.meta`): a codex of discovered lore + run history +
  light unlocks. Deliberately **no power creep**.
