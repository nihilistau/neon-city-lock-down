# Sub-project #1 — Content cleanse + bonds (v0.6.0 "Clean slate")

Date: 2026-09-27 · Branch: `overhaul/v0.6` · Status: approved design, awaiting spec review

## Context

This is the first of seven sub-projects in the full upgrade:

1. content cleanse and bonds (this spec)
2. asset pipeline and render quality
3. GLTF characters
4. survival/lockdown loop
5. combat and stealth
6. story and exploration
7. UI/AAA polish

It comes first because it changes the stat model and the gate-check spine that every later project builds on.

**Goal:** remove every piece of 18+ content, including:

- the bed game
- the intimacy ladder
- the arousal, horniness and pleasure stats
- the explicitness cap
- the age gate
- adult Truth-or-Dare
- the undress outfit states
- the explicit LLM contract

In its place, add a **bond tier** that later sub-projects use to gate companion abilities. The bed stays as an ordinary piece of furniture: the player can sit and lie on it and invite characters to it, and intimacy is at most implied by a fade to black.

**Non-goals:** companion orders and jobs (#4), new character art (#3), story content (#6).

## 1. Bond tier replaces the intimacy ladder

### New module: `src/chars/bond.js`

`src/chars/gates.js` is deleted and replaced by `src/chars/bond.js`, a pure module with no DOM or three.js imports:

- `BOND_TIERS = ['stranger', 'ally', 'trusted', 'loyal']`
- `bondScore(stats) = (stats.trust + stats.loyalty) / 2`
- `bondTier(stats, prevTier?)`:
  - Entry thresholds: ally 35, trusted 55, loyal 75.
  - **Hysteresis:** once a character holds a tier, they only drop out of it when the score falls **5 below** that tier's entry threshold.
  - The thresholds and the hysteresis margin are config-tunable in `config/chars.yaml` under `bond.thresholds` / `bond.hysteresis`, validated in `configSchema.js` with defaults in `configDefaults.js`.
- `bondAtLeast(stats, tier, prevTier?) → boolean`

### Character integration (`src/chars/character.js`)

- `gates`, `consent`, `topGate`, `gateCheck()` and `gate()` are removed.
- A `bond` getter caches the current tier in `this._bond`. It is re-evaluated after every stat change.
- When the tier changes, the character emits `bond.changed { charId, from, to }`.
- `serialize()` stores `bond` (for hysteresis continuity). `restore()` ignores legacy `gates`/`consent` keys.

### actorQueue

- The `gateTier` refusal hook becomes an optional `minBond` on a command.
- Refusal still emits `actor.refused`. Nothing else in the command funnel changes.

### Dialogue

- The `gateAtLeast` condition (`selector.js`, `topics.js`) becomes `bondAtLeast`.
- Every stage direction using the `gate` and `pair` tags is removed. The `stat` tag stays.
- The `gate` effect in `effects.js` is removed.

### UI

- The stat rail swaps its gate pips for a **bond chip** (tier name + colour).
- The HUD shows a toast on `bond.changed` (e.g. "Kai now trusts you").
- The Director tabDialog "CONSENT / GATES" rows become a read-only bond readout.

## 2. Stat model: 12 → 9

### `STAT_KEYS`

`arousal`, `pleasure` and `horniness` are removed from `STAT_KEYS`. The remaining nine are:

- happiness
- openness
- dominance
- trust
- tension
- energy
- sobriety
- loyalty
- fear

### Removal in one change

All of the following change together, so that schema validation never fails between commits:

- `STAT_KEYS`
- coupling cases and decay in `stats.js`
- `startStats`, `coupling` and `decay` in `configDefaults.js`, `configSchema.js` and `config/chars.yaml`
- cast base stats and receptivity (`data/cast/*.js`)
- scenario `castMoodShifts`
- every dialogue `fx` / `cond` that uses these keys
- `gambits.js` `targetFx`
- `types.js` `StatKey`

### Other stat consumers

- **Mood:** `sultry` is renamed `warm`. It triggers on high happiness + trust with low tension.
- **Animation tempo:** `animTempo` stops reading arousal and uses energy and tension instead.
- **AI:** the `dance` action scores on the fun need and gives happiness instead of arousal.
- **Whisper:** gives trust +1 instead of arousal.
- **Flirt tone:** raises trust and happiness instead of arousal and horniness.

## 3. Bed interactions (implied only)

### Player uses the bed

- `bed` is added to `PROP_PROMPTS` (`zoneBuilder.js`) and gets a `_useProp('bed')` case (`app.js`).
- **E: "Sit on bed".** The player goes to first person at `bed.seat0` via `firstPerson.placeAt`, re-using the staging from the old `enterBedScene`.
- While seated, the prompt offers **E: "Lie down"**. This lowers the camera to `bed.lie_center`.
- **E again, or any movement key: "Get up".** The player returns to the bedside waypoint.
- Nothing is modal. The sim keeps running and chat stays available.
- The state lives in `app.bedState = { player: 'none' | 'sitting' | 'lying', guests: charId[] }`.

### Inviting a character

- The rewritten `go_to_bed` intent covers "come sit", "join me", "stay with me" and "sit with me". The topics `lola/aria/kai.bed.invite` replace `*.games.bed`.
- Behaviour depends on the character's bond tier:

| Bond tier | Response |
|---|---|
| below ally | Refusal line, per character |
| ally or higher | The character walks over and `queue.sit('bed.seat1')` (a second seat socket is added to `furniture.bed()`). A quiet-talk beat plays: trust +3, tension −5. |
| trusted or higher | A follow-up chip offers "Stay the night" (topic `*.bed.stay`). |

- "Get up" / "you can go" dismisses guests with `queue.stand()`, and their brain resumes.

### "Stay the night"

This is the only implied-intimacy beat. Nothing is shown except a fade.

1. `bedscene.started` is emitted. The screen fades to black (a CSS overlay, ~1.2s).
2. One narration line is shown in the subtitle area. Lines come from a small per-character pool in `data/dialogue/bed.js`.
3. The event scheduler is held (`scheduler.hold = true`) and `clock.skip(180)` runs.
4. The player's rest need resets. For the guest: rest need resets, happiness +8, loyalty +5, tension −10.
5. The scheduler is released. The screen fades in and `bedscene.ended` is emitted.

Existing hooks move to `bedscene.*` events:

- camera director suspend
- stat-rail hide
- conductor quiet mood

The pose/brain hold (`pose.paired`) remains while a guest is seated.

### AI sleep

The `sleep` action targets `bed.lie_center` via `queue.sit` when no one occupies it. Otherwise it falls back to the current window waypoint.

## 4. Removals

### Files deleted

- `src/games/bedGame.js`
- `data/games/bedActions.js`
- `data/poses/intimate.js`
- `src/games/truthOrDare.js`
- `data/games/todPrompts.js`
- `src/chars/gates.js`
- `src/ui/gate18.js`
- `config/gameplay.yaml` (plus its `docs/config/gameplay.md`, defaults and schema group)
- `docs/screenshots/07-bed-game.jpg`
- `test/unit/bedgame.test.mjs`
- `test/unit/gates.test.mjs`

### Code removed

- **app.js:**
  - the BedGame/ToD construction
  - the bed/tod `game.requested` branches
  - `enterBedScene` and `exitBedScene` (replaced by the Section 3 bed functions)
  - `bedReaction()`
  - the `gate`/`pair`/`outfit none` debug commands
  - the `stageCtx.explicitness` plumbing
  - the age-gate await (audio unlock is already covered by pointerdown + the main menu)
- **gamesPanel.js:** the bed HUD, meters, "Ask for more" and `bedPick`. Cards and mystery stay.
- **hud.css:** the `.bg-meter*`, `.bg-gate`, `.bg-tier*` and `#games-panel.bed-hud` blocks. `.bg-line` and `.bg-hint` stay.
- **statBars.js** gate pips and **director.css** `.td-gaterow`.
- **Explicitness:** `settings.explicitness`, `settings.confirmed18`, `globalThis.__ncldExplicitness`, the settingsPanel CONTENT row, the tabSettings EXPLICITNESS section, `EXPLICITNESS_CAP` and `chars.explicitnessCap`.
- **Wardrobe:** the `none`/`underwear`/`towel` render mapping. `data/outfits.js` drops those states, and the Director tabCast buttons are updated.
- **Scenarios:** `the_bed_game` and `truth_or_dare` are removed. `last_night` loses its arousal shift.
- **Schema:** `GAME_SET` drops `bed` and `tod`.
- **Intents and tone:** the `escalate` intent is removed. `flirt` keeps only non-sexual vocabulary. `command` loses "kneel" and "strip". `tone.js` flirt word list is cleaned.
- **Aria's bio:** rewritten as a corporate fixer who brokered access and favours. The flirt line that references the old bio is rewritten.
- **LLM:**
  - `promptBuilder.js`: the `CONTRACT` becomes a noir survival drama. Characters may be warm, loyal or lightly flirtatious (PG-13); **no sexual content**. `bedBlock`/`buildBedBlock`, `spice`, the INTIMACY line and `GATE_ORDER` are removed. A read-only `Bond with player: <tier>` line is added.
  - `tags.js`: drops the `bed_*` clips, `COVERAGE_MAP` nude entries, the arousal/pleasure/horniness stats, and the `consent`/`gate`/`offer_gate`/`arousal_delta` tags.
  - `agent.js`: the "heated" budget keys on high tension instead.
  - `tools/gameEngine.mjs`: its schema drops the same fields and `sultry`.
- **Docs:** README, `package.json` description, `docs/**` system and config pages, and `lmstudio-engine/README.md` examples are scrubbed. CHANGELOG gets a v0.6.0 entry; past entries stay as history.

## 5. Save compatibility

- `save.js` bumps its format version.
- On restore, character stats keep only the keys in `STAT_KEYS`, and unknown keys are dropped.
- Legacy `gates`/`consent` fields are ignored. `bond` is recomputed if absent.
- `bedState` is not persisted: loading a save always starts standing.

## 6. Testing

- **New `test/unit/bond.test.mjs`:**
  - thresholds
  - hysteresis (no flicker at 34/35/36; the drop only happens at 30)
  - one `bond.changed` per real crossing
  - `bondAtLeast`
- **New `test/unit/bedscene.test.mjs`:**
  - the player sit → lie → get-up state machine
  - invite refusal below ally, sit at ally, the "stay" chip at trusted
  - "stay the night" advances the clock 180 min, applies the stat effects, and holds the scheduler (no event fires during the skip)
- **Save:** a v0.5 fixture with gates/consent/arousal restores cleanly with 9 stats.
- **Guard test `test/unit/clean-content.test.mjs`:**
  - greps `src/`, `data/`, `config/`, `tools/`, `styles/` and `index.html` for a banned list: arousal, horniness, pleasure (as a stat), explicit(ness), 18+, nude, naked, erotic, `bed_`-clip names, gateTier, and similar
  - fails with file:line on any hit
  - has a small allowlist for unrelated words (e.g. "explicit" in the lint tool's own messages, if needed)
- **Updated:** stats (9 keys), mood (`warm`), llmtags (bond line, removed tags), dialogue (no `gate` tag), regressions (drop the bed/ToD cases, keep the seat/lie socket cases), overhaul-content, usercontent.
- **Smoke (Playwright):**
  - the age-gate step is removed
  - new test: walk to the bed → E sit → E lie → E get up, with no console errors
- **Must pass:** `npm test`, `npm run lint` (lint-data + lint-config), `npm run test:e2e`.

## 7. Delivery

- Work is on `overhaul/v0.6` in small commits by area:
  - bond module + stats
  - data scrub
  - bed interactions
  - removals
  - LLM
  - UI
  - docs
  - tests
- A code review runs before merging to `master` and tagging v0.6.0.
- After the merge, update the memory notes `content-register` and `intimacy-overhaul` so they record that the direction is now all-audiences gameplay-first, and that the intimacy system has been retired.
