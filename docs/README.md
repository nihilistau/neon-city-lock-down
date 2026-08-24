# Neon-City: Lock-Down — Engine Documentation

API-style reference for the game engine. Start with the **[Engine Overview](engine-overview.md)**,
then dive into a subsystem.

## Contents

- **[Engine Overview](engine-overview.md)** — the cadence spine, the event bus, `app.js` as
  composition root, and the architecture rules.
- **[Gameplay Loop](gameplay-loop.md)** — resources, day tick, threat, the systems economy,
  day-plan/action-points, objectives, death, meta, endgame.
- **[Event Catalog](event-catalog.md)** — the world events + the event-script step vocabulary +
  the scheduler pacing knobs.
- **[Engine Config](config/README.md)** — the runtime-YAML config layer: every tunable value in
  editable, validated, documented `config/*.yaml` (camera, combat, sim, chars, humanoid, world,
  gameplay, lighting, llm, voice), with live edit/save.
- **[Creation Kit](creation-kit/README.md)** — the player-facing guide to authoring scenarios,
  events, cutscenes, dialogue, and voices in-game.
- **[Demo Script](demo.md)** — a ~3-minute presenter walkthrough (written for v0.2.0; the feature list has moved on considerably), the
  60-second social cut, and **[GIF storyboards](storyboard/README.md)** for the two "wow" moments.

### Systems (`systems/`)
- [Core](systems/core.md) — bus, loop, clock, rng, settings, save, script.
- [Sim: world, tick & survival](systems/sim-world-loop.md) — run state, the world tick, survival,
  threat, scheduler, day-plan, objectives.
- [Combat](systems/combat.md) — resolver, cover, the combat controller, FPS/TPS shooting, combat FX.
- [Camera](systems/camera.md) — the rig, first/third-person controller, the situational director,
  cutscenes.
- [Characters & Dialogue](systems/characters-dialogue.md) — stats, gates, mood, character; the
  authored dialogue engine; the LLM agent path.
- [Humanoid](systems/humanoid.md) — the 34-bone skeleton, body/outfit builders, animator, poses,
  wardrobe (+ the skinning gotcha).
- [Scene, Audio & UI](systems/scene-audio-ui.md) — stage/zone/lighting/post-FX, the audio stack,
  the UI panels, the mini-games.
- [Voice (Voxtral TTS)](systems/voice.md) — the vendored engine, the voice server, the Voice
  Controls panel, cloning, and setup.
- [Scenario Toolkit](systems/scenario-toolkit.md) — the user-content layer + the in-game Creation
  Kit (author scenarios/events/cutscenes/dialogue).
- [LM Studio Engine](../lmstudio-engine/README.md) — the standalone LLM control module.

## Conventions
- Plain ES modules, no bundler; three.js is vendored under `vendor/`.
- Plain JS + JSDoc types. Pure-logic modules have `node --test` unit tests under `test/unit/`.
- The **event bus** (`src/core/bus.js`) is the ONLY cross-layer channel. UI never reaches into sim
  internals; it subscribes to bus topics and calls the composition root.
