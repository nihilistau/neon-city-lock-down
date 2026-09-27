# Content Cleanse + Bonds (v0.6.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every piece of 18+ content from Neon-City: Lock-Down, replace the intimacy ladder with a bond tier derived from trust + loyalty, and keep the bed as furniture you can sit or lie on and invite characters to (intimacy only implied, by a fade).

**Architecture:**
- A new pure module `src/chars/bond.js` replaces `src/chars/gates.js` as the relationship authority.
- The ActorQueue spine keeps its single refusal hook, renamed from `gateTier` to `minBond`.
- Bed behaviour lives in a new port-injected `src/sim/bedScene.js`, so it runs under `node --test`. `app.js` only wires ports.
- Removals are ordered so that every commit leaves `npm test` and `npm run lint` green. Schema validation throws at import on unknown stat keys, so stats and the data that uses them change in one task.

**Tech Stack:** three.js r185 (vendored), plain ES modules + import map, `node --test`, Playwright smoke, YAML config via `js-yaml`.

**Spec:** `docs/superpowers/specs/2026-09-27-content-cleanse-and-bonds-design.md`

## Global Constraints

- **No sexual content anywhere**, in code, data, config, prompts, docs or tests (except CHANGELOG history entries, which stay as written).
- **Stats after this plan (9):** `happiness, openness, dominance, trust, tension, energy, sobriety, loyalty, fear`.
- **Bond tiers:** `stranger < ally < trusted < loyal`.
  - Entry thresholds on `(trust + loyalty) / 2`: ally 35, trusted 55, loyal 75.
  - Hysteresis 5: a held tier is kept until the score drops below `entry − 5`.
- **Stay the night:**
  - `STAY_MINUTES = 180`.
  - Guest effects: happiness +8, loyalty +5, tension −10, brain `needs.rest = 0`.
  - Player effect: morale +10. The player has no rest need; morale is the player-side analogue, a deliberate spec interpretation.
- **Invite effects:** trust +3, tension −5.
- **Old (v1) saves must still load.** The save `VERSION` becomes 2.
- **Every commit:** `npm test` and `npm run lint` pass. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Code style:** `// @ts-check` header; comments explain *why*, matching the repo's voice; no framework.
- **Run tests with** `npm test` (all) or `node --test test/unit/<file>.test.mjs` (one file).

---

## File map

| File | Change |
|---|---|
| `src/chars/bond.js` | **Create.** Pure bond tier logic |
| `src/sim/bedScene.js` | **Create.** Bed state machine over injected ports |
| `data/dialogue/bed.js` | **Create.** Invite/stay/dismiss topics, intents, narration pool |
| `test/unit/bond.test.mjs`, `test/unit/bedscene.test.mjs`, `test/unit/clean-content.test.mjs` | **Create** |
| `src/chars/gates.js`, `src/games/bedGame.js`, `src/games/truthOrDare.js`, `data/games/bedActions.js`, `data/games/todPrompts.js`, `data/poses/intimate.js`, `src/ui/gate18.js`, `config/gameplay.yaml`, `docs/config/gameplay.md`, `docs/screenshots/07-bed-game.jpg`, `test/unit/bedgame.test.mjs`, `test/unit/gates.test.mjs` | **Delete** |
| `src/chars/character.js`, `src/chars/stats.js`, `src/chars/mood.js`, `src/chars/wardrobe.js`, `src/sim/actors/actorQueue.js`, `src/sim/scheduler.js`, `src/sim/ai/actionCatalog.js`, `src/dialogue/*`, `src/dialogue/llm/*`, `src/core/{app,save,settings,types,log}.js`, `src/ui/*`, `src/scene3d/tower/{furniture,zoneBuilder}.js`, `src/camera/firstPerson.js`, `data/*`, `config/chars.yaml`, `styles/*`, `tools/*`, docs | **Modify** |

---

### Task 1: Bond module (pure) + config

**Files:**
- Create: `src/chars/bond.js`
- Test: `test/unit/bond.test.mjs`
- Modify: `data/configDefaults.js` (the `chars:` group), `data/configSchema.js` (the `chars:` group), `config/chars.yaml`

**Interfaces:**
- Produces:
  - `BOND_TIERS: ['stranger','ally','trusted','loyal']`
  - `bondScore(stats) → number`
  - `bondTier(stats, prevTier?) → BondTier`
  - `bondAtLeast(stats, tier, prevTier?) → boolean`
  - `bondIndex(tier) → number`
  - config keys `chars.bond.thresholds {ally,trusted,loyal}` and `chars.bond.hysteresis`

- [ ] **Step 1: Write the failing test** `test/unit/bond.test.mjs`

```js
// @ts-check
// src/chars/bond.js — the relationship tier that replaced the intimacy ladder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOND_TIERS, bondScore, bondTier, bondAtLeast, bondIndex } from '../../src/chars/bond.js';

const s = (trust, loyalty) => ({ trust, loyalty });

test('tiers are ordered stranger < ally < trusted < loyal', () => {
  assert.deepEqual(BOND_TIERS, ['stranger', 'ally', 'trusted', 'loyal']);
  assert.ok(bondIndex('ally') < bondIndex('trusted'));
  assert.equal(bondIndex('nonsense'), -1);
});

test('score is the mean of trust and loyalty', () => {
  assert.equal(bondScore(s(40, 30)), 35);
});

test('entry thresholds with no previous tier', () => {
  assert.equal(bondTier(s(34, 34)), 'stranger');
  assert.equal(bondTier(s(35, 35)), 'ally');
  assert.equal(bondTier(s(55, 55)), 'trusted');
  assert.equal(bondTier(s(75, 75)), 'loyal');
  assert.equal(bondTier(s(100, 100)), 'loyal');
});

test('hysteresis: a held tier survives small dips, drops only below entry-5', () => {
  assert.equal(bondTier(s(34, 34), 'ally'), 'ally');   // 34 ≥ 30
  assert.equal(bondTier(s(31, 31), 'ally'), 'ally');
  assert.equal(bondTier(s(29, 29), 'ally'), 'stranger');
  assert.equal(bondTier(s(51, 51), 'trusted'), 'trusted');
  assert.equal(bondTier(s(49, 49), 'trusted'), 'ally');
});

test('hysteresis never promotes: rising still needs the full entry score', () => {
  assert.equal(bondTier(s(54, 54), 'ally'), 'ally');
  assert.equal(bondTier(s(55, 55), 'ally'), 'trusted');
});

test('a large fall can skip tiers', () => {
  assert.equal(bondTier(s(10, 10), 'loyal'), 'stranger');
});

test('bondAtLeast compares against the (hysteresis-aware) tier', () => {
  assert.equal(bondAtLeast(s(40, 40), 'ally'), true);
  assert.equal(bondAtLeast(s(40, 40), 'trusted'), false);
  assert.equal(bondAtLeast(s(33, 33), 'ally', 'ally'), true);
  assert.equal(bondAtLeast(s(0, 0), 'stranger'), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/bond.test.mjs`
Expected: FAIL, `Cannot find module …/src/chars/bond.js`

- [ ] **Step 3: Implement** `src/chars/bond.js`

```js
// @ts-check
// PURE relationship tier. The successor to the intimacy ladder: a character's
// bond with the player is DERIVED from trust + loyalty, never stored as truth,
// so it cannot drift out of sync with the stats that dialogue, events and
// objectives already move. The only remembered thing is the previous tier,
// which buys hysteresis — without it a character hovering at 35 would flip
// ally/stranger on every line and spam "Kai now trusts you".
import { cfg } from '../core/config.js';
import { CONFIG_DEFAULTS } from '../../data/configDefaults.js';

/** @typedef {'stranger'|'ally'|'trusted'|'loyal'} BondTier */

/** Ordered low → high. Order is structural; thresholds are config-tunable. */
export const BOND_TIERS = /** @type {BondTier[]} */ (['stranger', 'ally', 'trusted', 'loyal']);

const DEF = CONFIG_DEFAULTS.chars.bond;
const thresholds = () => cfg('chars.bond.thresholds', DEF.thresholds);
const hysteresis = () => cfg('chars.bond.hysteresis', DEF.hysteresis);

/** @param {string} tier */
export function bondIndex(tier) { return BOND_TIERS.indexOf(/** @type {BondTier} */ (tier)); }

/** @param {{trust:number, loyalty:number}} stats */
export function bondScore(stats) { return ((stats.trust ?? 0) + (stats.loyalty ?? 0)) / 2; }

/**
 * @param {{trust:number, loyalty:number}} stats
 * @param {BondTier} [prevTier] the tier held before this change (enables hysteresis)
 * @returns {BondTier}
 */
export function bondTier(stats, prevTier) {
  const score = bondScore(stats);
  const thr = thresholds();
  const held = prevTier ? bondIndex(prevTier) : -1;
  const margin = hysteresis();
  let tier = 0;
  for (let i = 1; i < BOND_TIERS.length; i++) {
    const entry = thr[BOND_TIERS[i]];
    // a tier already held is kept down to entry - margin; a new one needs full entry
    const need = i <= held ? entry - margin : entry;
    if (score >= need) tier = i; else break;
  }
  return BOND_TIERS[tier];
}

/**
 * @param {{trust:number, loyalty:number}} stats @param {BondTier} tier
 * @param {BondTier} [prevTier]
 */
export function bondAtLeast(stats, tier, prevTier) {
  return bondIndex(bondTier(stats, prevTier)) >= bondIndex(tier);
}
```

- [ ] **Step 4: Add the config group**

In `data/configDefaults.js`, inside `chars: { … }` directly after the `compliance: {…},` block, add:

```js
    bond: {         // relationship tier (src/chars/bond.js), on (trust + loyalty) / 2
      thresholds: { ally: 35, trusted: 55, loyal: 75 },
      hysteresis: 5,  // a held tier survives until the score drops below entry - this
    },
```

In `data/configSchema.js`, inside `chars: { … }` after `compliance: {…},`, add:

```js
    bond: {
      thresholds: { ally: num(0, 100), trusted: num(0, 100), loyal: num(0, 100) },
      hysteresis: num(0, 50),
    },
```

In `config/chars.yaml`, after the `compliance:` block, add:

```yaml
bond:                         # relationship tier on (trust + loyalty) / 2 (src/chars/bond.js)
  thresholds: { ally: 35, trusted: 55, loyal: 75 }
  hysteresis: 5               # a held tier survives until the score drops below entry - this
```

- [ ] **Step 5: Run the tests and lint**

Run: `node --test test/unit/bond.test.mjs && npm run lint`
Expected: all bond tests PASS; `Config lint passed.`

- [ ] **Step 6: Commit**

```bash
git add src/chars/bond.js test/unit/bond.test.mjs data/configDefaults.js data/configSchema.js config/chars.yaml
git commit -m "feat(chars): bond tier — trust+loyalty relationship ladder with hysteresis"
```

---

### Task 2: Remove the bed game and Truth-or-Dare

This task removes both minigames and every entry point to them. The bed topics are removed here and come back in Task 7 in their new form, so each commit stays green.

**Files:**
- Delete:
  - `src/games/bedGame.js`, `data/games/bedActions.js`, `data/poses/intimate.js`
  - `src/games/truthOrDare.js`, `data/games/todPrompts.js`
  - `config/gameplay.yaml`, `docs/config/gameplay.md`, `test/unit/bedgame.test.mjs`
- Modify:
  - `src/core/app.js`, `src/ui/gamesPanel.js`, `styles/hud.css`
  - `src/ui/director/tabGames.js`, `src/ui/kitPanel.js`
  - `src/camera/cameraDirector.js`, `src/ui/statBars.js`
  - `data/scenarios.js`, `data/schema.js`, `data/dialogue/games.js`
  - `data/configDefaults.js`, `data/configSchema.js`
  - `src/dialogue/llm/tags.js`, `src/dialogue/llm/promptBuilder.js`
  - `tools/lint-data.mjs`, `src/dialogue/effects.js`
  - `test/unit/regressions.test.mjs`, `test/unit/overhaul-content.test.mjs`, `test/unit/usercontent.test.mjs`
  - `src/core/config.js`, `tools/lint-config.mjs` (only if they list config groups by name)

**Interfaces:**
- Produces: `GAME_SET = new Set(['cards'])`, plus the `mystery:<case>` prefix. The bus events `bedgame.*` no longer exist.

- [ ] **Step 1: Delete the files**

```bash
git rm src/games/bedGame.js data/games/bedActions.js data/poses/intimate.js src/games/truthOrDare.js data/games/todPrompts.js config/gameplay.yaml docs/config/gameplay.md test/unit/bedgame.test.mjs
```

- [ ] **Step 2: `src/core/app.js`**
  - Delete `import '../../data/poses/intimate.js';` (line 4) and the `BedGame` / `TruthOrDare` imports (lines 61-62).
  - Delete the `this.bedGame = new BedGame({...});` and `this.truthOrDare = new TruthOrDare({...});` blocks (~644-653).
  - In the `threat.changed` handler, change `!this.combat.active && !this.bedGame?.active` to `!this.combat.active && !this.bedScene?.busy`. `bedScene` arrives in Task 7; optional chaining keeps this safe until then.
  - In `on('game.requested', …)`, the body becomes:

```js
    on('game.requested', ({ game }) => {
      if (!this.gamesPanel || !game) return;
      if (game === 'cards') this.gamesPanel.cards();
      else if (game.startsWith('mystery:')) this.gamesPanel.mystery(game.slice(8));
    });
```

  - Delete the two `on('bedgame.started'…)` / `on('bedgame.ended'…)` conductor lines (~292-293).
  - Delete the methods `enterBedScene`, `exitBedScene` and `bedReaction` (~1250-1338). Task 7 rebuilds the staging from the snippet quoted there.
  - Grep `app.js` for `bedGame`, `truthOrDare`, `bed_recline`, `enterBedScene` and `bedPick`, and remove the remaining references. The scenario code path calls `gamesPanel.<game>()` from scenario `game:` payloads; keep only `cards` and `mystery:`.

- [ ] **Step 3: `src/ui/gamesPanel.js`**
  - Delete the import of `bedActions` (line 7) and the `bedgame.state` / `bedgame.talk` listeners (18-26).
  - Delete the bed special case in `close()` (33-37).
  - Delete the methods `bed`, `_endBed`, `_renderBed`, `_meter`, `_bedAct`, `_bedAsk`, `tod` (and its helpers) and `bedPick`.
  - Update the header comment to list only cards + mystery.
  - Keep the `.bg-line` / `.bg-hint` markup used by cards and mystery.

- [ ] **Step 4: `styles/hud.css`** — delete the `.bg-meters`, `.bg-meter`, `.bg-bar`, `.bg-fill`, `.bg-gate` and `.bg-tier*` rules (~205-215) and the whole `#games-panel.bed-hud …` block (~343-358). Keep `.bg-line` and `.bg-hint`.

- [ ] **Step 5: Listeners and text**
  - `src/camera/cameraDirector.js`: rename the `bedgame.started` / `bedgame.ended` subscriptions (lines ~43, 59-60, 100) to `bedscene.started` / `bedscene.ended`. The suspend behaviour is kept for Task 7's fade.
  - `src/ui/statBars.js`: rename the same two subscriptions to `bedscene.started` / `bedscene.ended`.
  - `src/ui/director/tabGames.js`: delete the "BED GAME" section (9-14) and its click handler (30-33), and any ToD button/handler. Keep cards, mystery and gambits.
  - `src/ui/kitPanel.js` line 30: the help text becomes `'game: "cards" | "mystery:<case>"'`.

- [ ] **Step 6: Data**
  - `data/scenarios.js`:
    - Delete the `the_bed_game` and `truth_or_dare` scenario entries.
    - Update the `game` typedef comment (line 22) to `'cards' | 'mystery:<case>'`.
    - Leave `last_night`'s arousal shift for Task 5.
  - `data/schema.js`: the game set and its assertion become:

```js
/** minigames a topic or line may open — see src/dialogue/effects.js */
const GAME_SET = new Set(['cards']);

/** @param {any} g @param {string} where */
function assertGame(g, where) {
  assert(typeof g === 'string' && (GAME_SET.has(g) || g.startsWith('mystery:')),
    `${where} must be one of ${[...GAME_SET].join('|')} or mystery:<case>`);
}
```

  - `data/dialogue/games.js`:
    - Delete the `play_tod` and `go_to_bed` intents, the three ToD topics (`lola.games.tod`, `aria.games.tod`, `kai.games.tod`) and the three bed topics (`*.games.bed`).
    - Rewrite the header comment so it no longer mentions bed actions or truth-or-dare prompts.
  - `src/dialogue/effects.js`: update the `eff.game` comment to `'cards' | 'mystery:<caseId>'`, and delete the sentence about Lola's truth-or-dare.

- [ ] **Step 7: Config group `gameplay`**
  - Delete the `gameplay: { bed: {...} }` block from `data/configDefaults.js` (~296-308) and from `data/configSchema.js` (~157-166).
  - Grep `src/core/config.js` and `tools/lint-config.mjs` for `'gameplay'`. If groups are listed by name, remove `gameplay` from the list.
  - Delete the `gameplay` row in `docs/config/README.md`.

- [ ] **Step 8: LLM vocabulary**
  - `src/dialogue/llm/tags.js`: remove `'bed_recline', 'bed_reach', 'bed_arch', 'bed_straddle', 'bed_climax'` from `CLIPS`.
  - `src/dialogue/llm/promptBuilder.js`:
    - Delete `bedBlock` and `buildBedBlock`, and the `bedBlock` entry in `parts`.
    - Delete the `opts.action` branch in `buildUserTurn` and the `action` field from its JSDoc.

- [ ] **Step 9: Lint tool** — in `tools/lint-data.mjs`, delete the `bedActions` and `todPrompts` imports and count lines (58-60).

- [ ] **Step 10: Tests**
  - `test/unit/regressions.test.mjs`:
    - Delete the imports of `BedGame`, `TruthOrDare` and `BED_ACTIONS` / `BED_TIERS`.
    - Delete the tests that use them (~114-143).
    - **Keep** the seat/lie socket tests (~97-112).
  - `test/unit/overhaul-content.test.mjs`: delete the import at line 15 and tests 63-103.
  - `test/unit/usercontent.test.mjs:81`: change the asserted scenario from `the_bed_game` to another existing scenario id. Use `first_night`, which exists (used at `app.js` `playCutscene`).

- [ ] **Step 11: Verify**

Run: `npm test && npm run lint`
Expected: all pass. The total drops by the deleted tests. Then grep for leftovers:

```bash
grep -rn "bedGame\|BedGame\|truthOrDare\|TruthOrDare\|bedActions\|todPrompts\|bed_recline\|bedgame\.\|enterBedScene\|bedPick" src data tools test styles config index.html
```

Expected: no output.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor: remove the bed game and truth-or-dare"
```

---

### Task 3: Remove the explicitness cap, the 18+ gate and the undress outfit states

**Files:**
- Delete: `src/ui/gate18.js`
- Modify:
  - `src/core/app.js`, `src/core/settings.js`
  - `src/ui/settingsPanel.js`, `src/ui/director/tabSettings.js`, `src/ui/saveMenu.js`
  - `src/chars/wardrobe.js`, `src/chars/character.js`, `src/dialogue/engine.js`
  - `data/outfits.js`, `src/ui/director/tabCast.js`
  - `src/dialogue/llm/tags.js`, `src/dialogue/llm/promptBuilder.js`
  - `styles/base.css`, `test/smoke/smoke.spec.mjs`, `test/unit/overhaul-content.test.mjs`

**Interfaces:**
- Produces:
  - `Wardrobe.change(outfitId, silent)` with no render cap; the render id always equals the outfit id.
  - The outfit ids `none` and `underwear` no longer exist.

- [ ] **Step 1: Write the failing test.** Add to `test/unit/overhaul-content.test.mjs`, **replacing** the explicitness-render-cap tests (156-194):

```js
test('no character has an undress outfit state', async () => {
  const { OUTFITS } = await import('../../data/outfits.js');
  for (const [id, recipes] of Object.entries(OUTFITS)) {
    for (const bad of ['none', 'underwear']) {
      assert.ok(!(bad in recipes), `${id} still has outfit "${bad}"`);
    }
  }
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/unit/overhaul-content.test.mjs`
Expected: FAIL, `lola still has outfit "none"`

- [ ] **Step 3: `data/outfits.js`**
  - Delete every character's `underwear:` and `none:` entries (e.g. lines 25-26, 37-38, 49-50, 61-62, 73-74; check each character).
  - Rewrite the header comment (2-4) so it doesn't mention undress states.
  - Keep `towel`, `robe`, `swim` and `sleepwear`.

- [ ] **Step 4: `src/chars/wardrobe.js`**
  - Delete the `EXPLICITNESS_CAP` import and the `renderState` function.
  - The header becomes: `// Wardrobe state machine: builds outfit layer sets lazily, toggles visibility, emits change events.`
  - `change()` becomes:

```js
  change(outfitId, silent = false) {
    const recipes = OUTFITS[this.c.id];
    if (!recipes || !recipes[outfitId] || outfitId === this.current) return false;
    if (!this.layers[outfitId]) {
      const meshes = buildOutfit(this.c.persona, this.c.actor.rig, recipes[outfitId]);
      for (const m of meshes) this.c.actor.root.add(m);
      this.layers[outfitId] = meshes;
    }
    for (const [id, meshes] of Object.entries(this.layers)) {
      for (const m of meshes) m.visible = id === outfitId;
    }
    const prev = this.current;
    this.current = outfitId;
    if (!silent) {
      emit('wardrobe.changed', { id: this.c.id, outfit: outfitId, prev });
      feed(`${this.c.name} changed into ${outfitId.replace('_', ' ')}.`, 'info');
    }
    return true;
  }
```

  - `deserialize` must tolerate old saves that stored `none` / `underwear`. `change()` already returns false for unknown ids, so the constructor's default outfit stays. No extra code is needed; Task 6's test covers it.

- [ ] **Step 5: Settings and the age gate**
  - `src/core/settings.js`: delete the `confirmed18` and `explicitness` fields.
  - `src/core/app.js`:
    - Delete `globalThis.__ncldExplicitness = settings.explicitness;` (~139).
    - Delete `import { showGate18 }` and the `await showGate18();` + `audio.unlock();` pair, together with the comment above them (~154-160). The `pointerdown` unlock and the post-menu `audio.unlock()` remain.
    - Delete `explicitness: () => settings.explicitness,` from the stage context (~638).
  - Delete `src/ui/gate18.js`, and in `styles/base.css` remove the `.gate-panel` rules and their comment (~294-304).
  - `src/ui/settingsPanel.js`: delete the `EXPLICIT` constant (20), the "CONTENT / Explicitness" row (110-114), and the explicitness sentence in the header (5-10).
  - `src/ui/director/tabSettings.js`: delete the "EXPLICITNESS CAP" section (10-15), its handler (60-67), and the header mention.
  - `src/ui/saveMenu.js:84`: delete the explicitness comment.
  - `src/chars/character.js`: `gateCheck()` reads `__ncldExplicitness`. Leave it for Task 4, which deletes the method.
  - `src/dialogue/engine.js:133`: delete the `__ncldExplicitness` read and pass nothing in its place. Read the surrounding lines first; if the value is only forwarded into a gate check, delete the argument.

- [ ] **Step 6: Tabs, LLM outfits and the smoke test**
  - `src/ui/director/tabCast.js`: remove the `none` / `underwear` outfit buttons (34-35, 81). The button list should come from `wardrobe.available()`; if it's hard-coded, drop the two ids.
  - `src/dialogue/llm/tags.js`:
    - Set `OUTFITS` to `new Set(['street_armor','evening_wear','casual_lounge','workout','swim','sleepwear','robe','towel'])`.
    - Set `COVERAGE_MAP` to `{ full: 'evening_wear', partial: 'towel', robe: 'robe', towel: 'towel' }`.
  - `src/dialogue/llm/promptBuilder.js`: delete the `explicit` / `spice` constants and the `explicitness` ctx JSDoc field. `spice` is still interpolated in the INTIMACY line, which Task 4 rewrites, so for now just remove `${spice}` from that line.
  - `test/smoke/smoke.spec.mjs`:
    - Delete the age-gate step (28-35). The test must go straight to the main menu.
    - Fix the comment at 157.

- [ ] **Step 7: Verify**

Run: `npm test && npm run lint`, then:

```bash
grep -rn "explicitness\|Explicitness\|confirmed18\|__ncldExplicitness\|gate18\|gate-panel\|EXPLICITNESS_CAP" src data tools test styles config index.html
```

Expected: only `src/chars/gates.js`, `src/chars/character.js`, `src/core/types.js`, and the `chars.gates.explicitnessCap` config lines, which Task 4 removes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: drop the explicitness cap, the age gate and undress outfit states"
```

---

### Task 4: Replace the intimacy ladder with the bond tier

**Files:**
- Delete: `src/chars/gates.js`, `test/unit/gates.test.mjs`
- Modify:
  - `src/chars/character.js`, `src/sim/actors/actorQueue.js`
  - `src/dialogue/stageDirections.js`, `src/dialogue/effects.js`, `src/dialogue/selector.js`, `src/dialogue/topics.js`
  - `data/schema.js`, `src/humanoid/pairedPoses.js`, `src/chars/wardrobe.js` (stale import, if still present)
  - `src/ui/statBars.js`, `src/ui/hud.js`, `src/ui/director/tabDialog.js`
  - `styles/hud.css`, `styles/director.css`
  - `src/dialogue/llm/tags.js`, `src/dialogue/llm/promptBuilder.js`, `src/dialogue/llm/agent.js`
  - `src/core/types.js`, `src/core/log.js`, `src/core/app.js` (debug)
  - `data/configDefaults.js`, `data/configSchema.js`, `config/chars.yaml`
  - `data/dialogue/{lola,aria,kai}/core.js`, `data/dialogue/lola/depth.js`, `data/dialogue/kai/depth.js`
  - `tools/lint-data.mjs`, `tools/gameEngine.mjs`
  - `test/unit/{dialogue,llmtags,save,regressions}.test.mjs`
- Test: `test/unit/bond.test.mjs` (extend)

**Interfaces:**
- Consumes: `bondTier`, `bondAtLeast` and `BOND_TIERS` from Task 1.
- Produces:
  - `Character#bond` (getter → `BondTier`)
  - `Character#bondAtLeast(tier) → boolean`
  - `Character#_refreshBond()` → emits `bond.changed { id, name, from, to }`
  - `serialize()` includes `bond`
  - Command field `minBond?: BondTier`
  - Dialogue conditions `bondAtLeast: BondTier` and `bondBelow: BondTier` in line `when` and in topic `cond`

- [ ] **Step 1: Write the failing tests.** Append to `test/unit/bond.test.mjs`:

```js
import { Character } from '../../src/chars/character.js';
import { on, resetBus } from '../../src/core/bus.js';
import * as THREE from 'three';
import lola from '../../data/cast/lola.js';

function stubChar(persona) {
  const actor = { root: { position: new THREE.Vector3() }, setTempo() {}, playClip() {}, setDowned() {},
    face: { setExpression() {} } };
  const queue = { hooks: {}, zone: null, clear() {}, goto() {} };
  return new Character(persona, /** @type {any} */ (actor), /** @type {any} */ (queue));
}

test('Character exposes bond and emits bond.changed once per real crossing', () => {
  resetBus();
  const c = stubChar(lola);
  c.stats.trust = 20; c.stats.loyalty = 20; c._refreshBond(true);
  assert.equal(c.bond, 'stranger');
  const seen = [];
  on('bond.changed', (e) => seen.push(e));
  c.applyStats({ trust: 30, loyalty: 30 }, 'test');     // → ally (unless receptivity dampens; see below)
  c.stats.trust = 40; c.stats.loyalty = 40; c._refreshBond();
  assert.equal(c.bond, 'ally');
  c.stats.trust = 33; c.stats.loyalty = 33; c._refreshBond();   // dip inside hysteresis
  assert.equal(c.bond, 'ally');
  assert.equal(seen.filter((e) => e.to === 'ally').length, 1);
  assert.ok(c.bondAtLeast('ally'));
  assert.ok(!c.bondAtLeast('trusted'));
});

test('serialize carries bond; restore ignores legacy gates/consent', () => {
  const c = stubChar(lola);
  c.stats.trust = 60; c.stats.loyalty = 60; c._refreshBond(true);
  const d = c.serialize();
  assert.equal(d.bond, 'trusted');
  assert.ok(!('gates' in d) && !('consent' in d));
  const c2 = stubChar(lola);
  c2.restore({ ...d, gates: { kiss: 'granted' }, consent: {} });
  assert.equal(c2.bond, 'trusted');
  assert.ok(!('gates' in c2));
});

test('ActorQueue refuses a minBond command the character has not reached', async () => {
  const { ActorQueue } = await import('../../src/sim/actors/actorQueue.js');
  const actor = { id: 'x', root: { position: new THREE.Vector3() } };
  const q = new ActorQueue(/** @type {any} */ (actor), /** @type {any} */ ({}), {
    bondCheck: (tier) => tier === 'ally',
  });
  assert.equal(q.push({ type: 'wait', args: [1], minBond: 'trusted' }), false);
  assert.equal(q.push({ type: 'wait', args: [1], minBond: 'ally' }), true);
  assert.equal(q.push({ type: 'wait', args: [1] }), true);
});
```

- [ ] **Step 2: Run them**

Run: `node --test test/unit/bond.test.mjs`
Expected: FAIL (`c._refreshBond is not a function`)

- [ ] **Step 3: `src/chars/character.js`**
  - Replace the gates import with `import { bondTier, bondAtLeast } from './bond.js';`.
  - Update the header comment: "(stats, bond, memory, mood, wardrobe)".
  - In the constructor:
    - Delete `this.gates = …` and `this.consent = …`.
    - After `this.refreshMood(true);`, add `this._bond = bondTier(this.stats);`.
    - Replace the `queue.hooks.gateCheck = …` line and its comment with:

```js
    // the ActorQueue consults the bond before accepting a minBond-tagged command
    queue.hooks.bondCheck = (tier) => this.bondAtLeast(tier);
```

  - Replace `get topGate()` with:

```js
  /** Relationship tier with the player — derived from trust + loyalty (src/chars/bond.js). */
  get bond() { return this._bond; }

  /** @param {import('./bond.js').BondTier} tier */
  bondAtLeast(tier) { return bondAtLeast(this.stats, tier, this._bond); }

  /**
   * Re-derive the tier after stats move; announce real crossings only.
   * @param {boolean} [silent] set when seeding (constructor / restore)
   */
  _refreshBond(silent = false) {
    const next = bondTier(this.stats, this._bond);
    if (next === this._bond) return;
    const from = this._bond;
    this._bond = next;
    if (!silent) emit('bond.changed', { id: this.id, name: this.name, from, to: next });
  }
```

  - In `applyStats`, after `this.refreshMood();`, add `this._refreshBond();`. Do the same in `tickMinutes`, since decay moves stats too.
  - Delete the `gateCheck()` and `gate()` methods.
  - `serialize()`: replace `gates: this.gates, consent: this.consent,` with `bond: this._bond,`.
  - `restore()`: replace `this.gates = d.gates; this.consent = d.consent;` with:

```js
    // legacy v0.5 saves carry gates/consent from the retired intimacy ladder; ignored
    this._bond = d.bond || undefined;
    this._refreshBond(true);
```

  - Make sure `bondTier(stats, undefined)` is handled. `bondTier` treats a missing `prevTier` as none (held = −1), so this works.

- [ ] **Step 4: `src/sim/actors/actorQueue.js`**
  - Update the header sentence: "Bond-tagged commands (minBond) are checked before acceptance."
  - Typedef: replace `@property {string} [gateTier]` with `@property {string} [minBond]`.
  - Constructor JSDoc hooks: `{ bondCheck?: (tier:string) => boolean }`.
  - In `push`:

```js
    if (cmd.minBond && this.hooks.bondCheck && !this.hooks.bondCheck(cmd.minBond)) {
      emit('actor.refused', { id: this.actor.id, cmd, reason: 'bond' });
      return false;
    }
```

- [ ] **Step 5: Dialogue plumbing**
  - `src/dialogue/stageDirections.js`:
    - Remove `pair` and `gate` from `TAG_TYPES`.
    - Delete the `case 'pair'` and `case 'gate'` branches.
    - Change the `stat` comment example to `[[stat:tension-5]]`.
  - `src/dialogue/effects.js`:
    - Delete the `if (eff.gate) {…}` block.
    - Update the header: "stat deltas, flags, memory, tone side-effects".
  - In both `src/dialogue/selector.js` `whenOk` and `src/dialogue/topics.js` `condOk` (the function containing `cond.gateAtLeast`), replace the `gateAtLeast` block with:

```js
  if (when.bondAtLeast && !char.bondAtLeast(when.bondAtLeast)) return false;
  if (when.bondBelow && char.bondAtLeast(when.bondBelow)) return false;
```

    In `topics.js`, use `cond.` instead of `when.`.
  - `data/schema.js`:
    - Delete the `GATE_LADDER` import and `GATE_SET`, and the `if (def.effects.gate)` assertion.
    - Import `BOND_TIERS` from `../src/chars/bond.js` and add the validation below to `topic()` for `def.cond` and each line's `when`, calling `assertBond(def.cond, `topic ${id} cond`)` and `assertBond(ln.when, `topic ${id} line.when`)`.

```js
const BOND_SET = new Set(BOND_TIERS);
/** @param {any} c @param {string} where */
function assertBond(c, where) {
  if (!c) return;
  for (const k of ['bondAtLeast', 'bondBelow']) {
    if (c[k] != null) assert(BOND_SET.has(c[k]), `${where}.${k} must be one of ${BOND_TIERS.join('|')}`);
  }
}
```

  - `src/humanoid/pairedPoses.js`: delete `gateTier: 'light_touch'` on `couch_close` (30) and the gate checks (51-55). The pose stays a harmless paired sit.
  - `tools/lint-data.mjs:87`: delete the `[[gate:…]]` validation.

- [ ] **Step 6: Dialogue data.** Rewrite each `gateAtLeast` use:
  - `data/dialogue/aria/core.js`:
    - `aria.core.greet` (30-32): `when: { gateAtLeast: 'kiss' }` becomes `when: { bondAtLeast: 'trusted' }`. Keep the line text if it's non-sexual; otherwise make it a warm "trusted friend" greeting.
    - `aria.flirt.opening` (134): `gateAtLeast` becomes `bondAtLeast: 'ally'`.
  - `data/dialogue/kai/core.js:161` and `data/dialogue/lola/core.js:198`: `gateAtLeast` becomes `bondAtLeast: 'ally'`.
  - `data/dialogue/lola/core.js:220`:
    - Delete `[[gate:offer:light_touch]]` from the `lola.flirt.closer` text.
    - Change its `cond` from `minStat: { arousal: … }` to `bondAtLeast: 'ally'`. The arousal key would fail validation once Task 5 lands, so change it now.
  - Grep `data/` for `gateAtLeast|\[\[gate:|\[\[pair:` and fix every hit the same way.

- [ ] **Step 7: UI**
  - `src/ui/statBars.js`:
    - Delete the `GATE_LADDER` import, `GATE_SHORT`, the pips markup, `updateGates` and the `gate.changed` listener.
    - Add a bond chip. In `addCard`'s header span list add `<span class="sb-bond" data-tier="${character.bond}">${character.bond}</span>`, and add:

```js
  on('bond.changed', ({ id, to }) => {
    const chip = cards.get(id)?.querySelector('.sb-bond');
    if (chip) { chip.textContent = to; chip.dataset.tier = to; }
  });
```

    - Replace the `.sb-gates` and `.sb-pip*` CSS in `styles/hud.css` (134, 146-154) with:

```css
.sb-bond { margin-left: auto; padding: 0 var(--sp-1, 4px); border-radius: var(--radius-sm, 3px);
  font: 600 10px/16px var(--font-ui, sans-serif); text-transform: uppercase; letter-spacing: .06em;
  color: var(--ink-dim, #9aa3b5); border: 1px solid currentColor; }
.sb-bond[data-tier="ally"] { color: var(--cyan, #39e6ff); }
.sb-bond[data-tier="trusted"] { color: var(--amber, #ffb43f); }
.sb-bond[data-tier="loyal"] { color: var(--magenta, #ff3fa4); }
```

    Before using them, check the token names in `styles/base.css`; the fallbacks keep this working if a name differs.
  - `src/ui/hud.js`: subscribe to `bond.changed`. On a rise (`BOND_TIERS.indexOf(to) > BOND_TIERS.indexOf(from)`), emit a `hud.alert`. Use the existing alert path, which is the same bus call `app.js` uses.

```js
  on('bond.changed', ({ name, from, to }) => {
    if (BOND_TIERS.indexOf(to) <= BOND_TIERS.indexOf(from)) return;   // losses show on the rail, not as a toast
    const first = String(name).split(' ')[0];
    const text = { ally: `${first} is on your side now.`, trusted: `${first} trusts you.`, loyal: `${first} would follow you anywhere.` }[to];
    if (text) emit('hud.alert', { text, kind: 'info' });
  });
```

  - `src/ui/director/tabDialog.js`:
    - Delete the gates import and the "CONSENT / GATES" rows (25-30, 60-69).
    - Render one read-only line: `BOND: ${c.bond} (score ${Math.round(bondScore(c.stats))})`.
    - Delete `.td-gaterow` from `styles/director.css` (34-35).

- [ ] **Step 8: LLM**
  - `src/dialogue/llm/tags.js`:
    - Delete `GATE_TIERS` and the `consent` and `gate` cases in `canonTag`. They fall to `default: return ''`, which drops them.
    - Remove `gate` from the keep-list regex in `sanitizeTags`: `(move|anim|face|mood|look|stat|outfit|light)`.
    - In `mapStructuredTags`, delete the `offer_gate` line.
    - Update the header paragraph "Gates stay authoritative…" to: "The model can shift its own stats but never the player's bond directly."
  - `src/dialogue/llm/promptBuilder.js`:
    - Delete `GATE_ORDER` and `describeGates`.
    - In `TAG_SHEET`, delete the `[[gate:offer:TIER]]` line.
    - Replace the `INTIMACY:` part with:

```js
    `YOUR BOND WITH THE GUEST: ${char.bond || 'stranger'} (stranger → ally → trusted → loyal). Let it colour how much you share and how far you'd go for them.`,
```

  - `src/dialogue/llm/agent.js:70`:
    - The "heated" condition becomes `char.stats.tension >= 60 || !!ctx.combat?.active`.
    - Update the comment at :8.
  - `tools/gameEngine.mjs`: delete `GATES` (25), the `offer_gate` schema field (35) and the extraction-prompt rule that mentions gates (71-72).

- [ ] **Step 9: Types, log, config, debug**
  - `src/core/types.js`:
    - Delete `GateTier`, `GateState` and `Explicitness`.
    - Rename the command field `gateTier` to `minBond`.
    - Add `/** @typedef {'stranger'|'ally'|'trusted'|'loyal'} BondTier */`.
  - `src/core/log.js:16`: rename the `'gate'` feed kind to `'bond'`, and update any CSS class keyed on it (grep `feed-gate` / `.gate` in `styles/`).
  - Delete `gates: {…}` from the `chars` groups of `data/configDefaults.js`, `data/configSchema.js` and `config/chars.yaml`, and update the yaml header comment: "stat coupling/decay/compliance + bond thresholds. Note: the stat KEYS and bond tier ORDER are structural (code)".
  - `src/core/app.js` `_exposeDebug`:
    - Delete `gate:` and `pair:`, and the `startPairedPose` import if it's now unused.
    - Add `bond: (id) => this.cast[id]?.bond,`.

- [ ] **Step 10: Delete the gates module, fix tests**

```bash
git rm src/chars/gates.js test/unit/gates.test.mjs
```

  - `test/unit/dialogue.test.mjs` 47 and 51: replace the `gate` tag compile cases with an assertion that `compileLine('[[gate:offer:kiss]] hi')` **throws** (unknown tag).
  - `test/unit/llmtags.test.mjs` 35-39: assert that `sanitizeTags('hi [[consent:kiss]] [[gate:offer:kiss]]')` returns `'hi'`.
  - `test/unit/save.test.mjs` 102-103, 119, 147-148, 162: replace the gates round-trip assertions with `assert.equal(restored.bond, original.bond)`.
  - `test/unit/regressions.test.mjs:19`: delete the `GATE_LADDER` import and any test that still uses it.

- [ ] **Step 11: Verify**

Run: `npm test && npm run lint`, then:

```bash
grep -rn "gateCheck\|gateTier\|GATE_LADDER\|topGate\|gate\.changed\|\.gates\b\|consent\|gateAtLeast\|offer_gate\|\[\[gate\|\[\[pair" src data tools test styles config
```

Expected: no output. The word "consent" may legitimately appear in cookie or privacy text; there should be none, so investigate any hit.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(chars): the bond tier replaces the intimacy ladder end to end"
```

---

### Task 5: Stat model 12 → 9

**Files:**
- Modify:
  - `src/chars/stats.js`, `src/chars/mood.js`, `src/core/types.js`
  - `data/configDefaults.js`, `data/configSchema.js`, `config/chars.yaml`
  - `data/cast/{aria,kai,lola,refugee,vox}.js`, `data/scenarios.js`, `data/dialogue/**/*.js`
  - `src/dialogue/effects.js`, `src/dialogue/engine.js`, `src/sim/ai/actionCatalog.js`, `src/games/gambits.js`
  - `src/dialogue/llm/{tags,promptBuilder}.js`, `tools/gameEngine.mjs`
  - `src/ui/director/tabCast.js`, `src/ui/statBars.js`
  - Comments in `src/humanoid/{actor3d,animator,clips}.js` and `data/poses/base.js`
  - `test/unit/{stats,mood,llmtags}.test.mjs`

**Interfaces:**
- Produces: `STAT_KEYS` holds exactly the 9 keys in Global Constraints; `animTempo(stats)` reads `energy` and `tension`.

- [ ] **Step 1: Update the tests first**
  - `test/unit/stats.test.mjs`:
    - Rename the first test to `'defaultStats has all 9 keys in range'` with `assert.equal(Object.keys(s).length, 9);`.
    - Replace the `'coupling: high tension suppresses arousal gains'` test with:

```js
test('coupling: high tension suppresses trust gains', () => {
  const calm = defaultStats(); calm.tension = 0;
  const tense = defaultStats(); tense.tension = 90;
  assert.ok(couplingFactor(tense, 'trust', +10) < couplingFactor(calm, 'trust', +10));
});

test('the retired intimacy stats are gone', () => {
  for (const k of ['arousal', 'pleasure', 'horniness']) assert.ok(!STAT_KEYS.includes(/** @type {any} */ (k)));
});
```

    - Delete any other arousal/pleasure coupling tests (~48-54, 62-68).
  - `test/unit/mood.test.mjs`:
    - Delete the `sultry` tests (17-20).
    - Rewrite the `animTempo` test (29-33) as:

```js
test('animTempo: energy speeds up, tension tightens', () => {
  const base = { ...defaultStats(), energy: 50, tension: 20 };
  assert.ok(animTempo({ ...base, energy: 95 }) > animTempo(base));
  assert.ok(animTempo({ ...base, energy: 5 }) < animTempo(base));
  const t = animTempo({ ...base, energy: 100, tension: 100 });
  assert.ok(t >= 0.7 && t <= 1.6);
});
```

    If `defaultStats` isn't imported in that file, add the import from `../../src/chars/stats.js`.
  - `test/unit/llmtags.test.mjs` 8-12: the arousal stat-tag case becomes `sanitizeTags('x [[stat:tension+5]]')` → contains `[[stat:tension+5]]`, and `sanitizeTags('x [[stat:arousal+5]]')` → `'x'`.

- [ ] **Step 2: Run them**

Run: `node --test test/unit/stats.test.mjs test/unit/mood.test.mjs test/unit/llmtags.test.mjs`
Expected: FAIL (length 12 ≠ 9, etc.)

- [ ] **Step 3: `src/chars/stats.js`**
  - Header: "PURE 9-stat model"; the coupling example becomes "(e.g. high tension suppresses trust gain)".

```js
export const STAT_KEYS = /** @type {StatKey[]} */ ([
  'happiness', 'openness', 'dominance', 'trust', 'tension', 'energy', 'sobriety', 'loyalty', 'fear',
]);
```

  - In `couplingFactor`, delete the `case 'arousal': case 'horniness':` block and the `case 'pleasure':` block.
  - `decayTick` doc: "Tension and fear bleed off; energy recovers slowly; sobriety returns."

- [ ] **Step 4: Config**
  - `data/configDefaults.js`, `chars`:

```js
    startStats: {   // defaultStats() baseline before persona overrides
      happiness: 50, openness: 30, dominance: 50,
      trust: 20, tension: 25, energy: 75, sobriety: 100, loyalty: 10, fear: 5,
    },
    coupling: {     // cross-stat gain modifiers (src/chars/stats.js couplingFactor)
      intoxOpen: 0.5,         // intoxication amplifies openness gain
      fearClose: 0.4,         // fear suppresses openness gain
      tensionTrust: 0.4,      // tension suppresses trust gain
      fearTension: 0.35,      // fear amplifies tension gain
    },
    decay: {        // passive homeostatic regression (decayTick)
      rest: { tension: 22, fear: 4 },
      rate: { tension: 0.25, fear: 0.4 },
      approachFactor: 0.3,
      sobrietyRegain: 0.35,
    },
```

    Also update the group comment to "stat model coupling/decay/compliance + bond".
  - `data/configSchema.js` `chars.coupling`: `{ intoxOpen: num(0, 2), fearClose: num(0, 2), tensionTrust: num(0, 2), fearTension: num(0, 2) }`.
  - `config/chars.yaml`: mirror the same three blocks, deleting the arousal/pleasure/horniness lines and the four removed coupling keys.

- [ ] **Step 5: `src/chars/mood.js`**
  - Delete the `sultry` entry. A `warm` mood already exists and covers "high happiness + trust"; this is the spec's "sultry → warm".
  - In `exhausted`, change the score to `(100 - s.energy) * 0.6`.
  - Replace `animTempo`:

```js
/**
 * Tempo scalar for animation. 0.7 (drained) .. 1.6 (wired): energy drives it,
 * tension adds a clipped edge.
 * @param {Record<StatKey, number>} stats
 */
export function animTempo(stats) {
  const energy = stats.energy / 100, tension = stats.tension / 100;
  return Math.min(1.6, 0.7 + energy * 0.6 + tension * 0.3);
}
```

- [ ] **Step 6: Data (every `arousal` / `pleasure` / `horniness` key)**

```bash
grep -rln "arousal\|pleasure\|horniness" data src tools config
```

For each hit:
  - **Cast base stats and receptivity** (`data/cast/*.js`): delete the three keys.
  - **Dialogue `fx` maps:** delete the three keys. If an `fx` loses all its keys, replace it with a sensible non-sexual effect: flirting lines use `{ happiness: 2, trust: 1 }`, and whisper-type lines use `{ trust: 1 }`.
  - **`cond` / `when` using arousal** (e.g. `lola/core.js` 55-57 `statGte arousal`, and `lola.conflict.command` 271-281): change to `statGte: { trust: <same number> }`, or `bondAtLeast: 'ally'` where the intent was "into you".
  - **`data/scenarios.js`:** in `last_night` (145-153), delete the arousal `castMoodShifts` entries, keeping any other keys.
  - **`src/dialogue/effects.js` tone bleed:**

```js
    if (tn.flirt > 0.2) { bleed.happiness = (bleed.happiness || 0) + tn.flirt * 2; bleed.trust = (bleed.trust || 0) + tn.flirt * 1; }
```

  - **`src/dialogue/engine.js:72`:** whisper `arousal: +1` becomes `trust: +1`.
  - **`src/sim/ai/actionCatalog.js` `dance` (85-95):** replace any arousal term in `score` with `n.fun * 0.9`, and change `statFx` arousal to `happiness`.
  - **`src/games/gambits.js` 33, 45, 51:** change `targetFx` arousal to `openness` for the charm-type gambits, or `happiness`. Keep the magnitudes.
  - **`src/dialogue/llm/tags.js`:**
    - `STATS` becomes `new Set(['happiness','openness','dominance','trust','tension','energy','sobriety','loyalty','fear'])`.
    - In `FACE_ALIAS`, change `seductive` and `sultry` to `tease: 'smirk'` only (delete those two keys).
    - In `mapStructuredTags`, delete the `arousal_delta` line.
  - **`src/dialogue/llm/promptBuilder.js`:**
    - `describeState`: delete the `hi('arousal'…)` and `hi('horniness'…)` calls.
    - `TAG_SHEET`: change the mood line to `flirty, tense, playful, warm, cold, afraid`, and the stat example to `[[stat:trust+5]] [[stat:tension-5]]`.
  - **`tools/gameEngine.mjs`:** remove `sultry` from `MOODS` (24) and the `arousal_delta` schema field (33).
  - **`src/ui/director/tabCast.js:9` and `src/ui/statBars.js`:** delete the three colour entries. In `statBars`, set `HERO = ['trust', 'loyalty', 'tension', 'fear']` and delete the three `STAT_LABEL` entries.
  - **Comments only:** `src/humanoid/actor3d.js:87`, `animator.js:53`, `clips.js:16` and `data/poses/base.js:168` — change the arousal wording to "energy/tension".
  - **`src/core/types.js` `StatKey`:** the 9 keys.

- [ ] **Step 7: Verify**

Run: `npm test && npm run lint`

```bash
grep -rn "arousal\|horniness\|sultry" src data tools config test
grep -rn "pleasure" src data tools config test
```

Expected: the first grep returns nothing. The second may only return non-stat English prose (e.g. "a pleasure to meet you"); read each hit.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(chars): the stat model drops arousal, pleasure and horniness (12 → 9)"
```

---

### Task 6: Save format v2 with migration

**Files:**
- Modify: `src/core/save.js`
- Test: `test/unit/save.test.mjs`

**Interfaces:**
- Produces: `VERSION = 2`; `migrate(v1) → v2` drops `gates` / `consent`, filters stats to `STAT_KEYS`, and strips wardrobe `none` / `underwear`.

- [ ] **Step 1: Write the failing test** (append to `test/unit/save.test.mjs`, reusing its `makeApp`)

```js
test('a v0.5 (version 1) save with retired intimacy state migrates and loads', () => {
  const app = makeApp();
  const v2 = buildSave(app);
  const legacy = JSON.parse(JSON.stringify(v2));
  legacy.version = 1;
  for (const c of Object.values(legacy.characters)) {
    c.stats = { ...c.stats, arousal: 70, pleasure: 40, horniness: 55 };
    c.gates = { light_touch: 'granted', kiss: 'offered' };
    c.consent = { ladder: {}, withdrawn: false, safeword: false };
    c.wardrobe = { current: 'none' };
    delete c.bond;
  }
  const m = migrate(legacy);
  assert.equal(m.version, 2);
  for (const c of Object.values(m.characters)) {
    assert.ok(!('gates' in c) && !('consent' in c));
    assert.ok(!('arousal' in c.stats) && !('pleasure' in c.stats) && !('horniness' in c.stats));
    assert.equal(c.wardrobe, undefined);
  }
  assert.doesNotThrow(() => applySave(app, legacy));
  assert.equal(Object.keys(app.cast.lola.stats).length, 9);
  assert.ok(app.cast.lola.bond);
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/unit/save.test.mjs`
Expected: FAIL (`m.version` is 1)

- [ ] **Step 3: Implement.** In `src/core/save.js`:
  - Header: "characters (stats/bond/memory/position/wardrobe/brain)".
  - Add `import { STAT_KEYS } from '../chars/stats.js';` at the top.
  - Set `const VERSION = 2;`.
  - Replace `migrate`:

```js
/** outfit states retired with the v0.6 content cleanse */
const RETIRED_OUTFITS = new Set(['none', 'underwear']);

/**
 * Migrate an older save envelope forward to the current VERSION. Each case
 * upgrades v→v+1. Unknown-shaped saves fail loudly in applySave.
 * @param {any} save
 */
export function migrate(save) {
  const s = save;
  while (s && s.version < VERSION) {
    switch (s.version) {
      case 1: {
        // v0.6 retired the intimacy ladder and three stats. Old runs keep
        // everything else; the bond tier re-derives from trust + loyalty.
        for (const c of Object.values(s.characters || {})) {
          delete c.gates;
          delete c.consent;
          if (c.stats) c.stats = Object.fromEntries(Object.entries(c.stats).filter(([k]) => STAT_KEYS.includes(/** @type {any} */ (k))));
          if (c.wardrobe && RETIRED_OUTFITS.has(c.wardrobe.current)) delete c.wardrobe;
        }
        s.version = 2;
        break;
      }
      default:
        return s;   // unknown version: applySave rejects it
    }
  }
  return s;
}
```

  - Grep `save.js` for `parseSaveEnvelope` / `importSave` version checks, and make sure they call `migrate` before comparing against `VERSION`.

- [ ] **Step 4: Run the tests**

Run: `node --test test/unit/save.test.mjs && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/save.js test/unit/save.test.mjs
git commit -m "feat(save): format v2 migrates v0.5 saves past the retired intimacy state"
```

---

### Task 7: Bed interactions (sit, lie, invite, stay the night)

**Files:**
- Create: `src/sim/bedScene.js`, `data/dialogue/bed.js`, `test/unit/bedscene.test.mjs`
- Modify:
  - `src/sim/scheduler.js`, `src/scene3d/tower/furniture.js`, `src/scene3d/tower/zoneBuilder.js`
  - `src/camera/firstPerson.js`, `src/core/app.js`
  - `src/dialogue/effects.js`, `data/schema.js`
  - `src/sim/ai/actionCatalog.js`, `styles/hud.css`
  - `test/unit/regressions.test.mjs` (socket test), `test/unit/scheduler.test.mjs`

**Interfaces:**
- Consumes: `Character#bondAtLeast`, `ActorQueue#sit/stand/clear`, `ActorQueue#seatedAt`.
- Produces:
  - `BedScene` with `playerState: 'none'|'sitting'|'lying'`, `guests: string[]`, `busy: boolean`, and methods `use()`, `getUp()`, `invite(char)`, `dismiss(char)`, `dismissAll()`, `stayNight(char): Promise<{ok, reason?}>`.
  - `bedPrompt(state) → string`
  - `GUEST_SEAT = 'bed.seat1'`, `STAY_MINUTES = 180`
  - Bus events:
    - `bedscene.state {player}`
    - `bedscene.guest {id, seated}`
    - `bedscene.started {id}` / `bedscene.ended {id}`
    - `bed.requested {action:'invite'|'stay'|'dismiss', charId}`
  - `Scheduler#hold: boolean`
  - `data/dialogue/bed.js` exports `BED_NARRATION: Record<string, string[]>` and `narrationFor(charId, rng?) → string`.

- [ ] **Step 1: Write the failing test** `test/unit/bedscene.test.mjs`

```js
// @ts-check
// src/sim/bedScene.js — the bed as furniture. No animation beyond sitting and
// reclining; "stay the night" is a fade, one narration line and a time skip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BedScene, bedPrompt, STAY_MINUTES, GUEST_SEAT } from '../../src/sim/bedScene.js';
import { Scheduler } from '../../src/sim/scheduler.js';
import { newRunState } from '../../src/sim/world.js';
import { resetBus, on } from '../../src/core/bus.js';

function fakeChar(id, tier) {
  const order = ['stranger', 'ally', 'trusted', 'loyal'];
  return {
    id, name: id, alive: true, stats: { happiness: 50, loyalty: 50, tension: 50, trust: 50 },
    bondAtLeast: (t) => order.indexOf(tier) >= order.indexOf(t),
    applied: [], applyStats(d, why) { this.applied.push([d, why]); },
    queue: { log: [], clear() { this.log.push('clear'); }, sit(s) { this.log.push(`sit:${s}`); }, stand() { this.log.push('stand'); } },
  };
}

function ports(over = {}) {
  const calls = { placed: [], released: 0, skipped: 0, fades: [], narrated: [] };
  const player = { morale: 50 };
  const needs = { rest: 80 };
  const scheduler = { hold: false, heldDuringSkip: null };
  const p = {
    placePlayer: (pose) => calls.placed.push(pose),
    releasePlayer: () => { calls.released++; },
    skip: (m) => { calls.skipped += m; scheduler.heldDuringSkip = scheduler.hold; },
    scheduler,
    fade: async (on) => { calls.fades.push(on); },
    narrate: async (t) => { calls.narrated.push(t); },
    narration: (id) => `narration for ${id}`,
    player: () => player,
    brain: () => ({ needs }),
    ...over,
  };
  return { p, calls, player, needs, scheduler };
}

test('prompt text follows the player state', () => {
  assert.equal(bedPrompt('none'), 'Sit on the bed');
  assert.equal(bedPrompt('sitting'), 'Lie down');
  assert.equal(bedPrompt('lying'), 'Get up');
});

test('E cycles sit → lie → get up', () => {
  resetBus();
  const { p, calls } = ports();
  const b = new BedScene(p);
  assert.equal(b.use(), 'sitting');
  assert.equal(b.use(), 'lying');
  assert.equal(b.use(), 'none');
  assert.deepEqual(calls.placed, ['sitting', 'lying']);
  assert.equal(calls.released, 1);
});

test('getUp from sitting releases the player and stands guests up', () => {
  resetBus();
  const { p, calls } = ports();
  const b = new BedScene(p);
  const kai = fakeChar('kai', 'ally');
  b.use();
  b.invite(kai);
  b.getUp();
  assert.equal(b.playerState, 'none');
  assert.equal(calls.released, 1);
  assert.deepEqual(b.guests, []);
  assert.ok(kai.queue.log.includes('stand'));
});

test('invite: a stranger refuses; an ally sits beside you and warms a little', () => {
  resetBus();
  const { p } = ports();
  const b = new BedScene(p);
  const lola = fakeChar('lola', 'stranger');
  assert.deepEqual(b.invite(lola), { ok: false, reason: 'bond' });
  assert.equal(lola.queue.log.length, 0);

  const aria = fakeChar('aria', 'ally');
  const events = [];
  on('bedscene.guest', (e) => events.push(e));
  assert.deepEqual(b.invite(aria), { ok: true });
  assert.ok(aria.queue.log.includes(`sit:${GUEST_SEAT}`));
  assert.deepEqual(aria.applied[0][0], { trust: 3, tension: -5 });
  assert.deepEqual(events, [{ id: 'aria', seated: true }]);
  assert.deepEqual(b.invite(aria), { ok: true, reason: 'already' });
});

test('only one guest seat: a second invite is turned away as full', () => {
  resetBus();
  const b = new BedScene(ports().p);
  b.invite(fakeChar('aria', 'ally'));
  assert.deepEqual(b.invite(fakeChar('kai', 'ally')), { ok: false, reason: 'full' });
});

test('stay the night needs trusted', async () => {
  resetBus();
  const b = new BedScene(ports().p);
  assert.deepEqual(await b.stayNight(fakeChar('kai', 'ally')), { ok: false, reason: 'bond' });
});

test('stay the night: fade, narrate, skip 180 min with the scheduler held, then rested', async () => {
  resetBus();
  const { p, calls, player, needs, scheduler } = ports();
  const b = new BedScene(p);
  const aria = fakeChar('aria', 'trusted');
  const seen = [];
  on('bedscene.started', () => seen.push('started'));
  on('bedscene.ended', () => seen.push('ended'));
  const res = await b.stayNight(aria);
  assert.deepEqual(res, { ok: true });
  assert.equal(calls.skipped, STAY_MINUTES);
  assert.equal(scheduler.heldDuringSkip, true, 'no event may fire during the skip');
  assert.equal(scheduler.hold, false, 'released afterwards');
  assert.deepEqual(calls.fades, [true, false]);
  assert.deepEqual(calls.narrated, ['narration for aria']);
  assert.equal(needs.rest, 0);
  assert.equal(player.morale, 60);
  assert.ok(aria.applied.some(([d]) => d.happiness === 8 && d.loyalty === 5 && d.tension === -10));
  assert.deepEqual(seen, ['started', 'ended']);
  assert.equal(b.playerState, 'lying');
  assert.equal(b.busy, false);
});

test('stay the night always releases the scheduler, even if a port throws', async () => {
  resetBus();
  const { p, scheduler } = ports({ skip: () => { throw new Error('boom'); } });
  const b = new BedScene(p);
  await assert.rejects(b.stayNight(fakeChar('aria', 'trusted')));
  assert.equal(scheduler.hold, false);
  assert.equal(b.busy, false);
});

test('Scheduler.hold suppresses both queued and rolled events', () => {
  const s = new Scheduler(/** @type {any} */ ({ chance: () => true, weighted: (a) => a[0] }));
  const run = newRunState();
  run.eventQueue.push({ atMinute: 0, eventId: 'x' });
  s.hold = true;
  assert.equal(s.tick(run, { day: 1, minuteOfDay: 0, phase: 'night', totalMinutes: 10 }), null);
  s.hold = false;
  assert.equal(s.tick(run, { day: 1, minuteOfDay: 0, phase: 'night', totalMinutes: 10 }), 'x');
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/unit/bedscene.test.mjs`
Expected: FAIL, the module is not found.

- [ ] **Step 3: `Scheduler.hold`.** In `src/sim/scheduler.js`:
  - Add `this.hold = false;` to the constructor, with the comment `// set while the clock is skipped under a fade (bed scene) — nothing fires unseen`.
  - Make this the first line of `tick`: `if (this.hold) return null;`.

- [ ] **Step 4: Implement** `src/sim/bedScene.js`

```js
// @ts-check
// The bed as ordinary furniture. The player can sit, lie down and get up; a
// character the player has become an ally of will come and sit beside them;
// one who trusts them can be asked to stay the night — the only implied moment
// in the game, and it is exactly that: a fade to black, one line of narration,
// three hours passing, and both of you waking rested. No animation beyond
// sitting and reclining, no explicit text.
//
// Pure over injected ports (camera placement, clock skip, fades, narration) so
// the whole state machine runs under node --test; src/core/app.js wires them.
import { emit } from '../core/bus.js';

/** The guest's side of the mattress (src/scene3d/tower/furniture.js bed()). */
export const GUEST_SEAT = 'bed.seat1';
/** How long "stay the night" skips, in game minutes. */
export const STAY_MINUTES = 180;

/** @typedef {'none'|'sitting'|'lying'} PlayerBedState */

/** @param {PlayerBedState} s */
export function bedPrompt(s) {
  return s === 'none' ? 'Sit on the bed' : s === 'sitting' ? 'Lie down' : 'Get up';
}

export class BedScene {
  /**
   * @param {{
   *   placePlayer: (pose: 'sitting'|'lying') => void,
   *   releasePlayer: () => void,
   *   skip: (minutes: number) => void,
   *   scheduler: { hold: boolean },
   *   fade: (on: boolean) => Promise<void>,
   *   narrate: (text: string) => Promise<void>,
   *   narration: (charId: string) => string,
   *   player: () => { morale: number },
   *   brain: (charId: string) => ({ needs: Record<string, number> } | undefined),
   * }} ports
   */
  constructor(ports) {
    this.p = ports;
    /** @type {PlayerBedState} */
    this.playerState = 'none';
    /** @type {string[]} ids of characters sitting on the bed at the player's invitation */
    this.guests = [];
    /** true while the stay-the-night fade runs; input is ignored until it ends */
    this.busy = false;
    /** @type {Map<string, any>} */
    this._guestChars = new Map();
  }

  /** E on the bed: sit → lie down → get up. @returns {PlayerBedState} */
  use() {
    if (this.busy) return this.playerState;
    if (this.playerState === 'none') this._setPlayer('sitting');
    else if (this.playerState === 'sitting') this._setPlayer('lying');
    else this.getUp();
    return this.playerState;
  }

  /** Leave the bed (E while lying, or any movement key). Guests get up too. */
  getUp() {
    if (this.busy || this.playerState === 'none') return;
    this.playerState = 'none';
    this.p.releasePlayer();
    this.dismissAll();
    emit('bedscene.state', { player: 'none' });
  }

  /**
   * Ask a character to come and sit on the bed.
   * @param {any} char a Character (duck-typed: id, alive, bondAtLeast, applyStats, queue)
   * @returns {{ok: boolean, reason?: string}}
   */
  invite(char) {
    if (!char || !char.alive) return { ok: false, reason: 'absent' };
    if (!char.bondAtLeast('ally')) return { ok: false, reason: 'bond' };
    if (this.guests.includes(char.id)) return { ok: true, reason: 'already' };
    if (this.guests.length) return { ok: false, reason: 'full' };
    char.queue.clear();
    char.queue.sit(GUEST_SEAT);
    char.applyStats({ trust: 3, tension: -5 }, 'bed:sit');
    this.guests.push(char.id);
    this._guestChars.set(char.id, char);
    emit('bedscene.guest', { id: char.id, seated: true });
    return { ok: true };
  }

  /** @param {any} char */
  dismiss(char) {
    if (!char || !this.guests.includes(char.id)) return;
    this.guests = this.guests.filter((id) => id !== char.id);
    this._guestChars.delete(char.id);
    char.queue.clear();
    char.queue.stand();
    emit('bedscene.guest', { id: char.id, seated: false });
  }

  dismissAll() {
    for (const c of [...this._guestChars.values()]) this.dismiss(c);
  }

  /**
   * The one implied moment. Requires a trusted bond; seats the character first
   * if they aren't already. The scheduler is held for the whole skip so no event
   * can fire while the screen is black, and is released even if a port throws.
   * @param {any} char
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async stayNight(char) {
    if (this.busy) return { ok: false, reason: 'busy' };
    if (!char || !char.alive) return { ok: false, reason: 'absent' };
    if (!char.bondAtLeast('trusted')) return { ok: false, reason: 'bond' };
    if (!this.guests.includes(char.id)) {
      const r = this.invite(char);
      if (!r.ok) return r;
    }
    this.busy = true;
    emit('bedscene.started', { id: char.id });
    try {
      await this.p.fade(true);
      this.p.scheduler.hold = true;
      if (this.playerState !== 'lying') this._setPlayer('lying');
      await this.p.narrate(this.p.narration(char.id));
      this.p.skip(STAY_MINUTES);
      const brain = this.p.brain(char.id);
      if (brain) brain.needs.rest = 0;
      char.applyStats({ happiness: 8, loyalty: 5, tension: -10 }, 'bed:stay');
      const pl = this.p.player();
      pl.morale = Math.min(100, (pl.morale ?? 50) + 10);
    } finally {
      this.p.scheduler.hold = false;
      this.busy = false;
      await this.p.fade(false);
      emit('bedscene.ended', { id: char.id });
    }
    return { ok: true };
  }

  /** @param {'sitting'|'lying'} s */
  _setPlayer(s) {
    this.playerState = s;
    this.p.placePlayer(s);
    emit('bedscene.state', { player: s });
  }
}
```

Note: `busy` is cleared before the final `await fade(false)`, so the "releases even if a port throws" test observes `busy === false` after rejection. The test expects `fades` to equal `[true, false]` on success, which this satisfies.

- [ ] **Step 5: Run the test**

Run: `node --test test/unit/bedscene.test.mjs`
Expected: PASS

- [ ] **Step 6: Second guest seat.** In `src/scene3d/tower/furniture.js` `bed()`, add a guest seat on the opposite side of the mattress edge from `seat0`:

```js
        seat0: socket(group, 'seat0', 0.7, 0.5, 0.85, Math.PI),
        seat1: socket(group, 'seat1', -0.7, 0.5, 0.85, Math.PI),   // guest side (src/sim/bedScene.js)
```

Extend the kept seat/lie socket test in `test/unit/regressions.test.mjs` so it also asserts that `seat1` exists and that `seatClip('bed.seat1') === 'sit_relaxed'`.

- [ ] **Step 7: Dialogue data** `data/dialogue/bed.js`

```js
// @ts-check
// Inviting someone to the bed. Being turned down is a real answer, so every
// topic has a refusal line gated on the bond instead of a topic `cond` (a topic
// that silently fails to match reads as the parser not understanding you).
// The `bed` field on a line — not the topic — asks src/sim/bedScene.js to act,
// so a refusal can never seat anyone.
import { topic, onIntent } from '../schema.js';
import { registerTopics } from '../../src/dialogue/topics.js';
import { registerIntents } from '../../src/dialogue/parser/intents.js';

registerIntents([
  { id: 'bed_invite', keywords: ['bed'],
    phrases: ['come sit', 'sit with me', 'join me', 'come here', 'sit on the bed', 'come to bed'], base: 0.6 },
  { id: 'bed_stay', keywords: ['tonight'],
    phrases: ['stay the night', 'stay with me', 'stay tonight', 'dont go', "don't go"], base: 0.65 },
  { id: 'bed_dismiss', keywords: [],
    phrases: ['you can go', 'goodnight', 'get some rest', 'leave me be'], base: 0.55 },
]);

/** One narration line per stay, per character. Implied, never described. */
export const BED_NARRATION = {
  lola: [
    'Lola keeps one hand near her knife even asleep. Tonight, the other stays in yours.',
    'The sirens go on without you. Lola doesn\'t say a word, and doesn\'t need to.',
  ],
  aria: [
    'Aria talks until she doesn\'t. The city hums. For a few hours, neither of you is alone.',
    'Somewhere below, the riot burns itself out. Aria\'s breathing slows beside you.',
  ],
  kai: [
    'Kai counts the drones until he loses count. The dark is kinder than it was.',
    'Rain on the glass. Kai\'s shoulder against yours. Three hours pass like one.',
  ],
  _default: ['The city hums on. For a few hours, neither of you is alone.'],
};

/** @param {string} charId @param {{pick?: (arr: string[]) => string}} [rng] */
export function narrationFor(charId, rng) {
  const pool = BED_NARRATION[charId] || BED_NARRATION._default;
  return rng?.pick ? rng.pick(pool) : pool[0];
}

/** @param {string} char @param {{invite: string, invitePlus: string, refuse: string, stay: string, stayRefuse: string, bye: string}} t */
const bedTopics = (char, t) => [
  topic(`${char}.bed.invite`, {
    char, priority: 7, cooldownMin: 5,
    triggers: [onIntent('bed_invite', 0.45)],
    lines: [
      { when: { bondBelow: 'ally' }, text: t.refuse, fx: { tension: 1 } },
      { when: { bondAtLeast: 'trusted' }, text: t.invitePlus, bed: 'invite' },
      { when: { bondAtLeast: 'ally' }, text: t.invite, bed: 'invite' },
    ],
    branches: [{ chip: 'Stay the night?', goto: `${char}.bed.stay`, intents: ['bed_stay'] }],
  }),
  topic(`${char}.bed.stay`, {
    char, priority: 8, cooldownMin: 60,
    triggers: [onIntent('bed_stay', 0.45)],
    lines: [
      { when: { bondBelow: 'trusted' }, text: t.stayRefuse, fx: { tension: 1 } },
      { when: { bondAtLeast: 'trusted' }, text: t.stay, bed: 'stay' },
    ],
  }),
  topic(`${char}.bed.dismiss`, {
    char, priority: 5, cooldownMin: 1,
    triggers: [onIntent('bed_dismiss', 0.45)],
    lines: [{ text: t.bye, bed: 'dismiss' }],
  }),
];

registerTopics([
  ...bedTopics('lola', {
    refuse: "[[face:neutral]] [[look:player]] I sit where I can see the door. That isn't there.",
    invite: "[[look:player]] Fine. Five minutes. Don't make it strange.",
    invitePlus: "[[face:smirk]] [[look:player]] Move over. You're hogging the good side.",
    stayRefuse: "[[face:neutral]] Ask me that when you've earned it.",
    stay: "[[look:player]] [[beat:0.6]] ...Fine. But I'm sleeping with my boots on.",
    bye: "[[look:player]] Try to sleep. One of us should.",
  }),
  ...bedTopics('aria', {
    refuse: "[[face:frown]] I— no. Not yet. Sorry.",
    invite: "[[face:smile]] [[look:player]] Okay. Yes. It's quieter over there anyway.",
    invitePlus: "[[face:smile]] [[look:player]] I was hoping you'd ask.",
    stayRefuse: "[[face:frown]] [[look:player]] I'm not ready for that. Give me time?",
    stay: "[[face:smile]] [[beat:0.5]] Don't let go of my hand, okay?",
    bye: "[[face:smile]] Goodnight. Wake me if the world ends.",
  }),
  ...bedTopics('kai', {
    refuse: "[[look:player]] I'm good here, thanks.",
    invite: "[[look:player]] Sure. My back's killing me anyway.",
    invitePlus: "[[face:smirk]] [[look:player]] You don't have to ask twice.",
    stayRefuse: "[[look:player]] Let's not rush it.",
    stay: "[[look:player]] [[beat:0.5]] Yeah. I'd like that.",
    bye: "[[look:player]] Night. Holler if something moves.",
  }),
]);
```

Also:
  - Import it in `src/core/app.js` next to `data/dialogue/games.js`: `import '../../data/dialogue/bed.js';`.
  - Add it to whatever list `tools/lint-data.mjs` imports dialogue packs from.
  - Check that `rng.pick` exists on the rng stream (`src/core/rng.js`). If it's named differently, e.g. `choice`, use that name in `narrationFor`'s caller in app.js rather than changing `rng`.

- [ ] **Step 8: The `bed` line effect**
  - `data/schema.js`, in `topic()`'s per-line loop:

```js
    if (ln.bed != null) assert(['invite', 'stay', 'dismiss'].includes(ln.bed), `topic ${id} line.bed must be invite|stay|dismiss`);
```

  - `src/dialogue/effects.js`, after the `line.game` emit:

```js
  // A line may ask the bed scene to act (data/dialogue/bed.js). Per LINE, never
  // per topic, so the refusal lines of the same topic can't seat anyone.
  if (line.bed) emit('bed.requested', { action: line.bed, charId: char.id });
```

- [ ] **Step 9: First-person seated lock.** In `src/camera/firstPerson.js`:
  - Add to the constructor near `this.onInteract`:

```js
    /** While seated (bed), movement keys stand the player up instead of walking. */
    this.seated = false;
    this.onStandUp = null;
```

  - In the movement update, right after `this._moving = !!(f || s);`, add:

```js
    if (this.seated) {
      if (f || s) this.onStandUp?.();
      this._moving = false;
      return;
    }
```

    Read the surrounding function first. If returning early would skip camera or animation updates that must still run, guard only the translation block (`if (f || s) { … }`) with `!this.seated` instead.
  - Update the `placeAt` doc comment: "e.g. on the bed".

- [ ] **Step 10: Wire it in `src/core/app.js`**
  - Import `{ BedScene, bedPrompt }` from `'../sim/bedScene.js'` and `{ narrationFor }` from `'../../data/dialogue/bed.js'`.
  - In the prop registration loop, keep a handle on the bed's picker target so its prompt can change:

```js
    for (const prop of this.world.props) {
      const target = { ...prop, onInteract: () => this._useProp(prop) };
      if (prop.id === 'bed') this._bedTarget = target;
      this.picker.register(target);
    }
```

  - In `zoneBuilder.js` `PROP_PROMPTS`, add `bed: 'Sit on the bed',`.
  - After the games construction (where `BedGame` used to be built), add:

```js
    // the bed: sit / lie / invite / stay the night (src/sim/bedScene.js)
    this.bedScene = new BedScene({
      placePlayer: (pose) => this._placeOnBed(pose),
      releasePlayer: () => this._leaveBed(),
      skip: (m) => this.clock.skip(m),
      scheduler: this.scheduler,
      fade: (on) => this._fade(on),
      narrate: (text) => this._narrate(text),
      narration: (id) => narrationFor(id, this.rng.stream('bed')),
      player: () => this.run.player,
      brain: (id) => this.brains[id],
    });
    on('bedscene.state', ({ player }) => { if (this._bedTarget) this._bedTarget.prompt = bedPrompt(player); });
    on('bedscene.guest', ({ id, seated }) => {
      const b = this.brains[id];
      if (!b) return;
      // hold the guest's brain while seated (a day is effectively "until dismissed")
      if (seated) b.engage(this.clock.totalMinutes + 1440); else b.engagedUntil = this.clock.totalMinutes;
    });
    on('bed.requested', ({ action, charId }) => {
      const c = this.cast[charId];
      if (!c) return;
      if (action === 'invite') this.bedScene.invite(c);
      else if (action === 'stay') this.bedScene.stayNight(c);
      else if (action === 'dismiss') this.bedScene.dismiss(c);
    });
    on('bedscene.started', () => this.conductor.setMood({ intimacy: 0.5, warmth: 0.7, energy: 0.2, tension: 0.05 }));
    on('bedscene.ended', () => this.conductor.setMood({ intimacy: 0, warmth: 0.45, energy: 0.3, tension: Math.min(1, this.run.threat / 90) }));
```

  - In `_useProp`, add a case before the elevator case:

```js
      case prop.id === 'bed':
        this.bedScene.use();
        break;
```

  - Add the staging methods, next to where `enterBedScene` was. They rebuild its floor handling, player-body snap and camera-mode restore:

```js
  /**
   * Put the player on the bed in first person. Mirrors the old bed staging:
   * the WHOLE move goes through setFloor, and the body is snapped along with the
   * eye so proximity checks and gaze resolve to where the player actually is.
   * @param {'sitting'|'lying'} pose
   */
  _placeOnBed(pose) {
    if (this.world.activeFloor !== 'penthouse') this.setFloor('penthouse', { movePlayer: false });
    const ref = pose === 'lying' ? 'bed.lie_center' : 'bed.seat0';
    const sock = this.world.getSocket(ref);
    const p = sock ? sock.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(-12.1, 0, 3.6);
    if (!this._bedReturn) this._bedReturn = { camMode: this.cameraRig.mode };
    this.cameraRig.setMode('firstPerson');
    const fp = this.cameraRig.fp;
    // sitting: face out into the alcove; lying: look up and across the room
    const yaw = pose === 'lying' ? 0 : Math.PI;
    fp.placeAt(p.x, p.z, yaw, pose === 'lying' ? 0.35 : -0.05);
    fp.pos.y = pose === 'lying' ? 0.75 : 1.05;   // eye height on the mattress
    fp.seated = true;
    fp.onStandUp = () => this.bedScene.getUp();
    this.playerMarker.position.set(p.x, 1.4, p.z);
    this.playerActor?.snapTo(p.x, p.z, yaw);
  }

  /** Back on your feet at the bedside, in whatever camera mode you were using. */
  _leaveBed() {
    const fp = this.cameraRig.fp;
    fp.seated = false;
    fp.onStandUp = null;
    const side = waypointPos('bed_alcove', 'bedside');
    if (side) {
      fp.placeAt(side[0], side[1], fp.yaw);
      this.playerMarker.position.set(side[0], 1.4, side[1]);
      this.playerActor?.snapTo(side[0], side[1], fp.yaw);
    }
    const back = this._bedReturn?.camMode;
    this.cameraRig.setMode(back && back !== 'cinematic' ? back : 'auto');
    this._bedReturn = null;
  }

  /** Full-screen fade used by the bed scene. Resolves when the transition ends. */
  _fade(on) {
    let el = document.getElementById('fade');
    if (!el) { el = document.createElement('div'); el.id = 'fade'; document.getElementById('ui').appendChild(el); }
    el.classList.toggle('on', on);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return new Promise((r) => setTimeout(r, reduced ? 50 : 1200));
  }

  /** One line of narration in the subtitle strip, held long enough to read. */
  _narrate(text) {
    emit('subtitle.narration', { text });
    feed(text, 'info');
    return new Promise((r) => setTimeout(r, Math.min(6000, 1800 + text.length * 45)));
  }
```

Notes for this step:
  - Check `waypointPos`'s return shape in `src/sim/actors/nav.js` (already imported in app.js). If it returns a `Vector3` or `{x,z}`, adapt the `side[0]` / `side[1]` reads.
  - Check `fp.pos` is the eye position vector (it is used in `placeAt`).
  - Check how `src/ui/subtitles` (or `hud.js`) shows lines, and route `subtitle.narration` into it. If the subtitle module listens to a different event name, emit that name instead and delete `subtitle.narration`. Grep `subtitle` in `src/ui`.
  - Add the CSS to `styles/hud.css`:

```css
#fade { position: fixed; inset: 0; background: #000; opacity: 0; pointer-events: none;
  transition: opacity var(--dur-slow, 1.2s) ease; z-index: var(--z-overlay, 900); }
#fade.on { opacity: 1; }
@media (prefers-reduced-motion: reduce) { #fade { transition: none; } }
```

    The subtitle strip must render above `#fade`. Check its z-index and give it a higher one if needed.

- [ ] **Step 11: AI sleep uses the bed when it's free.** In `src/sim/ai/actionCatalog.js`, change `sleep.exec`:

```js
    exec: (c, ctx) => {
      // lie on the bed when nobody (player or guest) is using it; else the window
      if (ctx?.bedFree?.()) c.queue.sit('bed.lie_center');
      else { c.queue.goto('bed_alcove', 'window'); c.queue.playClip('lounge', 0.5, 50); }
    },
```

  Then:
  - In app.js where `Brain`s get their `ctx`, add `bedFree: () => this.bedScene.playerState === 'none' && !this.bedScene.guests.length && !Object.values(this.cast).some((o) => o.queue.seatedAt?.startsWith('bed.'))`. Grep `new Brain(` and add the field to the object passed there.
  - When the brain collects the payoff, a lying NPC must also stand back up. Check how other sit actions end: if the brain relies on queue drain, add `c.queue.wait(50); c.queue.stand();` after the `sit` so the action has duration and ends standing.

- [ ] **Step 12: Verify**

Run: `npm test && npm run lint`
Expected: PASS (including `bedscene.test.mjs` and the extended regressions socket test)

Then run the game (Task 10 has the full browser pass) and smoke-check quickly:

```bash
node tools/serve.mjs 8420
```

In the browser pane at `http://localhost:8420`, start a run and walk to the bed alcove. Check that E sits, E lies down, E gets up, and that W from sitting gets up. Watch the console for errors.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(bed): sit, lie down, invite someone over, and stay the night (implied)"
```

---

### Task 8: LLM contract, intents, tone words, Aria's bio

**Files:**
- Modify: `src/dialogue/llm/promptBuilder.js`, `config/llm.yaml`, `docs/config/llm.md`, `data/dialogue/intents.js`, `src/dialogue/parser/tone.js`, `data/cast/aria.js`, `data/dialogue/aria/core.js`
- Test: `test/unit/llmtags.test.mjs` (a prompt-content test)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test** (append to `test/unit/llmtags.test.mjs`)

```js
import { buildSystemPrompt } from '../../src/dialogue/llm/promptBuilder.js';

test('the system prompt is all-audiences and carries the bond', () => {
  const char = { id: 'kai', name: 'Kai', persona: { archetype: 'a hacker', bio: 'x', personality: {} },
    stats: { happiness: 50, openness: 50, dominance: 50, trust: 50, tension: 20, energy: 60, sobriety: 100, loyalty: 40, fear: 10 },
    mood: { id: 'warm' }, bond: 'ally', queue: { zone: 'lounge' } };
  const p = buildSystemPrompt(/** @type {any} */ (char), { present: [], playerName: 'you', emitTags: true });
  assert.match(p, /BOND WITH THE GUEST: ally/);
  for (const bad of [/18\+/, /adults-only/i, /explicit/i, /erotic/i, /sexual/i, /dirty/i, /naked/i]) {
    assert.doesNotMatch(p.replace(/never sexual/i, ''), bad, `prompt still contains ${bad}`);
  }
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/unit/llmtags.test.mjs`
Expected: FAIL (`adults-only`, `EXPLICIT`)

- [ ] **Step 3: Rewrite the prompt.** In `src/dialogue/llm/promptBuilder.js`:
  - Header: drop "intimacy gates"; the pieces are persona + live stats/mood + bond + present + scene.
  - The opening `parts` line:

```js
    `You are ${char.name}, ${p.archetype}, a character in NEON-CITY: LOCK-DOWN — a neon-noir survival drama. You are sealed in a luxury cyberpunk tower with the guest (the player) and the others while the city riots below.`,
```

  - In `CONTRACT`, replace the two lines "Keep it tight…" and "This is an adults-only…" with:

```js
- Keep it tight: 1-3 sentences in ordinary talk; a little longer when something big is happening.
- Tone: noir survival drama. You can be warm, loyal, wry, scared, angry or lightly flirtatious — never sexual, never graphic. If the guest pushes for sex, deflect in character. Violence is felt, not dwelt on.
```

- [ ] **Step 4: Config comments** — change the `heated` budget comments in `config/llm.yaml:27` and `docs/config/llm.md:46` to "high tension or live combat".

- [ ] **Step 5: Intents and tone**
  - `data/dialogue/intents.js`:
    - Line 12 `flirt`: remove `sexy`, `bed` and `naughty` (keep cute/pretty/charming-type words).
    - Delete the `escalate` intent (line 13). First grep `data/` for `'escalate'` triggers, and delete or retarget any topic that uses it to `flirt`.
    - Line 23 `command`: remove `kneel` and `strip`.
  - `src/dialogue/parser/tone.js` 14-17: remove `wet`, `hard`, `undress`, `naked`, `pleasure` and `moan` from the `flirt` list.

- [ ] **Step 6: Aria.** In `data/cast/aria.js` (43-46), rewrite the bio's "selling company… to people with too much money" clause. Aria is now a **corporate negotiator**: she closed deals and smoothed scandals for executives with too much money, and knows exactly what they're afraid of. Lola is already the tower's fixer, so keep them distinct. Rewrite the aria flirt line in `data/dialogue/aria/core.js` (~132) that references the old bio to match, e.g. *"I used to get paid to make rich men feel listened to. You're the first one I actually wanted to listen to."* Keep the `[[tags]]` of the original line.

- [ ] **Step 7: Verify and commit**

Run: `npm test && npm run lint`

```bash
git add -A
git commit -m "feat(llm): an all-audiences noir contract; scrub sexual intent and tone words"
```

---

### Task 9: Clean-content guard, docs, README, CHANGELOG

**Files:**
- Create: `test/unit/clean-content.test.mjs`
- Modify: `README.md`, `package.json`, `CHANGELOG.md`, `docs/**` (per the list below), `lmstudio-engine/README.md`, `tools/fetch-fonts.mjs`
- Delete: `docs/screenshots/07-bed-game.jpg`

- [ ] **Step 1: Write the guard test** `test/unit/clean-content.test.mjs`

```js
// @ts-check
// The game is all-audiences as of v0.6. This walks every shipped source/data/
// config/style file and fails with file:line on any word from the retired
// adult register, so none of it can drift back in unnoticed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['src', 'data', 'config', 'tools', 'styles', 'index.html'];
const EXTS = new Set(['.js', '.mjs', '.yaml', '.yml', '.css', '.html', '.json']);
const BANNED = [
  /\barousal\b/i, /\bhorniness\b/i, /\bhorny\b/i, /\berotic\b/i, /\b18\+/, /adults?-only/i,
  /\bnaked\b/i, /\bnude\b/i, /\bexplicitness\b/i, /\bgateTier\b/, /\bbed_(recline|reach|arch|straddle|climax)\b/,
  /\bdirty[- ]talk\b/i, /\btalk dirty\b/i, /\bsafeword\b/i, /\bdepraved\b/i, /\blingerie\b/i,
];
// the guard's own word list, and vendored third-party code
const SKIP = [/^vendor\//, /node_modules/, /test\/unit\/clean-content/];

function* walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) { for (const f of readdirSync(p)) yield* walk(join(p, f)); }
  else if (EXTS.has(extname(p))) yield p;
}

test('no retired adult-register vocabulary ships in the game', () => {
  const hits = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const rel = file.replace(/\\/g, '/');
      if (SKIP.some((re) => re.test(rel))) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const re of BANNED) if (re.test(line)) hits.push(`${rel}:${i + 1}  ${re}  ${line.trim().slice(0, 90)}`);
      });
    }
  }
  assert.deepEqual(hits, [], `\n${hits.join('\n')}`);
});
```

- [ ] **Step 2: Run it and clean every hit**

Run: `node --test test/unit/clean-content.test.mjs`
Expected: FAIL, listing leftovers (comments etc.). Fix each at its file:line, rewording the comment or deleting the dead text. Re-run until it passes. Never loosen `BANNED` to get a pass. The one legitimate exception is a word that has an unrelated meaning in context; handle it by rewording.

- [ ] **Step 3: Docs.** Scrub the adult content and the retired systems. Describe the bond tier and the bed interactions where the old systems were described.
  - `README.md` 3, 25, 36-37, 65 (the bed-game screenshot line; delete it), 83, 87-91, 118-119, 237, 258-261, 267-272. Also change the stat count to 9 and the test counts to the new totals from `npm test`.
  - `package.json`: `"description": "Neon-City: Lock-Down — neon-noir 3D survival game in a sealed cyberpunk tower (three.js)."` and `"version": "0.6.0"`.
  - `docs/engine-overview.md` 54, 59, 66-68, 111.
  - `docs/config/chars.md` 3-4, 10, 19-33, 43-50: stats, coupling and bond.
  - `docs/config/README.md` (the gameplay row is already gone after Task 2; also add a `bond` mention under chars).
  - `docs/creation-kit/README.md` 22-23.
  - `docs/systems/characters-dialogue.md` 9-15, 19-29, 32-34, 37-41, 52, 81, 91, 103-114.
  - `docs/systems/scene-audio-ui.md` 36, 39, 46-49, 79-92.
  - `docs/systems/camera.md` 38, 46.
  - `docs/systems/sim-world-loop.md` 92, 99-100.
  - `docs/systems/scenario-toolkit.md:44`.
  - `docs/systems/humanoid.md:49` (also fix its stale "34 bones" to the real count in `src/humanoid/skeleton.js`).
  - `docs/systems/core.md:51`.
  - `docs/demo.md` 8, 14.
  - `lmstudio-engine/README.md` 44-57.
  - `tools/fetch-fonts.mjs:9`.
  - Then run `git rm docs/screenshots/07-bed-game.jpg`.

Afterwards grep the docs:

```bash
grep -rniE "18\+|adult|explicit|arousal|bed game|intimacy|gate ladder|truth.or.dare" README.md docs lmstudio-engine/README.md package.json
```

Expected: no output, except `docs/superpowers/**` (the spec itself describes the removal).

- [ ] **Step 4: CHANGELOG.** Add at the top, keeping earlier entries untouched:

```markdown
## 0.6.0 — "Clean slate"

The game is now all-audiences and about survival. Sub-project 1 of 7 in the full upgrade.

### Removed
- The bed game, its 39 actions, and the intimate animation clips.
- The seven-tier intimacy ladder, consent flags, and the explicitness setting.
- The arousal, pleasure and horniness stats (12 stats → 9).
- The 18+ boot gate, Truth-or-Dare, and the undress outfit states.
- The explicit LLM contract. Characters are now written as a noir survival drama.

### Added
- **Bond tier** — stranger → ally → trusted → loyal, derived from trust + loyalty with hysteresis. It shows on the stat rail, and a toast fires when a bond deepens. Companion abilities will hang off it in sub-project 4.
- **The bed as furniture** — E to sit, lie down, and get up.
  - Invite an ally to sit beside you.
  - A trusted companion can stay the night: a fade, one line, three hours passed, both of you rested. Nothing fires while the screen is black.
- NPCs who are tired now actually lie on the bed when it's free.
- Save format v2. v0.5 saves migrate automatically.
- A guard test that fails if retired adult vocabulary reappears in shipped files.
```

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run lint`

```bash
git add -A
git commit -m "docs: v0.6.0 — all-audiences docs, changelog, and a clean-content guard test"
```

---

### Task 10: Smoke test, full verification, review, merge

**Files:**
- Modify: `test/smoke/smoke.spec.mjs`

- [ ] **Step 1: Add the bed smoke test.** Follow the existing spec's helpers for booting a run. Read the file first and reuse its `start run` helper and `window.__ncld.debug` accessors. The test: start a run, then drive the bed scene through the debug handle and assert the state and the absence of console errors:

```js
test('bed: sit, lie down, get up — no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await startRun(page);   // the spec's existing helper; use whatever it is named
  const states = await page.evaluate(() => {
    const b = window.__ncld.app.bedScene;
    return [b.use(), b.use(), b.use()];
  });
  expect(states).toEqual(['sitting', 'lying', 'none']);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run everything**

```bash
npm test
npm run lint
npm run test:e2e
```

Expected: all green. `test:e2e` needs the server on 8420; check `playwright.config.mjs` for whether it starts the server itself.

- [ ] **Step 3: Play it for real.** Start the game (`node tools/serve.mjs 8420`) in the browser pane and check each of these, fixing anything that fails:
  - [ ] Boot goes straight to the main menu (no age gate).
  - [ ] The settings panel has no Content/Explicitness row.
  - [ ] The stat rail shows 9 stats and a bond chip per character.
  - [ ] Walk to the bed: E sits, E lies down, E gets up; W while sitting gets up.
  - [ ] Type "come sit with me" to a stranger-bond character: they refuse and don't move.
  - [ ] `__ncld.debug.setStat('aria', {trust: 60, loyalty: 60})` shows a "trusts you" toast. Then "come sit with me" makes Aria sit on `seat1`.
  - [ ] "Stay the night?" chip: fade, narration line, clock +3h, fade in, no event fired during it.
  - [ ] Load an old v0.5 save slot if one exists in localStorage (or the Task 6 fixture via `__ncld.debug.load`).
  - [ ] No console errors throughout.

- [ ] **Step 4: Code review.** Dispatch `superpowers:requesting-code-review` over `git diff master...overhaul/v0.6`. Fix the confirmed findings and commit (`fix: review findings`).

- [ ] **Step 5: Merge and tag** (after the user confirms)

```bash
git checkout master
git merge --no-ff overhaul/v0.6 -m "Merge overhaul/v0.6 — v0.6.0 \"Clean slate\""
git tag v0.6.0
```

- [ ] **Step 6: Memory.** Update `project-overview.md` in the project memory dir: the spine is now bond (not gates), there are 9 stats, and there is no 18+ gate.
