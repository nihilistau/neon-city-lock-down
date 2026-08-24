# Changelog

All notable changes to Neon-City: Lock-Down. This project adheres to
[semantic versioning](https://semver.org/).

## [0.5.0] — 2026-08-24 — Consequence, reachability, honesty

A review-and-repair pass over v0.4. Every claim below was measured in a live run
or a live browser rather than inspected; where a number is quoted, it is the
number that came back.

### Added
- **Ambient occlusion** (`src/scene3d/aoPass.js`) — reconstructs view-space
  position from the composer's existing depth attachment, so no second geometry
  pass and no new vendored addon. 25.3% of pixels darkened, 1.5ms a frame.
- **`render` config group + `config/render.yaml`** — shadows, shadow map size,
  AO, bloom, grain and FOV were all hardcoded across `src/scene3d/*`.
- **A real settings screen** (`src/ui/settingsPanel.js`), shared by the main menu
  and the pause screen. 15 controls including graphics, which had none anywhere.
- **Accessibility**: focus-visible, `prefers-reduced-motion`, `prefers-contrast`,
  six live regions, and modal roles/labels/focus owned by `modalStack`.
- **Minigames reachable in-run** — new `effects.game` topic verb plus intents, so
  asking someone to play cards, truth-or-dare or come to bed opens the game. The
  VOX terminal carries a case board for the three mysteries.
- **Refugees can work or leave** (`refugee_work`, `refugee_release` day actions).
- **Rationing on the plan panel** — previously settable only from the debug drawer.
- **Meta unlocks**: three scenarios earned by play. Locked cards are shown with
  their condition rather than hidden.
- **Self-hosted webfonts** under `vendor/fonts/` — 95KB, six static instances.
- **Design tokens**: a ten-rung type scale, a 4px spacing rhythm, radius,
  elevation and motion tokens, joining the z-index scale.
- **An end-to-end smoke suite** (`npm run test:e2e`) — 8 Playwright tests driving
  a real headless browser through boot, panels, saves, all seven floors, the
  minigames, the ration economy and death.
- **Hostile wardrobes** — they were spawning naked under an accessory kit.

### Changed
- The neon runs now cast light. A hue census of the rendered frame across eight
  penthouse camera angles read 61.8% warm amber against 3.8% cyan in a game
  whose identity is cyan and magenta; the `neon_night` kit was rebalanced from
  95/34/42 to 34/46/58, giving 42.3% warm and 10.9% cyan.
- `PCFSoftShadowMap` replaces the 1-texel-hard `PCFShadowMap`.
- Rim lights are pooled at a fixed count instead of one per actor, so a hostile
  wave no longer changes the scene's light count and recompiles every shader.
- Every floor's shaders precompile at world build: 36 compiles across a tour of
  the tower became zero.
- Dialogue: ~112 line variants across 88 topics became 236, gated on real state.
- `--mono` resolves to an actual monospace font.
- `tools/lint-data.mjs` discovers dialogue packs instead of importing a list.
- `npm test` is unit-only; `test:e2e` and `test:all` sit beside it.

### Fixed
- **Seven write-only systems now have consequences**: `fortified`,
  `garden_blight`, `injury.bleeding`, hostile `aggression`, outfit `warmth`,
  item `value` and the `zone.entered` event, plus `meta.unlock()` which was
  exported, never called and never read.
- **The food economy closes.** Four mouths needed 12 food/day against a forage
  ceiling that made every action point mandatory, and a refugee made the run
  unrecoverable. Measured after: 12 vs 14.2, and a refugee is a pressure you can
  answer.
- `enterBedScene` swapped the floor group without moving anything else, leaving
  the avatar 1190 world units away in the basement while the camera sat at the
  bedside. `App.setFloor()` is now the only floor-change path.
- Head accessories derive from the head: glasses sat 6.5cm below the eyes and
  2.5x too wide; earrings floated 1.4cm off the skull beside the jaw.
- Per-frame heap allocation roughly halved (3843 → 2137 bytes/frame with four
  actors walking), led by `cfg()` splitting its path string on every call.
- Repairs at the VOX terminal early-returned past everything below them.
- The smoke test asserted nothing and could not fail.

## [0.4.0] — 2026-08-13 — Living loop, unique floors, hybrid HUD

### Changed
- Boot goes straight to the main menu (handle + body on New Run). No 18+ click-through.
- Unbaked dialogue uses a per-character formant talk synth. The Voxtral sidecar is off by default.
- Aimed player shots always hit the body under the crosshair; cover cuts damage instead of converting to a miss.
- Day-plan actions ride the elevator to a real floor (forage → rooftop, repair → VOX core, …).
- The Bed Game and Kai's card game scenarios actually launch those games.
- NPC banter/needles are spoken in chat with animation, not activity-feed captions.
- Refugees arrive as named people in reception with dialogue, not a pantry integer.
- Lower floors have their own architecture (helipad, VOX face wall, med tiles, lobby marble, basement pipes).
- Ctrl crouches in combat (cover bonus). Downed hostiles are lootable. Looter fights happen in the carpark.
- Hybrid art: generated city skyline plate, window texture, face identity underpaints, neon HUD icons. Oxanium + IBM Plex Sans.
- Auto-camera holds speakers longer. Esc pause menu reaches Settings / Director / Codex.
- Stat rail hides during combat and the bed game.
- Kai and VOX depth dialogue. New events: Kai's radio, garden blight, sniper nest.
- New Run and Settings have appearance sliders (skin, hair, style, height, build).
- Jackets pick up a leather map; dresses and robes pick up silk.
- Day-7 extraction: stay, extract alone, or bring two companions. Stay plays an epilogue (stay_quiet / stay_last). Shuttle and stay have their own cutscenes; first night settles in the lounge; a named companion dying gets a VOX beat.
- 19:00 dinner and 01:00 sleep are skippable scenes. Cast uses shower, vanity, telescope, garden. High-threat forage can fail.
- Events: Lola's collection, bad water, Aria's client, shutter jam, VOX dream. Third mystery (The Grid Ghost). Objectives: keep them alive, VOX is listening.
- Stat rail defaults collapsed (four hero stats). ? opens controls. Esc has Kit + Quit. P is a side drawer. Event choices can show portraits.
- Hair styles: undercut, ponytail, slick, pixie. Shoes, Lola holster, Aria earrings, Kai glasses. Hostiles differ (hoodie / visor / backpack). Cotton/velvet/metal fabrics.
- Unique floor architecture (armoury/security split, VOX-core hex, med alcoves, lobby mezzanine, basement ramp). HUD chips, full-width reply chips, stacked choices, CSS wordmark, extra HUD icons.
- Inventory is a side drawer. Fists/meds/food glyphs on the weapon chip. Elevator fade names the floor. Per-floor fog and practical lights.
- Elevator has its own floor list (no longer steals the event-choice queue). HUD shows the current floor. Boot uses the skyline plate + Oxanium title. Ammo readout uses the ammo glyph.

### Fixed
- Stim wrote a non-existent `stamina` field; it now buffs skill/morale for 45 game-minutes.
- Medkit no longer wipes every NPC injury in the tower.
- Fists were aliased to the shiv; they have their own melee stats.
- Whisper existed only in the Director; it is a toggle on the chat row.
- Save menu can import JSON as well as export.
- Player avatar now wears street clothes in third person.
- Cast return-fire no longer drains the shared ammo pool below 15.
- Reload used the door-servo sound.
- Grok marks cropped off the skyline plate, window map, and fabric textures. HUD icons already key out on green.

---

## [0.3.0] — 2026-08-13 — Correctness pass + render/avatar overhaul

Never given its own entry at the time. Recorded here from the merge (`ae158ed`).

### Added
- Procedural image-based lighting (PMREM), real MSAA through the composer, film
  grain after tone-mapping, a threat readout on the HUD.
- Welded skinned humanoid rebuild: 3-4 influence chain skinning, swept limb
  profiles, strand hair on real bones, driven jaw and eye bones.

### Fixed
- ~30 correctness bugs across soft-locks, frozen accessors, mortality, seat
  heights and cap desync.
- The "blinking lights on every head" — root-caused by measuring peak luminance
  and bisecting contributors, after three wrong guesses. It was hair specular,
  not the eyes or the env map.
- Tower systems and dead flags given consequences; HUD layout collisions.
- LM Studio credential untracked (the key still needs rotating — it remains in
  pre-merge history).

## [0.2.0] — 2026-07-19 — Engine + Creation Kit

The game becomes an **engine + creation kit**: almost everything is externally tunable and
player-extensible with no rebuild, and it still boots identically on pure defaults.
[Release notes →](https://github.com/nihilistau/neon-city-lock-down/releases/tag/v0.2.0)

### Added
- **Runtime config layer** — 10 documented, validated, live-editable `config/*.yaml` groups
  (camera, combat, sim, chars, humanoid, world, gameplay, lighting, llm, voice) over baked
  defaults. `src/core/config.js` + `/api/config`; full reference in `docs/config/`.
- **Full LLM control** — every LM Studio engine knob (sampling, reasoning markers, TTL, token
  budgets, draft model, interceptors, connection) via `config/llm.yaml` + the LLM panel (**L**).
- **Voice studio** — the Voxtral TTS fork vendored (`third_party/voxtral/`, source only); a full
  config-driven voice server (`/speak`, `/synthLong`, `/save`, `/library`, `/clone`) with all 20
  presets; and the **Voice Controls** panel (**V**): realtime TTS, library + playback, long-text /
  `.txt` synthesis, custom-line baking, per-character voice assignment, cloning.
- **Scenario Creation Toolkit** — the **Creation Kit** panel (**G**) authors scenarios, events,
  cutscenes, and dialogue as JSON with templates + a live cheatsheet, saved under `user/` and
  registered at boot (fail-soft). `docs/creation-kit/`.
- **Combat feel** — continuous sticky-aim magnetism, procedural weapon hand-models, over-the-
  shoulder third-person framing, and hostile auto-tracking.
- Config-layer docs (`docs/config/`), voice + toolkit system docs, and the creation-kit guide.

### Fixed (post-release adversarial review)
- Voice-server `/save` path traversal (sanitize `char`/`lineId`; validate the WAV before writing).
- CSRF hardening — same-origin + body-size guards on every write API (voice, config, user).
- Dialogue re-save threw `duplicate topic id` and dropped the edit — now idempotent
  (`unregisterTopic()` before re-register).
- `config/combat.yaml` `cover:` was a dead knob (read frozen defaults) — now reads live config.
- `applyConfig` reset untouched siblings on a partial edit — now merges over the live store; the
  store no longer aliases the shared defaults.
- LLM reasoning-markers + draft-model config were inert — now threaded per request; the config API
  reloads server config on write so sampling edits go live.
- Boot loaders hardened against a malformed user index; empty `lighting.tod` no longer crashes the
  render loop; several low-severity leaks/nits.

### Notes
- **No breaking changes** — the config and user-content layers are additive and fail-soft.
- 83 unit tests + data/config lints green; verified clean-default boot.

## [0.1.0]

Initial slice — the base game (procedural 3D, chat-first dialogue, stats/gates, day/night
survival loop, combat, mini-games, cutscenes, baked voices).
