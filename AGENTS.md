# AGENTS.md

A guide for AI coding agents (and humans) working on Neon-City: Lock-Down.

## What this is

Neon-City: Lock-Down is a neon-noir 3D survival game set in a sealed cyberpunk
tower (three.js, no bundler, no build step). The player is locked in a
penthouse with three autonomous NPCs while riots and faction wars tear up the
streets below — chat-first roleplay, day/night survival, combat, and
mini-games, all driven by an offline dialogue engine with an optional LLM
adapter for surface-text restyling. Current version: **0.6.0-beta.1**, the
first of a 7-part upgrade (see Roadmap below); this sub-project removed every
18+ system and replaced it with a bond tier.

## Run / test / lint

```bash
node tools/serve.mjs 8420   # or double-click run.bat on Windows
npm test                    # node --test — unit suites
npm run lint                # lint-data.mjs + lint-config.mjs
npm run test:e2e            # playwright — end-to-end smoke suite
npm run test:all            # unit + lint + e2e
```

## Architecture spine (don't break)

- **`src/core/app.js`** — the composition root. The only module allowed to
  import everything and wire it together.
- **`src/core/bus.js`** — the only cross-layer channel (UI ↔ sim ↔ 3D).
- **`src/sim/actors/actorQueue.js`** — the single command funnel for every
  character movement/pose/expression, from AI, dialogue, events, cutscenes, or
  the director. A command can carry `minBond`; the queue refuses it (emitting
  `actor.refused`) if the character's current bond tier doesn't reach it.
- **`src/chars/bond.js`** — the sole authority on the relationship tier
  (`stranger → ally → trusted → loyal`), derived from `(trust + loyalty) / 2`
  with hysteresis so a character can't flicker tiers line to line. Nothing
  stores a tier as truth; it's recomputed from stats every time.
- **`src/dialogue/stageDirections.js`** — the closed vocabulary of inline
  `[[tag:args]]` directions authored lines can carry (animation, expression,
  movement, lighting, camera, sound, stat deltas).
- **`data/schema.js`** — import-time validation for every content module in
  `data/`, plus the standalone `tools/lint-*.mjs` checks (content
  cross-references, config-against-schema).
- **Config**: `config/*.yaml` (editable) over `data/configDefaults.js`
  (baked defaults), validated by `data/configSchema.js`. Both files change
  together with any behavior they configure — schema validation must never
  fail between commits.
- **`src/sim/bedScene.js`** — a port-injected state machine for the bed (player
  sitting/lying/none, seated guests, reservation against double occupancy).
  Nothing in it reaches into the DOM or three.js directly; `app.js` wires it to
  the camera, scheduler, and cast.

## Content rules

- **All-audiences.** No sexual content, no arousal-type stats, no
  explicitness settings. A guard test that greps for banned terms across
  `src/`, `data/`, `config/`, `tools/`, `styles/` and `index.html` is coming in
  rc.1 — until then, don't reintroduce any of the retired vocabulary
  (arousal/horniness/pleasure-as-a-stat, explicit/explicitness, 18+, nude,
  naked, erotic, `bed_*` clip names, gate/gateTier, consent-gate).
- **The LLM contract is a noir survival drama.** Characters may be warm,
  loyal, or lightly flirtatious (PG-13); no sexual content. `src/dialogue/llm/promptBuilder.js`'s
  `CONTRACT` still contains pre-cleanse adults-only/explicit instructions as of
  this release — that rewrite is scoped to a follow-up LLM task, not yet
  landed. Don't copy that prompt's current wording into new work; treat it as
  known-stale.

## Conventions

- `// @ts-check` at the top of every source file; JSDoc types, no build-time
  TypeScript.
- Comments explain *why*, not *what*.
- Plain ES modules + an import map. No bundler, no framework.
  `vendor/three.module.js` is the only vendored runtime library.
- Commit trailer for agent commits: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Workflow

- Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`.
- TDD: write the failing test first, then the implementation.
- Each task gets its own review before merging forward.

## Release discipline

- Pre-release tags in order: alpha → beta → rc → release.
- Every tag bumps `package.json`'s `version`, adds a CHANGELOG entry, and
  keeps README (features, screenshots, test counts) and this file true of
  HEAD. Update the relevant `docs/` pages too.
- Push the branch and its tags. Real releases (not pre-releases) get a GitHub
  release; pre-releases (alpha/beta/rc) are published with the pre-release
  flag set.

## Roadmap

0.6 is sub-project 1 of a 7-part upgrade:

1. Content cleanse + bonds (this sub-project, in progress)
2. Asset pipeline + render quality
3. GLTF characters
4. Survival/lockdown loop
5. Combat and stealth
6. Story and exploration
7. UI / AAA polish
