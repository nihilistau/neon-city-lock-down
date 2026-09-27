# Development

How to run, test, and document the game while working on it. The runtime needs nothing but Node
and a browser; the dev dependencies (`npm install`) are only for the end-to-end suite and the
screenshot tool.

## Run

```bash
node tools/serve.mjs 8420      # or: npm run serve, or double-click run.bat on Windows
```

Open http://localhost:8420. Add `?debug=1` to expose `window.__ncld` — `app` (the composition
root) and `debug` (stat, bond, outfit, event, save/load and camera helpers; see `_exposeDebug()` in
`src/core/app.js`).

## Test and lint

```bash
npm test            # node --test — every unit suite under test/unit/
npm run lint        # lint-data.mjs (content + cross-references) + lint-config.mjs (config vs schema)
npm run test:e2e    # playwright — test/smoke/, a real headless Chromium against the real game
npm run test:all    # all three
```

`npm test` and `npm run lint` must pass at every commit. The e2e suite takes several minutes under
software WebGL; `playwright.config.mjs` starts the server itself if one isn't already on 8420.

### The clean-content guard

`test/unit/clean-content.test.mjs` walks every shipped file under `src/`, `data/`, `config/`,
`tools/`, `styles/` and `index.html` and fails with `file:line` on any word from the retired content
register (the game is all-audiences as of v0.6). When it fires, fix the text — reword the comment,
delete the dead code — never loosen its word list. A word with an unrelated meaning in context gets
reworded too.

## Screenshots

The README and docs images in `docs/screenshots/` are captured from the real game by
`tools/screenshots.mjs`, not by hand, so they can be regenerated whenever the UI changes.

```bash
node tools/serve.mjs 8420                         # the tool needs a running server
node tools/screenshots.mjs --list                 # shot names → files
node tools/screenshots.mjs                        # capture every shot
node tools/screenshots.mjs bond-rail combat       # capture just these
```

Each shot boots a fresh browser context (clean localStorage), stages its scene through
`window.__ncld`, freezes the render loop, and writes `docs/screenshots/NN-name.jpg` — 1710×907 for
the wide hero shots, 1250×907 for the rest, JPEG quality 82. Launch flags match
`playwright.config.mjs` (SwiftShader WebGL). A full run takes several minutes; a single shot about
one to two. Set `NCLD_URL` to point it somewhere other than `http://localhost:8420/?debug=1`.

To add a shot, append an entry to `SHOTS` with a `name`, an output `file`, a `size`, an optional
`boot` (`menu`, `intro`, or the default `run`), an async `stage(page)` that arranges the scene, and
an optional `grab(page, size)` that returns the PNG itself (`stay-the-night` uses it to frame one
subtitle line; the default is a full-viewport screenshot). Stage through the same hooks a player's
actions reach (`debug.setStat`, `app.bedScene.invite`, …) so the image shows real game state; call
the tool's `quiet(page)` first so neither a world event nor a scripted daily beat (dinner at 18:00)
takes the camera mid-shot. Look at every image before committing it: a black frame, a half-typed
line, or a mid-loading scene means the staging needs more settling time.

Keep each file under ~450KB. Existing numbers are stable (the README references them); new shots
take the next free number.

## Blender (optional)

`tools/blender/` drives a headless Blender (5.2 LTS here) for offline model work — inspecting a
download, converting it to GLB with LODs, rendering a preview. The game never runs Blender; it is a
dev tool only.

```bash
node tools/blender/run.mjs inspect assets/props/kenney_furniture/laptop.glb    # JSON: objects, tris, materials, bones, actions, bounds
node tools/blender/run.mjs convert in.fbx out.glb --lod 0.5 --apply-scale      # GLB, Y-up, modifiers applied, animations kept
node tools/blender/run.mjs preview in.glb out.png                              # 512² EEVEE render, Workbench if EEVEE can't start
```

`findBlender()` looks at `$BLENDER_EXE`, then `PATH`, then the default install folders under
`Program Files\Blender Foundation\`. Every run is `blender -b --factory-startup
--python-exit-code 1 -P tools/blender/scripts/<script>.py -- '<json args>'`; the script starts from
an empty scene and prints one `@@RESULT <json>` line, which `runBlender()` parses. A Python error
or a missing result line throws with the tail of Blender's stderr.

`test/unit/blender.test.mjs` runs the three scripts for real when Blender is installed (about 30 s)
and skips them, with a message, when it is not — CI has no Blender. For interactive work, agent
sessions also have a `blender` MCP server (telemetry disabled) that talks to a running Blender UI.
