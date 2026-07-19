# Engine Overview

Neon-City: Lock-Down is a browser three.js game engine with a chat-first roleplay layer over a
survival roguelike day-loop, an authored-or-LLM dialogue engine, a procedural humanoid rig, a
situational camera director, and real FPS/TPS combat. No bundler: plain ES modules + an import map,
three.js vendored under `vendor/`, served by a ~60-line static server (`tools/serve.mjs`) that also
proxies the LLM engine.

## The composition root

`src/core/app.js` (`App`) is the only module that imports everything. It builds every subsystem,
wires their dependencies as **accessor closures** (e.g. `run: () => this.run`), subscribes to bus
topics, and runs the render loop. Nothing else reaches across layers directly.

## The four cadences

```mermaid
flowchart TD
  RAF["requestAnimationFrame<br/>(render loop, app.js)"] --> CAM[cameraRig.update]
  RAF --> FX[combatFx.update]
  RAF --> COMBAT[combat.update]
  RAF --> CLOCK["clock.advance(dt)"]
  CLOCK -->|every whole game-minute| MIN["emit('world.minute')"]
  MIN --> TICK["worldTick.minute(clock)"]
  TICK --> SURV["survival (hour boundary)"]
  TICK --> THREAT[threatTick]
  TICK --> SCHED["scheduler.tick → event?"]
  TICK --> OBJ[updateObjectives]
  TICK -->|day rollover| DEGRADE["system degradation + resetDayPlan"]
  SCHED -->|eventId| EVR["eventRunner.fire → script"]
  PLAYER["player chat (async)"] --> DLG[dialogue.playerSays]
```

1. **Render loop** (`rAF`, `App.render`) — reads state, never mutates sim. Drives the camera,
   combat FX, combat controller, lighting, and the game clock. Default **1 real second = 1
   game-minute** (`src/core/clock.js`, `speed=1`).
2. **World tick** (`src/sim/tick.js`, once per game-minute) — survival on hour boundaries, threat,
   the event scheduler, objectives, and day-rollover bookkeeping (system degradation + AP reset).
3. **Event scripts** (`src/sim/eventRunner.js`) — an event's step-list runs asynchronously (can
   pause for player choices); the sim keeps ticking but the scheduler won't start another event.
4. **Dialogue turns** (`src/dialogue/engine.js`) — player-paced; async when the LLM agent answers.

## The event bus

`src/core/bus.js` — `on(topic, fn)`, `once`, `emit(topic, payload)`, `resetBus()`, and a `'*'`
wildcard. It is the **only** cross-layer channel. Representative topics:

| Domain | Topics |
|---|---|
| Time/world | `world.minute`, `day.started`, `threat.changed`, `resources.changed`, `systems.changed` |
| Combat | `combat.started/wave/waveIncoming/resolved/shutters/mag/hit`, `player.health` |
| Camera | `camera.mode` |
| Dialogue | `chat.player`, `chat.reply`, `voice.speaking/done`, `vox.speaking/done` |
| Intimacy | `bedgame.started/state/action/climax/withdraw/ended/talk`, `pose.paired/unpaired` |
| Events | `event.fired/done/choice`, `news.push`, `run.extraction` |
| Loop | `dayplan.reset`, `objective.done`, `char.stat/mood`, `run.death` |

Precedent: the **audio conductor** and the **camera director** both react to the same combat/
dialogue/intimacy topics — that is the intended pattern for any presentation layer.

## Architecture rules

- **The ActorQueue is the single writer** to a character's body. Every movement / pose / expression
  — from AI, dialogue stage-directions, events, or the director tools — is a command pushed to that
  character's `ActorQueue` (`src/sim/actors/actorQueue.js`). Gate-tier-tagged commands are checked
  at the queue, so content can't bypass consent.
- **`gates.js` is the sole intimacy authority** (`src/chars/gates.js`). Stat thresholds + in-fiction
  consent + the explicitness cap. Nothing else flips a gate.
- **The bus is the only cross-layer channel** (above).
- **Determinism where it matters**: seeded `RngStream`s (`src/core/rng.js`) drive sim/combat/dialogue
  selection; cosmetic FX may use `Math.random`.

## Config & the creation kit

The engine is externally tunable and extensible without touching code — the spine of the creation kit.

- **Config layer** (`src/core/config.js`, [docs/config](config/README.md)). At boot, `main.js`
  `await loadConfig()` overlays editable `config/<group>.yaml` onto baked defaults
  (`data/configDefaults.js`), validated by `data/configSchema.js`. Systems read `cfg('group.path')`;
  values hot-reload on the `config.loaded` / `config.changed` bus events. Ten groups cover every
  tunable: camera, combat, sim, chars, humanoid, world, gameplay, lighting, llm, voice. Edit YAML by
  hand or live via `/api/config` (the LLM/Voice panels write it). Server code reads the same files
  through `tools/serverConfig.mjs`.
- **User-content layer** (`src/core/userContent.js`). After config, `main.js` `await
  loadUserContent()` registers player-authored **scenarios / events / cutscenes / dialogue** (JSON
  under `user/`, served by `tools/userApi.mjs`) into the live `SCENARIOS`/`EVENTS` maps + the topic
  registry. **Fail-soft** — a bad file is skipped with an error, never crashing boot. The **Creation
  Kit** panel (`src/ui/kitPanel.js`, key **G**) authors + plays them; see
  [scenario-toolkit](systems/scenario-toolkit.md).
- **Voice** ([systems/voice.md](systems/voice.md)). A vendored Voxtral TTS fork
  (`third_party/voxtral/`, source only) behind a config-driven voice server (`tools/sidecar.mjs`);
  the **Voice Controls** panel (`src/ui/voicePanel.js`, key **V**) does realtime TTS, the voice
  library, long-text synthesis, custom-line baking, and cloning.

Both layers are non-breaking: with no `config/` or `user/` directory the game boots on pure defaults.

## Directory map

```
src/core/     app.js (root), bus, loop, clock, rng, settings, save, log, script, types,
              config (runtime-YAML store), userContent (creation-kit loader)
src/sim/      world, tick, survival, threat, scheduler, eventRunner, death, meta, inventory,
              dayPlan, objectives; combat/{combat,resolver,cover}; ai/{brain,needs,…}; actors/{actorQueue,nav}
src/chars/    stats, gates, mood, memory, character, wardrobe
src/dialogue/ engine, parser/*, topics, selector, effects, stageDirections, llm/*
src/scene3d/  stage, lighting, postfx, picking, combatFx, monitors; tower/{zoneBuilder,furniture,curtains}
src/humanoid/ skeleton, bodyBuilder, outfitBuilder, face, animator, gait, clips, actor3d, pairedPoses, weaponModel
src/camera/   cameraRig, firstPerson (FP+TPS controller, aim magnetism), cameraDirector
src/audio/    engine, music/*, sfx/*, voice, voxVoice, sidecar (voice-server client)
src/ui/       hud, statBars, chatPanel, combatHud, reticle, planPanel, inventory, llmPanel, voicePanel, kitPanel, director/*
src/games/    bedGame, truthOrDare, gambits, mystery
data/         events, zones, scenarios, items, outfits, cast/*, dialogue/*, poses/*, games/*,
              configDefaults, configSchema, lightingPresets
config/       editable engine tuning — <group>.yaml (see docs/config/)
user/         player-authored scenarios/events/cutscenes/dialogue + saved voices (gitignored)
tools/        serve.mjs (+ gameEngine/llmProxy/configApi/userApi), serverConfig, sidecar (voice server),
              bake-tts, lint-data, lint-config
scripts/voice/  setup-voxtral.{ps1,sh}, clone_voice.py (cloning add-on)
third_party/voxtral/  vendored Voxtral TTS fork — Rust source (binary + weights gitignored)
lmstudio-engine/      standalone LLM control module (own README)
vendor/       three.module.js, js-yaml.mjs (import-mapped)
```
