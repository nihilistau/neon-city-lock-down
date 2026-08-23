# Changelog

All notable changes to Neon-City: Lock-Down. This project adheres to
[semantic versioning](https://semver.org/).

## [Unreleased] — 0.4 overhaul (in progress)

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
