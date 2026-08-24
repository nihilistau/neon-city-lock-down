# Event Catalog

World events are authored data (`data/events.js`) run as step-lists by `src/sim/eventRunner.js` through
the shared `ScriptRunner`. The scheduler (`src/sim/scheduler.js`) rolls them in; a fired event's script can
pause for player choices while the sim keeps ticking. See also
[sim-world-loop.md](./systems/sim-world-loop.md) for the tick + scheduler wiring.

## The events
Each `EventDef`: `{ id, cls, weight(run, clock), cooldownMin?, maxPerRun?, window?, script }`. `weight`
returns 0 when ineligible. `window = { minDay?, phase?[] }`.

| id | cls | weight (fires when) | window | cooldownMin | maxPerRun |
|---|---|---|---|---|---|
| `blackout` | system | `power.online ? 8 + threat·0.15 : 0` | — | 400 | 3 |
| `riot_breach` | threat | `threat>35 ? threat·0.25 : 0` | day≥1, dusk/night | 900 | 2 |
| `supply_drop` | social | `7 − threat·0.03` | — | 800 | 2 |
| `faction_envoy` | threat | `threat>30 ? 6 + threat·0.1 : 0` | day≥2 | 1000 | 2 |
| `drone_strike` | threat | `threat>45 ? 5 + threat·0.08 : 0` | night/dusk | 900 | 2 |
| `kitchen_fire` | system | `4` (constant) | — | 1200 | 1 |
| `water_failure` | system | `water.online ? 5 : 0` | — | 1000 | 2 |
| `med_emergency` | social | `3 + threat·0.04` | day≥2 | 1100 | 2 |
| `looter` | threat | `threat>25 ? 5 : 0` | night | 900 | 2 |
| `curfew_flyover` | threat | `curtainsClosed ? 1 : 4 + threat·0.05` | night | 700 | 3 |
| `courier_offer` | social | `4` (constant) | day≥2 | 1000 | 2 |
| `defence_misfire` | system | `defence.online ? 3 + (100−hp)·0.05 : 0` | — | 1200 | 1 |
| `news_bombshell` | social | `3` (constant) | day≥2 | 1400 | 1 |
| `elevator_stranger` | social | `elevator.online ? 3 : 0` | day≥2 | 1300 | 1 |
| `emp_wavefront` | system | `threat>55 ? 4 : 0` | day≥3 | 2000 | 1 |
| `extraction_offer` | social | `0` — **scheduled only** (the endgame) | — | — | — |
| `refugee` | social | `6 + threat·0.1 − refugees·4` | day≥1 | 700 | 2 |

`extraction_offer` never rolls randomly (weight 0); it is queued via `run.eventQueue` (e.g. a scenario or a
scheduled beat) and bypasses the scheduler's gap. `curfew_flyover`'s weight drops to 1 when
`flags.curtainsClosed` — drawn curtains hide the tower's lights.

## Step vocabulary (`eventRunner.js`)
Each script step is `{ type, …fields }`. Registered verbs — this table is CHECKED
against `src/sim/eventRunner.js` by `tools/lint-data.mjs`, so it cannot drift again
(it documented 25 of 27 for two releases). Registered verbs (a handler may be async; a returned `{steps:[…]}`
runs inline — how `choice`/`combat` branch):

| type | fields | effect |
|---|---|---|
| `vox` | `text, bakedId?` | VOX line — baked take if `bakedId` exists, else procedural voice; feeds |
| `news` | `text` | emit `news.push {text}` (the ticker) |
| `alert` | `text, kind` | emit `hud.alert` + feed (`info`/`warn`/`danger`) |
| `sfx` | `id` | play a synth SFX |
| `wait` | `sec` | real-time delay |
| `waitMinutes` | `minutes` | game-minute delay (rides `world.minute`, honors pause) |
| `powerDown` / `powerUp` | — | toggle `systems.power.online`, emit `power.changed` |
| `castStats` | `deltas` | `applyStats(deltas)` to the whole cast |
| `castStat` | `char, deltas` | `applyStats` to one character |
| `castFlag` | `flag` | set a memory flag on every character |
| `playerMorale` | `amount` | clamp `player.morale` |
| `playerHurt` | `amount` | reduce `player.health`, emit `player.health` |
| `resource` | `key, amount` | `gain`/`spend`, emit `resources.changed` |
| `addRefugee` | — | `run.refugees++`, emit `resources.changed` |
| `threatSpike` | `amount` (def 10) | `spikeThreat` |
| `damageSystem` | `system, amount` (def 25) | reduce hp; offline at ≤15; emit `systems.changed` |
| `systemOnline` | `system, online` | force a system on/off |
| `scheduleEvent` | `eventId, inMinutes` | push a future queued event |
| `lockElevator` | `locked` | set `systems.elevator.locked` |
| `light` | `preset, fade?` | `lighting.apply(preset, fade)` |
| `cutscene` | `steps` | run a cutscene script |
| `combat` | `spawnAt, count?/archetype?, waves?, onWin?, onLoss?` | start a firefight; resolves to `onWin`/`onLoss` steps |
| `choice` | `prompt, options:[{label, steps}]` | emit `event.choice`; player pick resolves to that option's steps |
| `runFlag` | `flag, value?` | set `run.flags[flag]` (defaults to `true`) — the run-scoped counterpart to `castFlag` |
| `castHurt` | `char, amount, cause?` | damage one character; can kill them |
| `endRun` | `outcome` | emit `run.extraction {outcome}` (the extraction ending) |

**Note:** `anim`/`face`/`look` etc. are NOT event verbs — those belong to the cutscene DSL
(`src/cutscene/player.js`) and the dialogue stage-direction dispatcher. Events reach bodies through
`combat`/`cutscene` or by scheduling dialogue. Unknown step types warn (not throw) and are skipped.

## Fire lifecycle
`EventRunner.fire(eventId)` sets `run.activeEventId`, pushes `eventsFired`, emits `event.fired {id, cls}`,
runs the script, then (finally) clears `activeEventId`, stamps `run.lastEventEndMinute = now`, and emits
`event.done {id}`. `get busy` reflects the ScriptRunner. The world tick re-queues (`+5 min`) any scheduled
event that lands while `events.busy` or combat is live, rather than dropping it.

## Pacing
The scheduler (`scheduler.js`) is where you tune event density:

| Knob | Value | Effect |
|---|---|---|
| `ROLL_EVERY_MIN` | 45 | game-minutes between random-event rolls |
| `MIN_GAP_MIN` | 150 | hard floor between the END of one event and the next random one (~2.5 real min) |
| `fireChance` | `min(0.4, 0.18 + threat·0.0015)` | per-roll probability, threat-scaled and capped |

Queued/scheduled events (`run.eventQueue`, `scheduleEvent`, `extraction_offer`) fire immediately and bypass
`MIN_GAP_MIN`. To make events rarer: raise `MIN_GAP_MIN` or `ROLL_EVERY_MIN`, or lower the `fireChance`
base/cap. To make a specific event more/less likely relative to the pool: edit its `weight`. To shift when
it can appear: edit `window`/`cooldownMin`/`maxPerRun`. `MIN_GAP_MIN` is the single biggest lever — it is
the real spacing floor; `fireChance` only jitters within it.

### Events emitted
`event.fired`, `event.done`, `event.choice`, `news.push`, `run.extraction`, plus (from step handlers)
`hud.alert`, `resources.changed`, `systems.changed`, `power.changed`, `player.health`, `combat.*`.
