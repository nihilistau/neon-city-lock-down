# Sim & World Loop

`src/sim/` — the survival roguelike beneath the roleplay: run state, the per-minute world tick,
consumption, threat, the event scheduler, the day-plan action layer, objectives, inventory, death,
and the two autonomy spines (the ActorQueue and the utility brain). All pure logic over a `run`
object except the actor/AI modules, which drive the 3D bodies.

## Run state (`world.js`)
`newRunState(seed)` returns the whole mutable run:
```
resources { food:24, water:40, meds:6, ammo:60, cells:12, parts:5, luxury:10 }
rationPolicy { food:'normal'|'half'|'none', water: … }
systems { power, water, defence, elevator, cameras } each { hp, online, [locked] }
player { health:100, hunger:15, thirst:10, morale:70, skill:60 }
threat:18, dayPlan {ap,apMax}, objectives {done:[]}, systemsDay, refugees, flags {}
eventsFired[], eventQueue[{atMinute,eventId}], activeEventId, lastEventEndMinute
history { choices, statPeaks, resourcesSpent }
```
- `spend(run, key, amount) → actuallySpent` — clamps at 0, logs to `history.resourcesSpent`.
- `gain(run, key, amount)` — clamped ≥0. Both round to 2 dp.

## World tick (`tick.js`)
`class WorldTick(deps)` — `minute(clock)` runs once per whole game-minute (driven by `world.minute`):
1. **Hour boundary** (`minuteOfDay % 60 === 0`): `hourlyTick` → each note fed + `hud.alert`; emits `resources.changed`.
2. `threatTick` → emits `threat.changed`.
3. Reserve **cells drain** 0.5 every 30 min while power is offline.
4. `scheduler.tick` → if an eventId returns: fire it, OR re-queue `+5 min` when `events.busy` or combat is active.
5. `updateObjectives` → per completion: feed + `objective.done`.
6. **Day rollover** (`minuteOfDay === 0`, once per day via `systemsDay` guard): apply `DEGRADE`, knock a
   system offline at hp≤12, emit `systems.changed`, `resetDayPlan` + `dayplan.reset`, emit `day.started`.

`DEGRADE = { power:4, water:3, defence:6, elevator:2, cameras:5 }` (per-day passive drift — the parts economy's pressure).

## Survival (`survival.js`)
`hourlyTick(run, cast) → { notes }` — once per game-hour. Heads = NPCs + player + refugees. Food 3/day/head,
water 1/day/head, scaled by `rationPolicy`. Shortfalls drive `player.hunger/thirst/morale` and, past
thresholds, `health` (hunger>80 −1, thirst>75 −2). Cast take a happiness/tension cascade when rations run
short; each `c.tickMinutes(60)` decays their stats. Low-reserve notes fire once (`flags.warnedFood/Water`).

## Threat (`threat.js`)
`threatTick(run, clock, rng)` eases `run.threat` toward a target at rate 0.004:
```
target = min(60, 12 + day*7) + nightBoost(night 8 / dusk 5) + sin-wave(±6) + flags.threatSpike
```
Spikes decay ×0.9985/min; a 0.2% chance/min random flare adds +1..4. `spikeThreat(run, amount)` adds to
`flags.threatSpike`. Threat drives event weights, ambience riot loudness, and the music conductor's tension.

## Scheduler (`scheduler.js`)
`class Scheduler(rng)` — `tick(run, clock) → eventId | null`. **Queued/scheduled events fire first and
bypass the gap**; random rolls respect window/cooldown/max-per-run and a hard minimum gap.

| Knob | Value | Effect |
|---|---|---|
| `ROLL_EVERY_MIN` | 45 | min between random-event rolls |
| `MIN_GAP_MIN` | 150 | hard floor between the END of one event and the next random one |
| `fireChance` | `min(0.4, 0.18 + threat*0.0015)` | per-roll probability, threat-scaled + capped |

Eligibility per def: `window.minDay` ≤ day, `window.phase` includes phase, fired < `maxPerRun`,
`totalMinutes − lastFired ≥ cooldownMin`, `weight(run, clock) > 0`; the pool is `rng.weighted` by weight.
`serialize()`/`deserialize()` persist `lastFired`. (Event definitions + step vocabulary: see
[event-catalog.md](../event-catalog.md).)

## Day plan (`dayPlan.js`)
`AP_PER_DAY = 4`. `DAY_ACTIONS` (each `{id, label, ap, hint, can(run), apply(run, rng) → msg}`):
`repair` (1 part → weakest system +35%), `fortify` (1 part → defence +20%, −8 threat), `forage`
(→ food/water/maybe parts), `train` (skill +7 to 92), `rest` (health +16, morale +12), `deal` (2 AP,
3 luxury → −20 threat).
- `resetDayPlan(run)` — refills the AP pool (day rollover).
- `canAct(run, id)` — AP + `can()`. `performAction(run, id, rng) → {ok, msg, ap?}` — spends AP, mutates run.

## Objectives (`objectives.js`)
`OBJECTIVES`: `stabilize` (all systems ≥60% → +3 parts), `stockpile` (day5 + 20/20 food/water → +morale),
`ceasefire` (2 deals → −12 threat), `sharpshooter` (skill 85 → +20 ammo). Each `{progress, done, reward}`.
- `updateObjectives(run, clock) → newly[]` — one-shot completion + reward. `objectiveState(run, clock)` →
  UI list with live `progress` (0..1). `initObjectives(run)` ensures bookkeeping.

## Inventory (`inventory.js`)
`class Inventory(app)` — discrete carried items (bulk survival stock stays in `run.resources`).
`add/remove/has/count`, `equip(id)`, `equippedWeapon() → {key, ranged, name}` (feeds the combat resolver),
`use(id)` (consumables), `applyLoadout(id)` (fixer/hoarder/gunhand), `snapshot`/`serialize`/`deserialize`.
Emits `inventory.changed`, `inventory.equipped`.

## Death & meta (`death.js`, `meta.js`)
- `endRun(app, endedBy)` — compiles a run summary (days, kills, bonds=trust per char, events survived,
  choices), `recordRun`, `deleteAutosave`, emits `run.death`. Perma-death.
- `meta` (localStorage `ncld.meta`): `recordRun(summary)`, `addCodex(id, title, text)`, `unlock(id)`.
  Survives death — no power creep.

## ActorQueue — the command spine (`actors/actorQueue.js`)
**Single writer to a character's body.** Every movement/pose/expression (AI, dialogue directions, events,
cutscenes, Director tools) is a command pushed here.
- `push(cmd)` — appends; if `cmd.minBond` is set and a `hooks.bondCheck` exists (the Character wires it to
  `bondAtLeast`), a command the bond doesn't reach is rejected and emits `actor.refused {reason:'bond'}`.
  A frozen (dead) queue accepts nothing. `pushPriority(cmd)` flushes the queue + current command and runs this next.
- Builders: `goto(zone, waypoint)`, `gotoSocket(ref)`, `sit(ref)`, `stand()`, `playClip(id, fade, holdSec)`,
  `face(expr)`, `look(target)`, `turn(yaw)`, `wait(sec)`, `call(fn)`. `clear()`, `get busy`.
- `update(dt)` steps the active command (path-follow at `WALK_SPEED` 1.22 m/s, elevator transit teleport),
  and emits `zone.entered` on zone change.

**Gotcha:** the queue is the bond chokepoint — a `minBond`-tagged command is checked here against
`src/chars/bond.js`, so no path (AI/LLM/director) can make a character do something their bond with the
player doesn't reach. `seatedAt` is also what the bed's reservation (`bedUsers`) reads.

## Utility AI (`ai/brain.js`, `ai/needs.js`)
`class Brain(character, ctx)` — utility AI over needs. Per-minute `tick(nowMinute, minutes)`:
grows needs, then (unless dead, in combat, or `engagedUntil` a dialogue holds the floor) collects a pending
action's payoff, or after a cooldown scores `ACTIONS`, **softmax-picks** (temp 14) and `exec`s onto the
ActorQueue. `engage(untilMinute)` freezes autonomy during conversation. `serialize`/`deserialize`.
`needs.js`: `NEED_KEYS = [rest, social, fun, drink, air, safety]`, `defaultNeeds()`, `growNeeds(needs,
minutes, stats, threat)` (stat-modulated growth), `satisfy(needs, relief)`.

### Events emitted
`resources.changed`, `threat.changed`, `systems.changed`, `power.changed`, `day.started`, `dayplan.reset`,
`objective.done`, `hud.alert`, `inventory.changed`, `inventory.equipped`, `actor.refused`, `zone.entered`,
`run.death`. Consumes `world.minute` (the tick driver).
