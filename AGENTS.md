# AGENTS.md

A guide for AI coding agents (and humans) working on Neon-City: Lock-Down.

## What this is

Neon-City: Lock-Down is a neon-noir 3D survival game set in a sealed cyberpunk
tower (three.js, no bundler, no build step). The player is locked in a
penthouse with three autonomous NPCs while riots and faction wars tear up the
streets below — chat-first roleplay, day/night survival, combat, and
mini-games, all driven by an offline dialogue engine with an optional LLM
adapter for surface-text restyling. Current version: **0.7.0-alpha.1**, sub-project 2 of the 7-part upgrade (asset pipeline + render quality).

## Run / test / lint

```bash
node tools/serve.mjs 8420   # or double-click run.bat on Windows
npm test                    # node --test — unit suites
npm run lint                # lint-data.mjs + lint-config.mjs + lint-assets.mjs
npm run test:e2e            # playwright — end-to-end smoke suite
npm run test:all            # unit + lint + e2e
node tools/screenshots.mjs  # regenerate docs/screenshots/ (server on 8420; see docs/development.md)
npm run assets:verify       # sha256-check the committed CC0 assets (no download)
node tools/fetch-assets.mjs # fetch/transform manifest assets; node tools/vendor-three.mjs for three addons
```

CI (`.github/workflows/ci.yml`) runs unit tests + lint on every push to
`master`/`overhaul/**` and every pull request into `master`; the Playwright
e2e job runs on pull requests into `master` and on `workflow_dispatch`.

After any UI change a README screenshot shows, re-run the matching shot
(`node tools/screenshots.mjs --list`) and look at the image before committing.

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
- **`src/assets/assets.js`** — the only way a binary asset (HDRI, PBR set,
  glTF, LUT) enters the game. Every loader resolves to `null` on failure and
  warns once; every caller MUST handle `null` by building the procedural
  version. `?noassets=1` forces that path for the whole game. Assets are added
  only through `assets/manifest.json` + `tools/fetch-assets.mjs` (CC0 only,
  40 MB budget, sha256-checked by `npm run lint`).

## Blender (dev tool, optional)

Blender 5.2 LTS is the offline tool for inspecting, converting and previewing
models; the game never runs it and nothing in `npm run lint` needs it.

- **Where:** `tools/blender/run.mjs` finds it via `$BLENDER_EXE`, then `PATH`,
  then `D:\Program Files\Blender Foundation\Blender 5.2lender.exe`, then the
  highest `C:\Program Files\Blender Foundation\Blender */blender.exe`. Set
  `BLENDER_EXE` if it lives elsewhere.
- **Runner CLI:**

```bash
node tools/blender/run.mjs inspect <in>                            # objects, tris, materials, bones, actions, bounds (JSON)
node tools/blender/run.mjs convert <in> <out.glb> [--lod 0.5] [--apply-scale]   # → GLB, Y-up, optional Decimate LOD
node tools/blender/run.mjs preview <in> <out.png>                  # 512² EEVEE render (Workbench fallback)
```

  `<in>` is `.glb`/`.gltf`/`.fbx`/`.obj`/`.blend`. From code:
  `runBlender(verb, {in, out, lod, apply_scale}, {timeoutMs})`.
- **Headless rules:** always `blender -b --factory-startup --python-exit-code 1`
  (no user prefs or add-ons, a Python error is a non-zero exit). Each script in
  `tools/blender/scripts/` starts from an empty scene and prints exactly one
  `@@RESULT <json>` line — keep it that way when adding a script; everything
  else on stdout is Blender chatter.
- **Tests:** `test/unit/blender.test.mjs` round-trips a Kenney GLB through
  inspect → convert → preview. It SKIPS the Blender-dependent tests when no
  Blender is found (CI has none), so run it locally after touching a script.
- **Interactive sessions:** a `blender` MCP server (`mcp-for-blender`) is
  configured for agent sessions that want to drive a live Blender UI; its
  telemetry is disabled (`DISABLE_TELEMETRY=1`). Scripted, repeatable work
  goes through the headless runner instead.

## Content rules

- **All-audiences.** No sexual content, no arousal-type stats, no
  explicitness settings. `test/unit/clean-content.test.mjs` walks `src/`,
  `data/`, `config/`, `tools/`, `styles/` and `index.html` and fails `npm test`
  with `file:line` on any retired-register word. Fix a hit by rewording or
  deleting the text — never by loosening the test's `BANNED` list; a word with
  an unrelated meaning in context gets reworded too.
- **The LLM contract is a noir survival drama.** Characters may be warm,
  loyal, or lightly flirtatious (PG-13); no sexual content. `src/dialogue/llm/promptBuilder.js`'s
  `CONTRACT` reflects this as of this release — never sexual, never graphic,
  deflect a guest who pushes for sex.

## Conventions

- `// @ts-check` at the top of every source file; JSDoc types, no build-time
  TypeScript.
- Comments explain *why*, not *what*.
- Plain ES modules + an import map. No bundler, no framework.
  `vendor/three.module.js` plus the addons recorded in
  `vendor/three/addons/VENDORED.json` are the only vendored runtime code — add
  addons with `tools/vendor-three.mjs`, never by hand. Node resolves
  `three/addons/*` through the generated `node_modules/three/addons/` shims.
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

0.7 is sub-project 2 of a 7-part upgrade:

1. Content cleanse + bonds (v0.6, released)
2. Asset pipeline + render quality (this sub-project, at alpha.1)
3. GLTF characters
4. Survival/lockdown loop
5. Combat and stealth
6. Story and exploration
7. UI / AAA polish
