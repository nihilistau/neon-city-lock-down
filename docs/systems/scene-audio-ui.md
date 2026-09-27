# Scene, Audio & UI

The presentation layers: the three.js scene (`src/scene3d/`), the WebAudio stack (`src/audio/`), the DOM
UI (`src/ui/`), and the mini-games (`src/games/`). This is an inventory — key exports, signatures, and bus
events. All three react to the same bus topics; the audio conductor and camera director are the reference
pattern for any new presentation layer.

## Scene (`src/scene3d/`)
- **`stage.js` — `class Stage(canvas)`** — `renderer` (ACES tonemap, PCF shadows), `scene`, main
  `camera` (PerspectiveCamera 55°), `resizeHooks[]`. The one renderer/scene/camera.
- **`lighting.js` — `class Lighting(stage)`** — a fixed hemi/key/warm/cool/accent kit lerped between
  `PRESETS` (10: `neon_night, blackout_emergency, golden_hour, candlelit, dawn_grey, storm, club_pulse,
  fireplace_warm, security_red, morning_haze`). `apply(id, fadeSec=1.2)` (unknown id throws), `presetId`,
  `setFloorOffset(x)`, `update(dt)`. `neon_night` is time-of-day-aware (modulated by `clock.dayFraction`);
  presets may carry a `pulse` (strobe/candle-flicker/lightning).
- **`postfx.js` — `class PostFX(stage)`** — EffectComposer: RenderPass → UnrealBloom (neon) →
  grain+vignette ShaderPass → OutputPass. `setCamera(camera)` (rig mode switches), `render(dtMs)`.
- **`picking.js` — `class Picker(stage, rig)`** — raycast hover + E-prompt. `register({mesh, id, prompt,
  onInteract})`, `update()` (FP casts from screen center, director from mouse). Emits `pick.hover`.
- **`combatFx.js` — `class CombatFx`** — pooled tracers/muzzle flashes/impact sparks; backs
  `world.particles(kind, pos)`. (See [combat.md](./combat.md).)
- **`monitors.js` — `class NewsTicker`** — the wall-screen news crawl; `update(dt)` (consumes `news.push`).
- **`tower/zoneBuilder.js` — `class World3D(stage, rng)`** — multi-floor builder; each floor a Group at a
  world-X offset, only the active floor renders. `setActiveFloor(floorId)`, `getSocket(ref)`, `props[]`,
  `walkRects`, `collidersByFloor`, `sockets`, `particles(kind, pos)`. Emits nothing directly.
- **`tower/furniture.js`** — `FURNITURE` (recipes) + `makeFurniture(type, opts)` → mesh + named sockets
  (seats, bed anchors) the ActorQueue routes to.
- **`tower/curtains.js` — `class Curtains(group, ceilingY)`** — velvet penthouse curtains that physically
  occlude the city view. `toggle(id)`, `get anyClosed`, `update(dt)`.
  **Gotcha:** each pull uses a large **invisible hit-proxy** box (`material.visible=false` still raycasts)
  so the center-screen FP crosshair can actually land on it — the brass tie-back ring alone is too small.

### Asset facade (`src/assets/`)
- **`assets.js` — `createAssets({loaders, enabled, base, fetchJson, manifestTimeoutMs, log})`** —
  the one door for binary assets. `init()` reads `assets/manifest.json` (10 s timeout); then
  `loadPBR(id)` → `{map, normalMap, roughnessMap, aoMap, metalnessMap}` (one ORM texture shared by
  roughness/AO/metal), `loadTexture(id, role)`, `loadEquirect(id)` / `loadHDRI(id)` (PMREM),
  `loadGLTF('pack/model')` (a fresh clone per call), `loadLUT(id)`, `preload([{kind, id}])`, the
  synchronous `peekPBR/peekEquirect/peekGLTF/peekLUT`, `setAnisotropy(n)` and `textures()`.
  **Contract:** every load resolves to `null` on any failure (unknown id, missing file, throwing
  decoder or clone, no manifest), warns once per asset via `console.warn`, and never rejects —
  every caller builds its procedural version on `null`. The app holds it as `app.assets`, with
  `app.assetsReady` the settled `init()`.
- **`?noassets=1`** — `enabled: false`: no manifest fetch, no loader import, every load `null`; the
  whole game renders procedurally with zero asset requests (a smoke test asserts it).
- **`loaders.js` — `browserLoaders(renderer)`** — lazily imports the vendored addons: GLTFLoader with
  Draco (`vendor/three/addons/libs/draco/gltf/`) and meshopt, HDRLoader (half-float), LUTCubeLoader,
  a lazily built PMREMGenerator, and SkeletonUtils' skeleton-aware `clone`.
- **Nothing outside the manifest is ever requested.** A browser logs every 404 as a console error
  and the e2e suite fails on console errors, so the facade throws (→ `null`) for an id or role the
  manifest does not list instead of guessing a URL.

## Audio (`src/audio/`)
- **`engine.js` — `class AudioEngine` (singleton `audio`)** — WebAudio bus graph
  (`music/ambience/sfx/voice/ui` → masterGain → compressor → destination). `unlock()` (from a user gesture —
  the first click, or the main-menu choice), `bus(name)`, `applyVolumes()` (from `settings.volumes`,
  re-applied on `settings.changed`),
  `duckStart()`/`duckEnd()` (dips music/ambience while a voice line plays).
- **`music/conductor.js` — `class Conductor(engine, rng)`** — generative music. Mood params
  `{tension, warmth, energy, closeness}` 0..1 select scale/tempo/layers (`closeness` > .5 shifts to
  lydian and lengthens note decay); a lookahead scheduler (25 ms tick,
  120 ms ahead) keeps timing sample-accurate; mood retargets land on bar boundaries. `setMood(partial)`,
  `start()`/`stop()`. Driven from `app.js` (the mood matrix):

  | Bus topic | setMood |
  |---|---|
  | `threat.changed` | `tension = min(1, threat/90)` |
  | `combat.started` | `tension:1, energy:.85, closeness:0, warmth:.1` |
  | `combat.resolved` | `tension: threat/90, energy:.35, warmth:.45` |
  | `bedscene.started` (stay the night) | `closeness:.5, warmth:.7, energy:.2, tension:.05` |
  | `bedscene.ended` | `closeness:0, warmth:.45, energy:.3, tension: threat/90` |

- **`sfx/synthKit.js`** — `playSfx(engine, id)` + `SFX_IDS` (recipe ids: `alarm_hard`, `gunshot`,
  `elevator_ding`, `static_burst`, `thump`, `ui_confirm`, …). The `sfx` facade is `id => playSfx(audio, id)`.
- **`sfx/ambience.js` — `class Ambience`** — layered room tone / riot bed scaled by threat.
- **`voice.js` — `class Voice(manifest)`** — baked-WAV playback (LRU-decoded cache). `speakLine(char,
  compiled, lineKey) → Promise<boolean>`; an AnalyserNode pumps the speaker's mouth amplitude, ducks audio,
  emits `voice.speaking` / `voice.done`.
- **`voxVoice.js` — `class VoxVoice(engine)`** — VOX's procedural synthetic voice (formant-swept sawtooth +
  ring-mod). `say(text, {pitch?, rate?, radio?}) → dur`; emits `vox.speaking` / `vox.done`.
- **`sidecar.js` — `class Sidecar`** — optional local TTS sidecar client (per `settings.tts`).

## UI (`src/ui/`)
DOM overlays, all bus-driven; panels pause the loop by a named reason while open.
- **`hud.js` — `initHud()`** — clock, resources, hint/prompt, alert, event-choice modal. Consumes
  `resources.changed`, `player.health`, `event.choice`, `pick.hover`, `world.minute`, `hud.alert`, `camera.mode`,
  and `bond.changed` — a bond that *rises* becomes a toast ("Kai trusts you."); a fall shows only on the rail.
- **`statBars.js` — `initStatBars()` / `toggleStatBars(show)`** — per-character 9-stat rail with a bond chip
  (`stranger / ally / trusted / loyal`, styled per tier). Hidden during combat and the stay-the-night fade.
  Consumes `char.registered/removed/stat/mood`, `bond.changed`, `combat.started/resolved`,
  `bedscene.started/ended`.
- **`chatPanel.js` — `class ChatPanel(engine, cast)`** — chat input + typewriter that calls
  `engine.onReveal(i)` / `flushDirections()` as text reveals; branch chips. Consumes `chat.reply`, `chat.player`.
- **`combatHud.js` — `class CombatHud(app)`** — wave banner, hostile HP, cover, hit%, turret, shutter button.
  Consumes `combat.started/resolved/waveIncoming/wave/shutters`.
- **`reticle.js` — `class Reticle()`** — crosshair + ammo readout. Consumes `camera.mode`,
  `combat.started/resolved/mag/hit`.
- **`planPanel.js` — `class PlanPanel(app)`** (key **P**) — day-plan actions (`DAY_ACTIONS`/`performAction`)
  + objective progress. Consumes `dayplan.reset`.
- **`inventory.js` — `class InventoryUI(app)`** (key **I**) — item grid + equip/use, HUD weapon chip.
  Consumes `inventory.equipped/changed`.
- **`llmPanel.js` — `class LLMPanel(app)`** (key **L**) — LLM enable/agent/rewrite/thinking, temperature,
  per-character model + mode. Persists via `setSetting(...)`.
- **`gamesPanel.js` — `class GamesPanel(app)`** — launches `cards()` (Kai's high/low game) and
  `mystery(caseId)` and renders their state. Consumes `mystery.clue/solved`.
- **`director/panel.js` — `class DirectorPanel(app)`** (backquote) — a right-side drawer with 8 tabs, each
  `tab<Name>(el, app)`: **scene** (lighting/time/camera), **cast** (stat sliders/outfit/presence),
  **dialog** (whisper/give-line + a read-only bond readout), **actions**, **scenario** (`launchScenario(app, s)`),
  **world** (threat/force-event/floor/resources — emits `resources.changed`/`power.changed`), **games**,
  **settings**. Consumes `feed.entry` (activity feed). Only `tabScene`/`tabCast` subscribe to bus events.

## Games (`src/games/`)
- **`cards.js` — `class Cards(deps)`** — Kai's card game: five tricks of high/low; he cheats when his
  dominance is high. `deps = {rng, kaiDominance?}`. `start()`, `play(call)`, `state()`. Emits
  `cards.started/trick/ended`.
- **`gambits.js` — `GAMBITS` + `class Gambits(deps)`** — social "mind-game" moves (`probe, bluff, flatter,
  needle, dare_them, stonewall`). `play(gambitId, target) → {win, line, dice}` (opposed d20 vs `playerSkill`,
  applies `target.applyStats`). Emits `gambit.resolved`.
- **`mystery.js` — `class Mystery(deps)`** — clue/interrogation/accusation cases (`MYSTERY_CASES`).
  `start(caseId)`, `onProp(propId, zoneId)`, `interrogate(iqId)`, `accuse(accusedId) → {correct, culprit}`,
  `state()`. Emits `mystery.started/clue/interrogation/solved`; solving adds a codex entry (`addCodex`).

The bed is not a mini-game any more — it's furniture with a small state machine in `src/sim/bedScene.js`,
documented in [characters-dialogue.md](./characters-dialogue.md#the-bed-simbedscenejs).
