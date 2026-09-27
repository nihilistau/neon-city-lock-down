# Changelog

All notable changes to Neon-City: Lock-Down. This project adheres to
[semantic versioning](https://semver.org/).

## [0.6.0] — 2026-09-27 — Clean slate

Sub-project 1 of 7 is done: Neon-City: Lock-Down is now an all-audiences
survival game. Every 18+ system is gone, and in its place a **bond tier**
(stranger → ally → trusted → loyal, derived from trust + loyalty with
hysteresis) decides how far a companion's trust in you reaches. The bed is
ordinary furniture: sit, lie down, invite an ally to sit beside you, or ask a
trusted companion to stay the night, which is a fade to black, one line of
narration and three hours passing. Saves moved to v2 (old saves migrate). The
docs were rewritten to match, a clean-content guard fails `npm test` on any word
from the retired register, `tools/screenshots.mjs` regenerates every README
image from the real game, and CI runs unit tests + lint on every push and the
Playwright suite on pull requests. This entry adds the final fix wave on top of
rc.1.

### Fixed
- **Loading during "stay the night" no longer corrupts the loaded save.** A
  load (Esc reached the save menu over the fade) used to let the stay's clock
  skip, stats and morale land on the freshly loaded save. `bedScene.reset()`
  now bumps an epoch that `stayNight` checks after every await, and the save
  menu refuses to open while the bed scene is busy.
- **Bed intents no longer fire on everyday talk about the bed.** "nice bed",
  "im going to bed", "where is the bed" and "the bed alcove is clear" no longer
  read as an invitation, and "you should get some rest" no longer dismisses a
  guest. The invite phrase is "come sit on the bed".
- **LLM inline stat tags are clamped to ±15**, like the structured-directive
  path, so a single model reply can't jump a bond tier.
- **Getting off the bed is covered end to end**: the smoke test checks the
  first-person seat lock is released and the camera mode restored.
- **A forced floor change or a cutscene gets a seated player up first**, so
  neither leaves a first-person seat lock behind.

### Changed
- **Aria's backstory is the negotiator's everywhere.** The `aria_client` event
  and three of her lines still carried her old escort-coded past; the visitor at
  the doors is now a former corporate client who knows her from the
  negotiating table. Lola's last two physical come-ons are wry and
  non-physical now. The clean-content guard bans the retired phrasings.
- **Re-staged `11-bond-rail`**: the "would follow you anywhere" toast is
  actually visible now (the capture landed before its fade-in), and Kai, whose
  lounge outfit read as underdressed from that angle, waits out of frame.

## [0.6.0-rc.1] — 2026-09-27 — Nothing left behind

The release candidate for 0.6. Nothing new to play; this pass makes sure no
trace of the retired content survives in the code, the docs, or the pictures,
and adds a test that keeps it that way.

### Added
- **Clean-content guard** (`test/unit/clean-content.test.mjs`) — walks every
  shipped file under `src/`, `data/`, `config/`, `tools/`, `styles/` and
  `index.html` and fails `npm test` with `file:line` on any word from the
  retired adult register. A hit is fixed by rewording, never by loosening the
  list.
- **`tools/screenshots.mjs`** — regenerates `docs/screenshots/` from the real
  game: each named shot boots a fresh headless Chromium (same SwiftShader flags
  as the e2e suite), stages its scene through the `?debug=1` hooks, and writes
  a JPEG at the README framing. `node tools/screenshots.mjs [name…]`,
  `--list` for the names. Documented in `docs/development.md` (new) and
  AGENTS.md.
- **New screenshots:** `01-main-menu`, `11-bond-rail` (all four bond tiers on
  the stat rail, with the "would follow you anywhere" toast), `12-bed-together`
  (you and an ally sitting side by side on the bed, from a cinematic
  three-quarter camera), `13-stay-the-night` (the fade and its one narration
  line, framed large and centred).

### Changed
- **docs/ rewritten for bonds and the bed scene.** `docs/systems/characters-
  dialogue.md` documents `src/chars/bond.js` (thresholds 35/55/75, hysteresis
  5) and `src/sim/bedScene.js` (invite needs an ally and you on the bed, stay
  the night needs trusted, 180 minutes, context gates, guest holds, the bed
  reservation) in place of the old ladder and the bed game;
  `scene-audio-ui.md`, `engine-overview.md`, `sim-world-loop.md`, `core.md`,
  `camera.md`, `humanoid.md`, `scenario-toolkit.md`, `docs/config/chars.md`,
  the config and creation-kit guides, the demo script and the lmstudio-engine
  README no longer describe anything that was removed.
- **Re-captured screenshots** `02` through `06` and `08` through `10` with the
  new tool: all but the cutscene still showed the 12-stat rail with gate pips,
  `08` showed removed outfit and stat buttons in the Director's Cast tab, and
  `10` showed the old cold/wary/warm/devoted bond labels.
- **The run summary's Bonds list speaks the bond tier.** The death/extraction
  screen (`src/ui/deathScreen.js`) labelled bonds cold/wary/warm/devoted from
  raw trust on thresholds of its own; it now shows each character's tier
  (stranger / ally / trusted / loyal) as `endRun()` records it
  (`summary.bondTiers`, from `src/chars/bond.js`, hysteresis included). Raw
  trust is still recorded for meta history and the `vox_confided` unlock.
- **All-audiences tone lexicon.** `src/dialogue/parser/tone.js` no longer
  counts sexy, naughty, dirty, seduce, lips, skin, body, bed, hot, crave,
  desire or touch as flirt, or kneel and strip as a command. Flirt is PG-13
  only: kiss, flirt, tease, wink, charm, cute, pretty, handsome, gorgeous,
  date, dance, blush, want, need, close, closer.
- The stat rail is 200px wide (was 186px).
- The music conductor's `intimacy` mood axis is now `closeness` — it only picks
  the lydian scale and a longer note decay.
- Aria's background is consistent everywhere: the README cast table and two of
  Lola's needling lines (`src/sim/ai/relationships.js`) still called her a
  "street girl" from before she became a corporate negotiator.
- **CI** (`.github/workflows/ci.yml`) — unit tests + lint run on every push to
  `master`/`overhaul/**` and every pull request into `master`; a Playwright
  e2e job runs on pull requests into `master` and on manual dispatch.
- **10 end-to-end tests.** A bed smoke test (`test/smoke/smoke.spec.mjs`)
  drives `bedScene.use()` through sit, lie down, and get up and asserts no
  console errors.
- The `flirt` intent (`data/dialogue/intents.js`) no longer weights `desire`
  or `touch` — its last two physical-cue keywords.

### Removed
- Dead CSS for the bed game and Truth-or-Dare (`.bg-actions`, `.bg-ask`,
  `.tod-turn`, `.tod-prompt` in `styles/hud.css`).

### Fixed
- Leftovers the guard test found on its first run: two comments on the
  hostile-wardrobe fix (`src/sim/combat/combat.js`, `data/outfits.js`) that
  still used retired vocabulary.
- Stale docs: the config reference listed a `gameplay` group that no longer
  exists (the ten groups include `render`); the humanoid skeleton is 31 bones,
  not 34; the Cast tab header said "12-stat"; the camera director's comment
  and `tools/fetch-fonts.mjs` still referred to the bed game and an "adult
  game".
- `migrate()` in `src/core/save.js` now says that it mutates the envelope in
  place and why that's safe (every caller passes a freshly parsed object).
- The stat-rail header ran a character's name straight into their mood
  ("Aria ChenWARM"): the bond chip's `margin-left: auto` inside a
  `space-between` header ate every free pixel. The header now has a gap, the
  name and chip never shrink, and a long mood ellipsises (full text on hover).

## [0.6.0-beta.1] — 2026-09-27 — The bed is just a bed

0.6 turns Lock-Down into an all-audiences survival game — sub-project 1 of the 7-part
upgrade (content cleanse → render quality → characters → survival loop → combat &
stealth → story → UI polish). Beta.1 closes out that first sub-project: the bed
becomes ordinary furniture instead of a game screen.

### Added
- **Bed interactions** (`src/sim/bedScene.js`) — **E** sits on the bed, **E** again
  lies down, **E** or any movement key gets back up. Inviting an ally over (bond
  `ally` or higher) walks them to a second seat socket (`bed.seat1`, added to
  `furniture.bed()`) for a quiet-talk beat: trust +3, tension −5. A trusted
  companion (bond `trusted` or higher) can be asked to stay the night — a ~1.2s
  fade, one narration line drawn from a small per-character pool
  (`data/dialogue/bed.js`), +3h on the clock, the event scheduler held for the
  skip, both the player and the guest rested on return. Nothing is modal; the sim
  keeps running and chat stays open throughout.
- NPCs sleep on the free bed on their own; a reservation (`bedUsers()`) stops
  double-booking, and sitting down or starting a stay evicts a sleeping NPC.
- Refusals for combat, an active event, or a cutscene ("Not in the middle of a
  fight.", "Not now — something is happening."), and for inviting or asking
  someone to stay while the player isn't on the bed yet.
- `BedScene#reset()` runs on every load — releases any held guest brain and
  stands the player up regardless of state, so a save can never resume with
  someone stuck sitting.
- A `#fade` CSS layer for the stay-the-night transition.
- **AGENTS.md** (repo root) — this release starts a guide for AI coding agents
  working on the codebase: run/test/lint commands, the architecture spine,
  content rules, and release discipline.

### Changed
- **The LLM contract is now all-audiences.** `src/dialogue/llm/promptBuilder.js`'s
  `CONTRACT` no longer describes the game as "adults-only (18+)" or instructs the
  model to write explicit sexual content; characters can be warm, loyal, wry,
  scared, angry, or lightly flirtatious, but never sexual or graphic, and are
  told to deflect a guest who pushes for sex. `config/llm.yaml` and
  `docs/config/llm.md`'s `heated` budget comment now reads "high tension or
  live combat" instead of naming arousal/intimacy.
- **Intents and tone vocabulary scrub.** `data/dialogue/intents.js`'s `flirt`
  intent drops `sexy`, `bed`, `naughty`, and the `take off` phrase; its
  `command` intent drops `kneel` and `strip`; the standalone `escalate` intent
  is retired (Lola's "Push closer" branch and `lola.flirt.closer` trigger off
  `flirt` alone now). `src/dialogue/parser/tone.js`'s `flirt` lexicon drops
  `wet`, `hard`, `undress`, `naked`, `pleasure`, and `moan`.
- **Aria Chen is now a corporate negotiator**, not a street-level escort: her
  bio (`data/cast/aria.js`) says she closed deals and smoothed scandals for
  executives with too much money and knows exactly what they're afraid of.
  Her matching flirt line in `data/dialogue/aria/core.js` was rewritten to fit.
- **Flirt-line text pass.** Rewrote authored dialogue that implied sex,
  staged intimacy, or undressing rather than PG-13 banter: Kai's "draw the
  obvious conclusion" line (`data/dialogue/kai/core.js`), and Lola's "talked
  into it" / "ask again when the sirens stop" / "earn the next step" lines
  (`data/dialogue/lola/core.js`). Every `[[tag]]`, `when`, and `fx` is
  unchanged — only the prose.

### Removed
- `src/humanoid/pairedPoses.js` — orphaned once the guest brain-hold moved onto
  `Brain#hold()`/`release()`.

### Fixed
- Bed intents now match bed-specific phrasing only ("come sit", "stay the
  night") instead of everyday words like "come here" or "tonight" that used to
  misfire into a bed action.
- A guest's AI brain now stays held only as long as the bed scene needs it —
  combat starting or the guest dying releases it instead of leaving it stuck.
- **The smoke suite raced the opening cutscene.** `applyScenario` sleeps 600ms
  before the intro plays, and the boot helper read "no cutscene, not paused"
  inside that window — so a test could open a panel just as the intro started,
  and "only one panel is open" failed on every full run while passing alone.
  Runs now expose `app.scenarioSettled`, and the helper waits on it. Two full
  e2e runs: 9/9 both.

## [0.6.0-alpha.2] — 2026-09-27 — Bonds, not gates

### Added
- **Bond tier** (`src/chars/bond.js`) — a trust+loyalty relationship ladder
  (`stranger → ally → trusted → loyal`) with hysteresis, replacing the 7-tier
  intimacy ladder end to end: `actorQueue`'s command refusal hook is now
  `minBond`, dialogue conditions are `bondAtLeast`/`bondBelow`, the stat rail
  shows a bond chip in place of gate pips, a tier change toasts and reaches the
  activity feed, and the LLM prompt carries a read-only bond line.
- **Save format v2** — migrates a v1 (v0.5) save past the retired gates/consent
  state and the three dropped stats; `parseSaveEnvelope` now runs the migration
  before checking the version, so a legacy save validates instead of being
  rejected outright.

### Changed
- **Stat model: 12 → 9.** `arousal`, `pleasure` and `horniness` are gone from
  `STAT_KEYS`. Mood's `sultry` is renamed `warm`, animation tempo now reads
  energy and tension instead of arousal, the AI's dance action scores on the fun
  need, and whisper/flirt tone raise trust and happiness instead.

## [0.6.0-alpha.1] — 2026-09-27 — Clean slate begins

### Added
- `src/chars/bond.js` foundation + `chars.bond` config (entry thresholds,
  hysteresis margin) — the relationship model the rest of 0.6 is built on.

### Removed
- The bed game (39 actions), truth-or-dare (21 truths + 21 dares), the intimate
  pose set, the `gameplay` config group, the explicitness setting, the 18+ boot
  gate, and the undress (`none`/`underwear`) outfit states.

### Fixed
- The smoke test now covers what's actually reachable (cards + mystery) instead
  of a truth-or-dare case that no longer exists.

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
- **Alt-tabbing during a cutscene froze the game permanently.** Camera shots drove
  themselves from requestAnimationFrame, which a browser STOPS in a hidden tab —
  so the shot never resolved, the cutscene's `finally` never ran, and the sim
  stayed paused for the rest of the session with no way back. The only symptom
  was "I can't move or turn the camera". A timer backstop, a skip that reaches a
  stalled shot directly, and a watchdog under the whole thing.
- **Escape now skips a whole cutscene**, and the game says so. Space advanced one
  of twenty-one beats, and there was no skip affordance anywhere.
- **Seeded runs stopped being reproducible on load.** `rng` was captured in every
  save and never restored — `Rng.deserialize` had zero call sites.
- **`exitBedScene` dropped you into `director`**, a spectator mode with no
  movement, and persisted the choice across reloads.
- **Graphics settings did nothing** — written to the in-memory store only, then
  discarded by the next boot, while the panel promised "applies on reload".
- **`world.precompile()` ran before the lights existed**, so every program it
  compiled was the wrong variant and the stall it prevents still happened.
- **Rim lights were claimed at spawn and never re-claimed**, so the effect
  stopped existing after the first fight and Kai never had one at all.
- **`gesture_cross_arms` spread the arms** (elbows 0.475m → 0.630m, hands behind
  the torso). It is the first pose a new player ever sees.
- Free-food exploit: `refugee_work`'s once-a-day guard read a field nothing wrote.
- Seven write-only systems now have consequences: `fortified`,
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
