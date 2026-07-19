# Changelog

All notable changes to Neon-City: Lock-Down. This project adheres to
[semantic versioning](https://semver.org/).

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
