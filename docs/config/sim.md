# config/sim.yaml

Simulation tuning: event pacing, threat pressure, the survival economy, tower-system
degradation, and the day-plan actions. Defaults in `data/configDefaults.js` → `sim`.

## `scheduler` — random event pacing (`src/sim/scheduler.js`)

| Key | Default | Effect |
|-----|---------|--------|
| `rollEveryMin` | 45 | Roll for a random event roughly every N game-minutes. |
| `minGapMin` | 150 | Hard floor (game-min) between the **end** of one event and the next roll — the main "events too quick" lever. |
| `fireChanceBase` | 0.18 | Base per-roll probability an eligible event fires. |
| `fireChanceThreatScale` | 0.0015 | Added to the fire chance per point of threat. |
| `fireChanceMax` | 0.4 | Cap on the per-roll fire chance. |

## `threat` — external pressure 0..100 (`src/sim/threat.js`)

| Key | Default | Effect |
|-----|---------|--------|
| `dayBaseStart` / `dayBasePerDay` / `dayBaseCap` | 12 / 7 / 60 | Baseline threat = `min(cap, start + day·perDay)`. |
| `nightBoost` / `duskBoost` | 8 / 5 | Added during night / dusk phases. |
| `waveAmp` | 6 | Amplitude of the diurnal threat wave. |
| `ease` | 0.004 | How fast threat eases toward its target each minute. |
| `spikeDecay` | 0.9985 | Per-minute decay of an event-driven spike. |
| `flareChance` | 0.002 | Per-minute chance of a random flare. |
| `flareMin` / `flareMax` | 1 / 4 | Flare size range. |

## `survival` — consumption & biology (`src/sim/survival.js`)

| Key | Default | Effect |
|-----|---------|--------|
| `mealsPerDay` / `waterPerDay` | 3 / 1 | Consumption per head per day. |
| `hungerRate` / `hungerRelief` | 1.4 / 1.6 | Hunger gain when short / relief when fed. |
| `thirstRate` / `thirstRelief` | 2.0 / 2.4 | Thirst gain / relief. |
| `hungerHealthAt` / `hungerHealthLoss` | 80 / 1 | Above this hunger, lose this much health/hour. |
| `thirstHealthAt` / `thirstHealthLoss` | 75 / 2 | Above this thirst, lose this much health/hour. |
| `moraleFoodDrain` / `moraleWaterDrain` / `moraleRecover` | 1.2 / 1.5 / 0.25 | Player morale drains from shortage, small hourly recovery. |
| `castFoodShortAt` / `castWaterShortAt` | 0.3 / 0.3 | Shortage fraction above which NPC morale/tension cascades. |
| `warnFoodAt` / `warnWaterAt` | 6 / 8 | Reserve levels that trigger a low-supply warning. |

## `systems` — tower degradation (`src/sim/tick.js`)

| Key | Default | Effect |
|-----|---------|--------|
| `degrade` | `{power:4, water:3, defence:6, elevator:2, cameras:5}` | Per-day HP lost by each tower system. |
| `offlineHp` | 12 | A system goes offline at or below this HP. |
| `cellDrainPer30` | 0.5 | Reserve-cell drain per 30 min while the power grid is down. |

## `dayPlan` — action-point actions (`src/sim/dayPlan.js`)

`apPerDay` (default 4) is the daily Action-Point pool. Each action has an `ap` cost plus
outcome numbers:

| Action | Keys (defaults) |
|--------|-----------------|
| `repair` | `ap 1, cost 1 part, amount +35% to weakest system` |
| `fortify` | `ap 1, cost 1 part, defence +20, threatDrop 8` |
| `forage` | `ap 1, foodBase 2 + rand 0..foodRand(3), waterRand 3, partsChance 0.35` |
| `train` | `ap 1, gain +7 skill, cap 92` |
| `rest` | `ap 1, health +16, morale +12` |
| `deal` | `ap 2, cost 3 luxury, threatDrop 20` |

_Mid-run objectives (`src/sim/objectives.js`) keep their thresholds/rewards in code — they're
content-with-logic and move to the user-content layer, not engine tuning._
