# Core

The engine's foundation layer (`src/core/`): the event bus, the render/sim loop, the game clock,
seeded RNG, persistent settings, the versioned save envelope, the shared script interpreter, and the
activity feed. Everything below is dependency-free of three.js/DOM except where noted.

## Event bus (`bus.js`)
The ONLY cross-layer channel. Dot-namespaced string topics; `'*'` observes everything.
```
on(topic, fn) → () => void   // returns unsubscribe
once(topic, fn) → off
emit(topic, payload?)         // fires topic subscribers then '*' subscribers
resetBus()                    // clears every subscription (tests / full restart)
```
Handlers receive `(payload, topic)`. Subscriber sets are snapshotted (`[...set]`) before dispatch, so
a handler may safely `on`/`off` during `emit`.

## Main loop (`loop.js`)
`SIM_STEP_MS = 100`. `class Loop({ clock, render, simStep?, onMinute? })`.
- `start()` / `stop()` — rAF driver. Per frame: clamp `dt` to 250 ms (hidden-tab guard), and **while
  not paused** accumulate a fixed 100 ms sim step (`simStep`) then `clock.advance(dt, onMinute)`.
  `render(dt)` runs every frame regardless of pause.
- `pause(reason)` / `resume(reason)` — reasons form a **Set**; sim+clock halt while any reason is
  active (`cutscene`, `menu`, `death`, `chat-modal`). `get paused`, emits `loop.pause {reason, paused}`.
- `fps()` — rolling average over the last ~120 frames.

## Game clock (`clock.js`)
`MINUTES_PER_DAY = 1440`. `class GameClock` — `day` (starts 1), `minuteOfDay` (starts `18*60` — dusk
lockdown), `speed = 1` (game-minutes per real second).
- `get phase` → `'dawn'` 05–08, `'day'` 08–17, `'dusk'` 17–20, `'night'` otherwise.
- `get totalMinutes` (since run start), `get label` (`"Day 3 — 07:45"`), `get dayFraction` (0..1, drives sun/sky).
- `advance(realMs, onMinute?)` — accumulates real ms × speed; fires `onMinute(clock)` **once per whole
  game-minute**, rolling the day at 1440. `skip(minutes, onMinute?)` jumps forward (debug/sleep).
- `serialize()` / `deserialize(d)` — `{day, minuteOfDay, speed}`.

## Seeded RNG (`rng.js`)
mulberry32 with **named streams** so sim/dialogue/loot draws never perturb each other.
- `hashStr(str)`, `mulberry32(seed)` — primitives.
- `class RngStream(seed)`: `next()` [0,1), `range(min,max)`, `int(min,max)` inclusive, `chance(p)`,
  `pick(arr)`, `weighted(arr, weightFn)`, `dice(count, sides)`, `roll("2d6+1") → {total, rolls, mod}`.
  `state()` / `RngStream.from({seed, draws})` — position restored by **replaying the draw count**.
- `class Rng(baseSeed)`: `stream(name)` derives `baseSeed ^ hashStr(name)`; `serialize()` /
  `Rng.deserialize(data)`.

## Settings (`settings.js`)
Persistent player prefs (localStorage `ncld.settings`), NOT run state. `export const settings` is a
live object deep-merged over `DEFAULTS` on load (new fields appear after updates).
- `saveSettings()` — persist + emit `settings.changed`.
- `setSetting(path, value)` — dotted path (`setSetting('llm.enabled', true)`), persists + notifies.

Key fields: `playerName`, `playerPronouns` (`she`/`he`), `appearance {skin, hair, hairStyle, height,
build}`, `volumes {master, music, sfx, ambience, voice, ui}`, `cameraMode`,
`autoCamera`, `mouseSensitivity`, `subtitleScale`, `llm {enabled, agentMode, thinking, temperature,
reasoning, chatModel, functionModel, charModels, charModes, baseUrl, …}`, `tts {sidecarUrl, useSidecar}`,
`debug`.

## Save envelope (`save.js`)
`VERSION = 1`, `AUTOSAVE_KEY = 'ncld.autosave'`, slot prefix `ncld.slot.`.
- `buildSave(app, label?)` — serializes clock, rng, `run`, scheduler, inventory, `lighting.presetId`,
  and each character (`serialize()` + wardrobe + brain).
- `migrate(save)` — per-version upgrade chain (add a case per bump); `applySave(app, save)` restores in
  place (same cast composition), clearing each queue and re-playing the idle clip.
- `saveToSlot(app, slot|'auto', label)`, `readSlot(slot)`, `deleteAutosave()`, `listSlots()`,
  `exportSave(app)` (downloadable JSON).

**Gotcha:** autosave is deleted on death (`death.js` → `deleteAutosave`) — perma-death is real.

## Script interpreter (`script.js`)
`class ScriptRunner(name)` — one script per runner at a time. Shared by `eventRunner` and cutscenes.
- `register(map)` — `{ type: (step, ctx) => Promise|any }` handler table.
- `run(steps, ctx = {})` — sequential; a handler's return is stored at `ctx.last`. A handler may branch
  by returning `{ steps: [...] }` (executed inline — this is how `choice`/`combat` resolve outcomes).
- `abort()` sets `abortFlag`; `sleep(ms)` helper.

## Activity feed (`log.js`)
Ring buffer (cap 250) backing the Director panel feed.
- `feedEntries[]`, `feed(text, kind = 'info')` — kinds: `info|dialogue|stat|bond|event|combat|system`;
  emits `feed.entry`.
- `setDebugLogging(v)`, `dbg(...args)` — console logging gated behind `?debug=1`.

### Events emitted
`loop.pause`, `settings.changed`, `feed.entry`.
