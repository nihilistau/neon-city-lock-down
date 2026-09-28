# Asset Pipeline + Render Quality (v0.7.0 "Glass and neon") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tower read as a AAA neon-noir interior at 60 fps on a mid-range GPU, and lay the asset plumbing that sub-project 3 (GLTF characters) builds on. The engine stays no-build and procedural; real assets load where they exist, and the procedural versions remain the fallback.

**Architecture:**
- **Two dev-time tools** do all downloading. `tools/vendor-three.mjs` vendors three@0.185.0 addons. `tools/fetch-assets.mjs` fetches and transforms CC0 assets listed in `assets/manifest.json`. Both write committed outputs, and the game never downloads anything.
- **One runtime facade, `src/assets/assets.js`.** It uses injectable loaders, and every load resolves to `null` on failure (logging once), so each caller falls back to procedural. `?noassets=1` forces the fallback without any network access.
- **Pure, Node-tested cores** carry the logic, and the three.js modules around them stay thin:
  - `quality.js`: presets and overrides
  - `adaptiveRes.js`: the resolution controller
  - `worldUV.js`: UV math
  - `envMath.js`: env dip, rain and window layouts
  - `postMath.js`: blur weights
  - `staticMerge.js`: the merge planner
  - the tool libraries under `tools/lib/`
- **`RenderQuality` (`src/scene3d/renderQuality.js`)** is the single place that pushes resolved settings into Stage, PostFX, Lighting, World3D and assets. It re-runs on `config.changed`, so the Settings panel applies a preset live.
- **Node resolves `three/addons/*`** through re-export shims that `vendor-three.mjs` generates under the committed `node_modules/three/` shim. Unit tests import the same addon modules as the browser's import map.

**Tech Stack:** three.js r185 (vendored), plain ES modules + import map, `node --test`, Playwright smoke, YAML config via js-yaml, `sharp` (existing devDependency) for texture transforms.

**Spec:** `docs/superpowers/specs/2026-09-27-asset-pipeline-render-quality-design.md`

## Global Constraints

- **Branch:** `overhaul/v0.7`, cut from `master` after v0.6.0. The controller tags, pushes and publishes releases, so **this plan never runs `git tag` or `git push`**.
- **Every commit:** `npm test` and `npm run lint` pass.
  - Every stage boundary also runs `npm run test:e2e` green.
  - Commit messages end with a blank line followed by `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Every commit step below uses `git commit -F - <<'EOF' … EOF` so the trailer is exact.
- **Hybrid contract:**
  - Every asset consumer handles `null` and falls back to the procedural path the game ships today.
  - Nothing awaits an asset in a way that can reject.
  - `?noassets=1` boots with zero asset requests.
  - `?quality=low|medium|high|ultra` overrides the preset for the session.
- **Console discipline:** asset fallbacks log with `console.warn`, never `console.error`. The e2e suite asserts zero console errors, and a browser logs every 4xx/5xx fetch as an error. So the facade never requests a file that is absent from `assets/manifest.json`.
- **Asset budget:** 40 MiB = `41943040` bytes, summed over the files listed in `assets/manifest.json` (the downloaded third-party set).
  - It is enforced by `tools/lint-assets.mjs` (part of `npm run lint`) and by `test/unit/asset-manifest.test.mjs`.
  - Every listed file needs `license: "CC0"`.
- **No Blender, no KTX2/Basis, no `toktx`.** Textures are 1K JPEG via `sharp`. Downloads happen only through `tools/vendor-three.mjs` and `tools/fetch-assets.mjs`, and their outputs are committed.
- **Pins:**
  - `three@0.185.0` (tarball `https://registry.npmjs.org/three/-/three-0.185.0.tgz`)
  - Poly Haven 1K JPEG sets and the `shanghai_bund` HDRI at 1K and 2K
  - Kenney Furniture Kit and City Kit (Industrial) 2.0
- **Source guards that must keep matching:** unit tests read these strings out of the source, so the anchors must survive.
  - `test/unit/regressions.test.mjs` needs `  bed() {`, `  vanity_table() {`, `seat0: socket(group, 'seat0'` and `seat1: socket(group, 'seat1'` in `furniture.js`.
  - It also needs `const PROP_PROMPTS`, `if (PROP_PROMPTS[`, `_collectSolids(group, floor.id)`, and at least 5 `userData.solid = true` in `zoneBuilder.js`.
  - `test/unit/floorheight.test.mjs` constructs `new World3D(stage, rng)` synchronously and reads `mesh.geometry.parameters.height` on slabs.
- **Code style:**
  - `// @ts-check` header on every source file.
  - Comments explain *why*, in the repo's voice.
  - `data/configDefaults.js`, `data/configSchema.js` and `config/*.yaml` change together.
- **Commands:**
  - `npm test` runs all unit suites.
  - `node --test test/unit/<file>.test.mjs` runs one suite.
  - `npm run lint` runs data, config and assets.
  - `npm run test:e2e` runs Playwright and starts `tools/serve.mjs` itself.
  - `node tools/serve.mjs 8420` serves the game by hand.

---

## File map

| File | Change |
|---|---|
| `tools/lib/archive.mjs`, `tools/lib/importScan.mjs`, `tools/lib/manifest.mjs`, `tools/lib/lut.mjs`, `tools/lib/gltfPick.mjs`, `tools/lib/pbrPack.mjs` | **Create.** Pure tool libraries (tar/zip, import scan, manifest schema/verify/budget, LUT, glTF pick, ORM pack) |
| `tools/vendor-three.mjs`, `tools/fetch-assets.mjs`, `tools/lint-assets.mjs`, `tools/perf-sample.mjs` | **Create** |
| `vendor/three/addons/**`, `vendor/three/addons/VENDORED.json` | **Create** (tool output) |
| `node_modules/three/addons/**`, `node_modules/three/package.json` | **Create/Modify** (tool output: Node shims + `./addons/*` export) |
| `assets/manifest.json`, `assets/hdri/*`, `assets/pbr/<id>/*`, `assets/props/<pack>/*`, `assets/luts/neon_noir.cube` | **Create** (tool output) |
| `src/assets/assets.js`, `src/assets/loaders.js`, `src/assets/budget.js` | **Create** |
| `src/scene3d/materials/pbr.js`, `worldUV.js`, `cityWindows.js`, `rainGlass.js` | **Create** |
| `src/scene3d/tower/floorAssets.js`, `props.js`, `staticMerge.js` | **Create** |
| `src/scene3d/envMath.js`, `rain.js`, `quality.js`, `adaptiveRes.js`, `postMath.js`, `aoBlur.js`, `renderQuality.js` | **Create** |
| `src/ui/perfOverlay.js`, `src/humanoid/cullBounds.js`, `data/propDressing.js` | **Create** |
| `src/scene3d/{stage,postfx,aoPass,env,lighting}.js`, `src/scene3d/materials/texGen.js`, `src/scene3d/tower/{zoneBuilder,furniture}.js` | **Modify** |
| `src/humanoid/{bodyBuilder,outfitBuilder}.js`, `src/core/{loop,config,app}.js`, `src/main.js`, `src/ui/settingsPanel.js` | **Modify** |
| `data/configDefaults.js`, `data/configSchema.js`, `data/lightingPresets.js`, `config/render.yaml`, `config/lighting.yaml` | **Modify** |
| `tools/serve.mjs`, `tools/screenshots.mjs`, `package.json` | **Modify** |
| `test/unit/helpers/dom.mjs` | **Create** (fake canvas DOM for Node) |
| `test/unit/{archive,vendored,asset-manifest,lut,gltfpick,assets,texgen,worlduv,pbr,furniture-pbr,props,envmath,skyline,shaderpatch,quality,render-config,adaptive,postmath,renderquality,renderdebug,cullbounds,staticmerge}.test.mjs` | **Create** |
| `test/unit/loop.test.mjs`, `test/smoke/smoke.spec.mjs` | **Modify** |
| `README.md`, `AGENTS.md`, `CHANGELOG.md`, `docs/development.md`, `docs/systems/scene-audio-ui.md`, `docs/config/README.md`, `docs/config/lighting.md`, `docs/config/render.md` (create), `docs/screenshots/**` | **Modify** at stage boundaries |

---

# Stage alpha.1: vendor, asset pipeline, facade

### Task 1: Archive and import-scan libraries

**Files:**
- Create: `tools/lib/archive.mjs`, `tools/lib/importScan.mjs`
- Test: `test/unit/archive.test.mjs`

**Interfaces:**
- Produces:
  - `parseTar(buf: Buffer) → Map<string, Buffer>`
  - `parseTgz(tgz: Buffer) → Map<string, Buffer>`
  - `readZip(buf: Buffer) → { entries: {name, method, compSize, size, local}[], read(name: string): Buffer }`
  - `relativeImports(src: string) → string[]` (sorted, deduped)
  - `resolveRelative(fromFile: string, spec: string) → string` (posix)
  - `isEsModuleSource(src: string) → boolean`

- [ ] **Step 1: Write the failing test** `test/unit/archive.test.mjs`

```js
// @ts-check
// tools/lib/archive.mjs + tools/lib/importScan.mjs — the two parsers the asset
// tools stand on. A tar entry read at the wrong offset or a zip entry inflated
// with the wrong method does not crash: it silently writes a corrupt addon or
// texture into vendor/ or assets/, which is why these are tested against
// archives built byte by byte here rather than trusted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, deflateRawSync } from 'node:zlib';
import { parseTar, parseTgz, readZip } from '../../tools/lib/archive.mjs';
import { relativeImports, resolveRelative, isEsModuleSource } from '../../tools/lib/importScan.mjs';

/** one ustar header block; the checksum field is left blank (the parser does not verify it) */
function tarHeader(name, size, { type = '0', prefix = '' } = {}) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  if (prefix) h.write(prefix, 345, 155, 'utf8');
  return h;
}
function tarEntry(name, content, opts) {
  const body = Buffer.from(content);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([tarHeader(name, body.length, opts), body, pad]);
}
const TAR_END = Buffer.alloc(1024);

/** a minimal zip: local headers, a central directory, an end record */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const payload = e.method === 8 ? deflateRawSync(e.data) : e.data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(e.method, 8);
    lh.writeUInt32LE(payload.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(e.method, 10);
    ch.writeUInt32LE(payload.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, payload);
    centrals.push(ch, name);
    offset += 30 + name.length + payload.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test('tar: regular files come back by name, directories are skipped', () => {
  const tar = Buffer.concat([
    tarEntry('package/', '', { type: '5' }),
    tarEntry('package/a.js', 'export const a = 1;\n'),
    tarEntry('package/b.txt', 'x'.repeat(700)),   // spans two blocks
    TAR_END,
  ]);
  const files = parseTar(tar);
  assert.deepEqual([...files.keys()].sort(), ['package/a.js', 'package/b.txt']);
  assert.equal(files.get('package/a.js').toString(), 'export const a = 1;\n');
  assert.equal(files.get('package/b.txt').length, 700);
});

test('tar: the ustar prefix field and a pax path both lengthen a name', () => {
  const pax = '30 path=package/very/long/x.js\n';
  const tar = Buffer.concat([
    tarEntry('y.js', 'Y', { prefix: 'package/deep' }),
    tarEntry('PaxHeader', pax, { type: 'x' }),
    tarEntry('truncated-name.js', 'X'),
    tarEntry('after.js', 'A'),
    TAR_END,
  ]);
  const files = parseTar(tar);
  assert.equal(files.get('package/deep/y.js').toString(), 'Y');
  assert.equal(files.get('package/very/long/x.js').toString(), 'X', 'pax path overrides the header name');
  assert.equal(files.get('after.js').toString(), 'A', 'and applies to ONE entry only');
});

test('tgz: gunzip then tar', () => {
  const tgz = gzipSync(Buffer.concat([tarEntry('package/package.json', '{"version":"0.185.0"}'), TAR_END]));
  assert.equal(JSON.parse(parseTgz(tgz).get('package/package.json').toString()).version, '0.185.0');
});

test('zip: stored and deflated entries both read back byte-exact', () => {
  const glb = Buffer.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
  const text = Buffer.from('colormap '.repeat(200));
  const z = readZip(zip([
    { name: 'Models/', data: Buffer.alloc(0), method: 0 },
    { name: 'Models/GLB format/books.glb', data: glb, method: 0 },
    { name: 'Models/GLB format/Textures/colormap.txt', data: text, method: 8 },
  ]));
  assert.deepEqual(z.entries.map((e) => e.name), ['Models/GLB format/books.glb', 'Models/GLB format/Textures/colormap.txt']);
  assert.deepEqual(z.read('Models/GLB format/books.glb'), glb);
  assert.deepEqual(z.read('Models/GLB format/Textures/colormap.txt'), text);
  assert.throws(() => z.read('nope.glb'), /no nope\.glb/);
});

test('zip: a buffer with no end record is rejected, not half-read', () => {
  assert.throws(() => readZip(Buffer.from('definitely not a zip file at all, just text')), /not a zip/);
});

test('relativeImports finds static, re-export, side-effect and dynamic relative specifiers only', () => {
  const src = `
    import * as THREE from 'three';
    import { Pass, FullScreenQuad } from './Pass.js';
    import {
      mergeGeometries,
      toTrianglesDrawMode,
    } from '../utils/BufferGeometryUtils.js';
    export { SMAAShader } from "../shaders/SMAAShader.js";
    export * from './more.js';
    import './side-effect.js';
    const lazy = () => import('./lazy.js');
    const url = 'https://example.com/x.js';
  `;
  assert.deepEqual(relativeImports(src), [
    '../shaders/SMAAShader.js', '../utils/BufferGeometryUtils.js',
    './Pass.js', './lazy.js', './more.js', './side-effect.js',
  ]);
});

test('resolveRelative is posix and normalises ..', () => {
  assert.equal(resolveRelative('postprocessing/SMAAPass.js', '../shaders/SMAAShader.js'), 'shaders/SMAAShader.js');
  assert.equal(resolveRelative('loaders/GLTFLoader.js', './x.js'), 'loaders/x.js');
});

test('isEsModuleSource tells an ES module from UMD glue', () => {
  assert.equal(isEsModuleSource('import { A } from "three";\nexport { B };'), true);
  assert.equal(isEsModuleSource('var DracoDecoderModule = (function() { return {}; })();'), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/archive.test.mjs`
Expected: FAIL, `Cannot find module …/tools/lib/archive.mjs`

- [ ] **Step 3: Implement** `tools/lib/archive.mjs`

```js
// @ts-check
// Minimal readers for the two archive formats the asset tools download: the npm
// tarball (gzip'd ustar, for tools/vendor-three.mjs) and Kenney's zip packs (for
// tools/fetch-assets.mjs). Node stdlib only — adding `tar` and `yauzl` as
// devDependencies for ~100 lines of header parsing is not a trade worth making.
import { gunzipSync, inflateRawSync } from 'node:zlib';

/**
 * Parse an uncompressed tar into path → contents. Regular files only;
 * directories, links and pax GLOBAL headers are skipped. Honours the ustar
 * `prefix` field and a pax `path=` record — the two ways a name longer than 100
 * bytes is stored.
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>}
 */
export function parseTar(buf) {
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  let off = 0;
  /** @type {string|null} */
  let paxPath = null;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;   // the zero block that ends the archive
    const field = (at, len) => {
      const raw = header.subarray(at, at + len);
      const nul = raw.indexOf(0);
      return raw.subarray(0, nul === -1 ? len : nul).toString('utf8');
    };
    const size = parseInt(field(124, 12).trim() || '0', 8);
    // an old-style regular file has a NUL type byte
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    let name = field(0, 100);
    if (field(257, 5) === 'ustar') {
      const prefix = field(345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    const body = buf.subarray(off + 512, off + 512 + size);
    if (type === 'x') {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      paxPath = m ? m[1] : null;
    } else if (type === '0') {
      files.set(paxPath ?? name, Buffer.from(body));
      paxPath = null;
    } else if (type !== 'g') {
      paxPath = null;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** @param {Buffer} tgz */
export function parseTgz(tgz) {
  return parseTar(gunzipSync(tgz));
}

/**
 * Read a (non-zip64) zip archive. Entries are listed from the central directory
 * — the local headers can carry zero sizes when the archiver streamed them —
 * and only file entries are returned (names ending in `/` are directories).
 * @param {Buffer} buf
 */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  /** @type {{name:string, method:number, compSize:number, size:number, local:number}[]} */
  const all = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    all.push({ name, method, compSize, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const byName = new Map(all.map((e) => [e.name, e]));
  return {
    entries: all.filter((e) => !e.name.endsWith('/')),
    /** @param {string} name */
    read(name) {
      const e = byName.get(name);
      if (!e) throw new Error(`zip has no ${name}`);
      const n = buf.readUInt16LE(e.local + 26);
      const x = buf.readUInt16LE(e.local + 28);
      const start = e.local + 30 + n + x;
      const data = buf.subarray(start, start + e.compSize);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return inflateRawSync(data);
      throw new Error(`${name}: unsupported zip compression method ${e.method}`);
    },
  };
}
```

- [ ] **Step 4: Implement** `tools/lib/importScan.mjs`

```js
// @ts-check
// Find the RELATIVE module specifiers in an ES module's source. Used by
// tools/vendor-three.mjs to vendor an addon's dependencies transitively, and by
// test/unit/vendored.test.mjs to prove nothing vendored imports a file that is
// not on disk — an addon that resolves in Node through the shim but 404s in the
// browser is exactly the failure this guards.
//
// A regex, not a parser: three's examples are plain, well-formed ESM, and a
// false positive (an import-looking string in a comment) only makes the check
// stricter, never looser.
import { posix } from 'node:path';

const STATIC = /\b(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?['"](\.{1,2}\/[^'"\n]+)['"]/g;
const DYNAMIC = /\bimport\(\s*['"](\.{1,2}\/[^'"\n]+)['"]\s*\)/g;

/** @param {string} src @returns {string[]} sorted, deduped */
export function relativeImports(src) {
  const out = new Set();
  for (const m of src.matchAll(STATIC)) out.add(m[1]);
  for (const m of src.matchAll(DYNAMIC)) out.add(m[1]);
  return [...out].sort();
}

/**
 * @param {string} fromFile posix path of the importing file, relative to the addons root
 * @param {string} spec a relative specifier found in it
 */
export function resolveRelative(fromFile, spec) {
  return posix.normalize(posix.join(posix.dirname(fromFile), spec));
}

/** An ES module (worth a Node re-export shim), as opposed to UMD/emscripten glue. */
export function isEsModuleSource(src) {
  return /^\s*(?:export|import)[\s{*]/m.test(src);
}
```

- [ ] **Step 5: Run the test**

Run: `node --test test/unit/archive.test.mjs`
Expected: 8 tests PASS

- [ ] **Step 6: Commit**

```bash
git add tools/lib/archive.mjs tools/lib/importScan.mjs test/unit/archive.test.mjs
git commit -F - <<'EOF'
feat(tools): tar/zip readers and a relative-import scanner for the asset tools

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Vendor the three@0.185.0 addons (and Node shims)

**Files:**
- Create: `tools/vendor-three.mjs`, `test/unit/vendored.test.mjs`
- Create (tool output): `vendor/three/addons/**`, `vendor/three/addons/VENDORED.json`, `node_modules/three/addons/**`
- Modify (tool output): `node_modules/three/package.json`
- Modify: `package.json` (script `vendor:three`)

**Interfaces:**
- Consumes: `parseTgz`, `relativeImports`, `resolveRelative`, `isEsModuleSource` (Task 1)
- Produces:
  - Vendored addon files importable in the browser as `three/addons/<path>`:
    - `loaders/GLTFLoader.js`, `loaders/DRACOLoader.js`, `loaders/HDRLoader.js`, `loaders/LUTCubeLoader.js`
    - `utils/BufferGeometryUtils.js`, `utils/SkeletonUtils.js`
    - `libs/meshopt_decoder.module.js`, `libs/draco/gltf/*`
    - `postprocessing/SMAAPass.js`, `shaders/SMAAShader.js`, `postprocessing/LUTPass.js`
    - `geometries/RoundedBoxGeometry.js`
  - The same paths importable in Node through `node_modules/three/addons/<path>`.
  - `VENDORED.json` in the shape `{ three: '0.185.0', tarball, files: [{file, bytes, sha256, upstream}] }`.

- [ ] **Step 1: Write the failing test** `test/unit/vendored.test.mjs`

```js
// @ts-check
// vendor/three/addons — the contract tools/vendor-three.mjs writes down in
// VENDORED.json. The addons are third-party code copied into the repo by a
// tool, so the test checks the copy, not the tool: every file is the one that
// was recorded, nothing was dropped in by hand, every relative import resolves
// to a file that is actually vendored, and Node can import them the same way
// the browser's import map does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relativeImports, resolveRelative, isEsModuleSource } from '../../tools/lib/importScan.mjs';

const ROOT = new URL('../../', import.meta.url);
const ADDONS = new URL('vendor/three/addons/', ROOT);
const record = JSON.parse(readFileSync(new URL('VENDORED.json', ADDONS), 'utf8'));
const read = (rel) => readFileSync(new URL(rel, ADDONS));

/** @param {URL} dir @param {string} [prefix] @returns {string[]} */
function walk(dir, prefix = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...walk(new URL(`${e.name}/`, dir), `${prefix}${e.name}/`));
    else out.push(`${prefix}${e.name}`);
  }
  return out;
}
const onDisk = walk(ADDONS).filter((f) => f !== 'VENDORED.json').sort();
const isModule = (f) => f.endsWith('.js') && !f.startsWith('libs/draco/') && isEsModuleSource(read(f).toString('utf8'));

test('VENDORED.json pins the same three as the vendored core', () => {
  const core = readFileSync(new URL('vendor/three.core.js', ROOT), 'utf8');
  const rev = /const REVISION = '(\d+)'/.exec(core)?.[1];
  assert.equal(record.three, `0.${rev}.0`);
});

test('every recorded file is on disk with its recorded size and sha256', () => {
  for (const f of record.files) {
    const buf = read(f.file);
    assert.equal(buf.length, f.bytes, `${f.file}: size drifted`);
    assert.equal(createHash('sha256').update(buf).digest('hex'), f.sha256, `${f.file}: contents drifted — re-run tools/vendor-three.mjs`);
  }
});

test('every vendored file is recorded — nothing was dropped in by hand', () => {
  assert.deepEqual(onDisk, record.files.map((f) => f.file).sort());
});

test('the addons the asset pipeline and post stack need are all present', () => {
  for (const f of [
    'loaders/GLTFLoader.js', 'loaders/DRACOLoader.js', 'loaders/HDRLoader.js', 'loaders/LUTCubeLoader.js',
    'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js', 'libs/meshopt_decoder.module.js',
    'libs/draco/gltf/draco_decoder.js', 'libs/draco/gltf/draco_decoder.wasm', 'libs/draco/gltf/draco_wasm_wrapper.js',
    'postprocessing/SMAAPass.js', 'shaders/SMAAShader.js', 'postprocessing/LUTPass.js',
    'geometries/RoundedBoxGeometry.js',
  ]) assert.ok(onDisk.includes(f), `${f} is not vendored`);
});

test('every relative import of every vendored ES module resolves to a vendored file', () => {
  const missing = [];
  for (const f of onDisk.filter(isModule)) {
    for (const spec of relativeImports(read(f).toString('utf8'))) {
      const dep = resolveRelative(f, spec);
      if (!onDisk.includes(dep)) missing.push(`${f} → ${spec}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('Node resolves three/addons/* through the generated shims', async () => {
  const { RoundedBoxGeometry } = await import('three/addons/geometries/RoundedBoxGeometry.js');
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  assert.equal(typeof RoundedBoxGeometry, 'function');
  assert.equal(typeof mergeGeometries, 'function');
  for (const f of onDisk.filter(isModule)) {
    assert.ok(existsSync(new URL(`node_modules/three/addons/${f}`, ROOT)), `no Node shim for ${f}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/vendored.test.mjs`
Expected: FAIL, `ENOENT … vendor/three/addons/VENDORED.json`

- [ ] **Step 3: Implement** `tools/vendor-three.mjs`

```js
// @ts-check
// Vendor three.js example addons (examples/jsm) at EXACTLY the version of the
// vendored core (vendor/three.core.js REVISION). DEV-TIME ONLY — it needs the
// network; the game never runs it. Its output is committed.
//
//   node tools/vendor-three.mjs           add missing files, report drift
//   node tools/vendor-three.mjs --force   overwrite local copies with upstream
//
//   1. downloads the pinned npm tarball (cached under node_modules/.cache/)
//   2. extracts ADDONS plus everything they import relatively, transitively,
//      into vendor/three/addons/ at the same relative paths
//   3. FAILS if any vendored ES module imports a relative path that is not on
//      disk — an addon that loads in Node but 404s in the browser is the bug
//      this exists to prevent
//   4. writes vendor/three/addons/VENDORED.json (file, bytes, sha256, upstream)
//   5. writes one re-export shim per ES module under node_modules/three/addons/
//      and exports './addons/*' from the shim package, so `node --test` imports
//      'three/addons/…' exactly the way the browser's import map does
//
// An existing file that differs from upstream is KEPT (reported, recorded with
// upstream:false) unless --force: a local patch is a decision someone made.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseTgz } from './lib/archive.mjs';
import { relativeImports, resolveRelative, isEsModuleSource } from './lib/importScan.mjs';

const VERSION = '0.185.0';
const TARBALL = `https://registry.npmjs.org/three/-/three-${VERSION}.tgz`;
const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const OUT = join(ROOT, 'vendor', 'three', 'addons');
const SHIMS = join(ROOT, 'node_modules', 'three', 'addons');
const CACHE = join(ROOT, 'node_modules', '.cache', 'ncld-vendor');
const PREFIX = 'package/examples/jsm/';
/** emscripten/UMD glue + wasm: never scanned for imports, never shimmed */
const OPAQUE = /^libs\/draco\//;

/** What the game imports. Their relative dependencies are followed automatically. */
const ADDONS = [
  // already vendored before v0.7 — listed so the whole folder is reproducible
  'controls/OrbitControls.js',
  'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/ShaderPass.js',
  'postprocessing/OutputPass.js', 'postprocessing/UnrealBloomPass.js', 'postprocessing/MaskPass.js',
  'postprocessing/Pass.js',
  'shaders/CopyShader.js', 'shaders/LuminosityHighPassShader.js', 'shaders/OutputShader.js',
  // v0.7: asset loaders
  'loaders/GLTFLoader.js', 'loaders/DRACOLoader.js', 'loaders/HDRLoader.js', 'loaders/LUTCubeLoader.js',
  'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js',
  'libs/meshopt_decoder.module.js',
  'libs/draco/gltf/draco_decoder.js', 'libs/draco/gltf/draco_decoder.wasm', 'libs/draco/gltf/draco_wasm_wrapper.js',
  // v0.7: post stack + geometry
  'postprocessing/SMAAPass.js', 'shaders/SMAAShader.js', 'postprocessing/LUTPass.js',
  'geometries/RoundedBoxGeometry.js',
];

const sha = (b) => createHash('sha256').update(b).digest('hex');

async function tarball() {
  const cached = join(CACHE, `three-${VERSION}.tgz`);
  if (existsSync(cached)) return readFile(cached);
  console.log(`  ↓ ${TARBALL}`);
  const res = await fetch(TARBALL);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${TARBALL}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(CACHE, { recursive: true });
  await writeFile(cached, buf);
  return buf;
}

/** @param {string} dir @returns {Promise<string[]>} posix paths relative to `base` */
async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, base));
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

async function main() {
  const force = process.argv.includes('--force');
  const core = await readFile(join(ROOT, 'vendor', 'three.core.js'), 'utf8');
  const rev = /const REVISION = '(\d+)'/.exec(core)?.[1];
  if (`0.${rev}.0` !== VERSION) throw new Error(`vendor/three.core.js is r${rev}; this tool pins three@${VERSION}`);

  const files = parseTgz(await tarball());
  const pkg = JSON.parse(files.get('package/package.json')?.toString('utf8') ?? '{}');
  if (pkg.version !== VERSION) throw new Error(`tarball is three@${pkg.version}, expected ${VERSION}`);

  // 2. the transitive closure of ADDONS over relative imports
  const want = new Set(ADDONS);
  const queue = [...ADDONS];
  while (queue.length) {
    const rel = /** @type {string} */ (queue.pop());
    const buf = files.get(PREFIX + rel);
    if (!buf) throw new Error(`three@${VERSION} has no examples/jsm/${rel}`);
    if (!rel.endsWith('.js') || OPAQUE.test(rel)) continue;
    for (const spec of relativeImports(buf.toString('utf8'))) {
      const dep = resolveRelative(rel, spec);
      if (!want.has(dep)) { want.add(dep); queue.push(dep); }
    }
  }

  for (const rel of [...want].sort()) {
    const upstream = /** @type {Buffer} */ (files.get(PREFIX + rel));
    const dest = join(OUT, rel);
    let status = 'added';
    if (existsSync(dest)) {
      const same = sha(await readFile(dest)) === sha(upstream);
      status = same ? 'same' : force ? 'replaced' : 'kept';
    }
    if (status === 'added' || status === 'replaced') {
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, upstream);
    }
    if (status === 'kept') console.log(`  ! ${rel}  (differs from upstream — kept; --force replaces it)`);
    else if (status !== 'same') console.log(`  + ${rel}`);
  }

  // 3. closure over what is ACTUALLY on disk
  const onDisk = (await walk(OUT)).filter((f) => f !== 'VENDORED.json').sort();
  const have = new Set(onDisk);
  const missing = [];
  for (const rel of onDisk) {
    if (!rel.endsWith('.js') || OPAQUE.test(rel)) continue;
    for (const spec of relativeImports(await readFile(join(OUT, rel), 'utf8'))) {
      const dep = resolveRelative(rel, spec);
      if (!have.has(dep)) missing.push(`${rel} imports ${spec} → ${dep}, which is not vendored`);
    }
  }
  if (missing.length) {
    for (const m of missing) console.error(`  ✗ ${m}`);
    throw new Error(`${missing.length} unresolved relative import(s)`);
  }

  // 4. the record — every file on disk, with whether it is byte-identical to upstream
  const record = [];
  for (const rel of onDisk) {
    const buf = await readFile(join(OUT, rel));
    const up = files.get(PREFIX + rel);
    record.push({ file: rel, bytes: buf.length, sha256: sha(buf), upstream: !!up && sha(up) === sha(buf) });
  }
  await writeFile(join(OUT, 'VENDORED.json'), `${JSON.stringify({ three: VERSION, tarball: TARBALL, files: record }, null, 2)}\n`);

  // 5. Node shims + the './addons/*' export on the shim package
  let shims = 0;
  for (const rel of onDisk) {
    if (!rel.endsWith('.js') || OPAQUE.test(rel)) continue;
    if (!isEsModuleSource(await readFile(join(OUT, rel), 'utf8'))) continue;
    const shim = join(SHIMS, rel);
    const target = relative(dirname(shim), join(OUT, rel)).split(sep).join('/');
    await mkdir(dirname(shim), { recursive: true });
    await writeFile(shim, `// generated by tools/vendor-three.mjs — lets Node resolve three/addons/${rel}\nexport * from '${target}';\n`);
    shims++;
  }
  const pkgPath = join(ROOT, 'node_modules', 'three', 'package.json');
  const shimPkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  shimPkg.exports = { '.': './index.mjs', './addons/*': './addons/*' };
  await writeFile(pkgPath, `${JSON.stringify(shimPkg, null, 2)}\n`);

  const mb = (record.reduce((n, r) => n + r.bytes, 0) / 1048576).toFixed(2);
  console.log(`\nvendored ${record.length} files (${mb} MB), ${shims} Node shims`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
```

- [ ] **Step 4: Add the npm script.** In `package.json` `scripts`, after `"lint:config"`, add:

```json
    "vendor:three": "node tools/vendor-three.mjs",
```

- [ ] **Step 5: Run the tool**

Run: `node tools/vendor-three.mjs`
Expected:
- A `↓ https://registry.npmjs.org/three/-/three-0.185.0.tgz` line.
- One `+ <path>` line per new file: at least the 14 new addons from the test list, plus `libs/draco/gltf/*`.
- No `!` lines, because the pre-v0.7 files match upstream r185.
- A final line matching `vendored NN files (X.XX MB), NN Node shims`.

If a `!` line appears, that file differs from upstream. Run `git log --oneline -- vendor/three/addons/<path>`.
- If a commit patched it on purpose, keep the local copy.
- Otherwise run `node tools/vendor-three.mjs --force`.

Then run: `git status --short vendor node_modules/three`
Expected: new files under `vendor/three/addons/` and `node_modules/three/addons/`, plus a modified `node_modules/three/package.json` whose `exports` now has `"./addons/*": "./addons/*"`.

- [ ] **Step 6: Run the tests**

Run: `node --test test/unit/vendored.test.mjs && npm test`
Expected: 6 vendored tests PASS, and the full suite passes (no existing test imports an addon yet).

- [ ] **Step 7: Commit**

```bash
git add tools/vendor-three.mjs test/unit/vendored.test.mjs vendor/three/addons node_modules/three package.json
git commit -F - <<'EOF'
feat(vendor): three@0.185.0 addons for glTF/HDR/LUT/SMAA + Node shims

tools/vendor-three.mjs vendors the addons transitively from the pinned npm
tarball, refuses an unresolved relative import, records VENDORED.json, and
generates node_modules/three/addons/* re-export shims so unit tests import
three/addons/... exactly like the browser import map.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Asset manifest library, lint and budget test

**Files:**
- Create: `tools/lib/manifest.mjs`, `tools/lint-assets.mjs`, `assets/manifest.json`, `test/unit/asset-manifest.test.mjs`
- Modify: `package.json` (lint scripts)

**Interfaces:**
- Produces:
  - Constants: `ASSET_BUDGET_BYTES = 41943040`, `KINDS`, `LICENSES`, `ROLES`, `kindDir(entry) → string`
  - Pure functions:
    - `sha256(buf) → hex`
    - `validateManifest(m) → string[]`
    - `totalBytes(m) → number`
    - `resolveGltfRef(ref) → [packId, name]`
    - `checkPropRefs(m, props, skins) → string[]`
  - Filesystem functions:
    - `verifyFiles(m, root) → Promise<string[]>`
    - `strayFiles(m, root) → Promise<string[]>`
  - The lint entry `node tools/lint-assets.mjs`.
  - The manifest shape `{ entries: [{ id, kind: 'hdri'|'pbr'|'gltf'|'lut', source, license: 'CC0', urls, transform, files: [{path, role, name?, bytes, sha256}], hasMetal? }] }`.

- [ ] **Step 1: Write the failing test** `test/unit/asset-manifest.test.mjs`

```js
// @ts-check
// assets/manifest.json — the record of every third-party file the game ships.
// The repo promises "clone && serve": no LFS, no setup step. That only holds
// while the assets stay small and legal, so the budget and the licence are
// checked here as well as in `npm run lint`, against the real files on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  validateManifest, totalBytes, verifyFiles, strayFiles, ASSET_BUDGET_BYTES,
} from '../../tools/lib/manifest.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const real = JSON.parse(readFileSync(join(ROOT, 'assets', 'manifest.json'), 'utf8'));
const SHA = 'a'.repeat(64);
const f = (path, role, bytes = 10, extra = {}) => ({ path, role, bytes, sha256: SHA, ...extra });
const pbr = (over = {}) => ({
  id: 'rock', kind: 'pbr', source: 'Poly Haven — rock', license: 'CC0',
  urls: { diff: 'https://dl.polyhaven.org/x.jpg' }, transform: {},
  files: [f('assets/pbr/rock/rock_diff.jpg', 'diff'), f('assets/pbr/rock/rock_nor.jpg', 'nor'), f('assets/pbr/rock/rock_orm.jpg', 'orm')],
  ...over,
});

test('the shipped manifest is valid, inside the budget, and matches the files on disk', async () => {
  assert.deepEqual(validateManifest(real), []);
  assert.deepEqual(await verifyFiles(real, ROOT), []);
  assert.deepEqual(await strayFiles(real, ROOT), [], 'a file under assets/{hdri,pbr,props,luts} that the manifest does not list');
});

test('the budget is 40 MiB and the shipped set fits it', () => {
  assert.equal(ASSET_BUDGET_BYTES, 40 * 1024 * 1024);
  const total = totalBytes(real);
  assert.ok(total <= ASSET_BUDGET_BYTES, `${(total / 1048576).toFixed(2)} MB is over the 40 MB asset budget`);
});

test('a well-formed entry passes', () => {
  assert.deepEqual(validateManifest({ entries: [pbr()] }), []);
});

test('rejects what would break the licence, the layout, or the fingerprint', () => {
  const cases = [
    [pbr({ license: 'CC-BY' }), /license must be one of CC0/],
    [pbr({ kind: 'fbx' }), /kind must be one of/],
    [pbr({ id: 'Rock Set' }), /id must match/],
    [pbr({ urls: { diff: 'http://insecure/x.jpg' } }), /must be an https URL/],
    [pbr({ files: [] }), /no files — run node tools\/fetch-assets\.mjs rock/],
    [pbr({ files: [f('assets/pbr/rock/rock_diff.jpg', 'diff'), f('assets/pbr/rock/rock_nor.jpg', 'nor')] }), /missing the orm map/],
    [pbr({ files: [f('assets/elsewhere/rock_diff.jpg', 'diff'), f('assets/pbr/rock/n.jpg', 'nor'), f('assets/pbr/rock/o.jpg', 'orm')] }), /must live under assets\/pbr\/rock\//],
    [pbr({ files: [{ path: 'assets/pbr/rock/a.jpg', role: 'diff', bytes: 1 }, f('assets/pbr/rock/n.jpg', 'nor'), f('assets/pbr/rock/o.jpg', 'orm')] }), /has no sha256/],
    [pbr({ files: [f('assets/pbr/rock/../x.jpg', 'diff'), f('assets/pbr/rock/n.jpg', 'nor'), f('assets/pbr/rock/o.jpg', 'orm')] }), /clean posix path/],
    [{ id: 'm', kind: 'gltf', source: 'Kenney', license: 'CC0', urls: {}, transform: {}, files: [f('assets/props/m/cup.glb', 'model')] }, /model file needs a name/],
  ];
  for (const [entry, re] of cases) {
    const errs = validateManifest({ entries: [entry] });
    assert.ok(errs.some((e) => re.test(e)), `expected ${re} in:\n${errs.join('\n')}`);
  }
});

test('duplicate ids and duplicate paths are caught', () => {
  const errs = validateManifest({ entries: [pbr(), pbr()] });
  assert.ok(errs.some((e) => /duplicate id/.test(e)));
  assert.ok(errs.some((e) => /listed twice/.test(e)));
});

test('over budget is an error, and a shared path is only counted once', () => {
  const big = pbr({ files: [f('assets/pbr/rock/rock_diff.jpg', 'diff', ASSET_BUDGET_BYTES), f('assets/pbr/rock/rock_nor.jpg', 'nor', 1), f('assets/pbr/rock/rock_orm.jpg', 'orm', 1)] });
  assert.ok(validateManifest({ entries: [big] }).some((e) => /exceeds the 40\.00 MB asset budget/.test(e)));
  assert.equal(totalBytes({ entries: [{ files: [f('a', 'x', 5), f('a', 'x', 5), f('b', 'x', 7)] }] }), 12);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/asset-manifest.test.mjs`
Expected: FAIL, `Cannot find module …/tools/lib/manifest.mjs`

- [ ] **Step 3: Implement** `tools/lib/manifest.mjs`

```js
// @ts-check
// The asset manifest: schema, fingerprint and budget checks. Shared by
// tools/fetch-assets.mjs (which writes it), tools/lint-assets.mjs (`npm run
// lint`) and test/unit/asset-manifest.test.mjs. PURE except verifyFiles /
// strayFiles, which read the disk they are checking.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

/** Clone-and-serve stays viable at this size; past it, move to LFS (spec §Decisions). */
export const ASSET_BUDGET_BYTES = 40 * 1024 * 1024;
export const KINDS = ['hdri', 'pbr', 'gltf', 'lut'];
/** Only licences that let us commit and redistribute the file with no attribution chain. */
export const LICENSES = ['CC0'];
/** Which `role` a file of each kind may carry. */
export const ROLES = { hdri: ['hdr'], pbr: ['diff', 'nor', 'orm'], gltf: ['model', 'dependency'], lut: ['cube'] };
/** The top-level directories the pipeline owns; anything in them must be in the manifest. */
export const PIPELINE_DIRS = ['assets/hdri', 'assets/pbr', 'assets/props', 'assets/luts'];

/** @param {{id:string, kind:string}} e */
export function kindDir(e) {
  return { hdri: 'assets/hdri/', pbr: `assets/pbr/${e.id}/`, gltf: `assets/props/${e.id}/`, lut: 'assets/luts/' }[e.kind];
}

/** @param {Buffer|string} buf */
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const mb = (n) => (n / 1048576).toFixed(2);

/** @param {any} m @returns {number} bytes, each distinct path counted once */
export function totalBytes(m) {
  const seen = new Set();
  let n = 0;
  for (const e of m?.entries ?? []) {
    for (const f of e.files ?? []) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      n += Number(f.bytes) || 0;
    }
  }
  return n;
}

/** @param {any} m @returns {string[]} */
export function validateManifest(m) {
  if (!m || typeof m !== 'object' || !Array.isArray(m.entries)) return ['manifest: expected { entries: [...] }'];
  const errs = [];
  const ids = new Set();
  const paths = new Set();
  m.entries.forEach((e, i) => {
    const at = `entries[${i}]${e && typeof e.id === 'string' ? ` (${e.id})` : ''}`;
    if (!e || typeof e !== 'object') { errs.push(`${at}: not an object`); return; }
    if (typeof e.id !== 'string' || !/^[a-z0-9_]+$/.test(e.id)) errs.push(`${at}: id must match [a-z0-9_]+`);
    else if (ids.has(e.id)) errs.push(`${at}: duplicate id`);
    else ids.add(e.id);
    const kindOk = KINDS.includes(e.kind);
    if (!kindOk) errs.push(`${at}: kind must be one of ${KINDS.join('|')}`);
    if (typeof e.source !== 'string' || !e.source.trim()) errs.push(`${at}: source is required`);
    if (!LICENSES.includes(e.license)) errs.push(`${at}: license must be one of ${LICENSES.join('|')} — every shipped file needs a licence we can redistribute`);
    if (!e.urls || typeof e.urls !== 'object' || Array.isArray(e.urls)) errs.push(`${at}: urls must be an object`);
    else for (const [k, u] of Object.entries(e.urls)) if (typeof u !== 'string' || !u.startsWith('https://')) errs.push(`${at}: urls.${k} must be an https URL`);
    if (!e.transform || typeof e.transform !== 'object') errs.push(`${at}: transform must be an object`);
    if (!Array.isArray(e.files) || !e.files.length) {
      errs.push(`${at}: no files — run node tools/fetch-assets.mjs ${typeof e.id === 'string' ? e.id : ''}`.trim());
      return;
    }
    const dir = kindOk ? kindDir(e) : null;
    for (const f of e.files) {
      if (typeof f?.path !== 'string') { errs.push(`${at}: a file has no path`); continue; }
      if (f.path.includes('..') || f.path.includes('\\') || f.path.startsWith('/')) errs.push(`${at}: ${f.path} must be a clean posix path`);
      else if (dir && !f.path.startsWith(dir)) errs.push(`${at}: ${f.path} must live under ${dir}`);
      if (paths.has(f.path)) errs.push(`${at}: ${f.path} is listed twice`);
      paths.add(f.path);
      if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) errs.push(`${at}: ${f.path} has no sha256`);
      if (!Number.isInteger(f.bytes) || f.bytes <= 0) errs.push(`${at}: ${f.path} has no byte size`);
      if (kindOk && !ROLES[e.kind].includes(f.role)) errs.push(`${at}: ${f.path} role "${f.role}" is not one of ${ROLES[e.kind].join('|')}`);
      if (e.kind === 'gltf' && f.role === 'model' && typeof f.name !== 'string') errs.push(`${at}: ${f.path}: a model file needs a name`);
    }
    if (e.kind === 'pbr') for (const r of ROLES.pbr) if (!e.files.some((x) => x.role === r)) errs.push(`${at}: missing the ${r} map`);
  });
  const total = totalBytes(m);
  if (total > ASSET_BUDGET_BYTES) errs.push(`budget: ${mb(total)} MB exceeds the ${mb(ASSET_BUDGET_BYTES)} MB asset budget`);
  return errs;
}

/** @param {any} m @param {string} root repo root @returns {Promise<string[]>} */
export async function verifyFiles(m, root) {
  const errs = [];
  for (const e of m?.entries ?? []) {
    for (const f of e.files ?? []) {
      let buf;
      try { buf = await readFile(join(root, f.path)); } catch { errs.push(`${f.path}: missing on disk`); continue; }
      if (buf.length !== f.bytes) errs.push(`${f.path}: ${buf.length} bytes on disk, manifest says ${f.bytes}`);
      if (sha256(buf) !== f.sha256) errs.push(`${f.path}: sha256 mismatch — re-run node tools/fetch-assets.mjs ${e.id}`);
    }
  }
  return errs;
}

/** Files under the pipeline's directories that the manifest does not list. */
export async function strayFiles(m, root) {
  const listed = new Set((m?.entries ?? []).flatMap((e) => (e.files ?? []).map((f) => f.path)));
  const out = [];
  for (const dir of PIPELINE_DIRS) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const ent of await readdir(abs, { recursive: true, withFileTypes: true })) {
      if (!ent.isFile()) continue;
      const rel = relative(root, join(ent.parentPath ?? ent.path, ent.name)).split(sep).join('/');
      if (!listed.has(rel)) out.push(rel);
    }
  }
  return out.sort();
}

/** 'kenney_furniture/books' → ['kenney_furniture', 'books'] @param {string} ref */
export function resolveGltfRef(ref) {
  const i = ref.indexOf('/');
  if (i <= 0 || i === ref.length - 1) throw new Error(`"${ref}" is not a <pack>/<model> reference`);
  return [ref.slice(0, i), ref.slice(i + 1)];
}

/**
 * Cross-check data that names assets (data/propDressing.js) against the manifest.
 * @param {any} m @param {{asset:string, skin:string, floor:string}[]} props @param {string[]} skins
 */
export function checkPropRefs(m, props, skins) {
  const errs = [];
  for (const p of props) {
    let pack, name;
    try { [pack, name] = resolveGltfRef(p.asset); } catch (err) { errs.push(String(err instanceof Error ? err.message : err)); continue; }
    const e = (m?.entries ?? []).find((x) => x.id === pack);
    if (!e || e.kind !== 'gltf') errs.push(`${p.floor}: ${p.asset} — no gltf entry "${pack}" in assets/manifest.json`);
    else if (!e.files.some((f) => f.role === 'model' && f.name === name)) errs.push(`${p.floor}: ${p.asset} — "${pack}" has no model named "${name}"`);
    if (!skins.includes(p.skin)) errs.push(`${p.floor}: ${p.asset} — skin "${p.skin}" is not a PBR library material`);
  }
  return errs;
}
```

- [ ] **Step 4: Create** `assets/manifest.json` (empty for now; Task 6 fills it)

```json
{
  "entries": []
}
```

- [ ] **Step 5: Implement** `tools/lint-assets.mjs`

```js
// @ts-check
// Lints the asset pipeline: assets/manifest.json against its schema, every
// listed file against its recorded sha256, no stray files in the pipeline's
// directories, the CC0 licence on every entry, and the 40 MB budget. Run via
// `npm run lint`. Node stdlib only.
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, verifyFiles, strayFiles, totalBytes, ASSET_BUDGET_BYTES } from './lib/manifest.mjs';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
let failed = 0;
function report(label, errs) {
  if (errs.length) { failed += errs.length; console.log(`  ✗ ${label}:`); for (const e of errs) console.log(`      ${e}`); }
  else console.log(`  ✓ ${label}`);
}

console.log('asset lint\n');
const manifest = JSON.parse(await readFile(join(ROOT, 'assets', 'manifest.json'), 'utf8'));
report('manifest schema, licences, budget', validateManifest(manifest));
report('every file matches its sha256', await verifyFiles(manifest, ROOT));
report('no unlisted files in the pipeline dirs', (await strayFiles(manifest, ROOT)).map((p) => `${p}: not in assets/manifest.json`));

const mb = (n) => (n / 1048576).toFixed(2);
console.log(`\n  ${manifest.entries.length} entries, ${mb(totalBytes(manifest))} MB of the ${mb(ASSET_BUDGET_BYTES)} MB budget\n`);
if (failed) { console.error(`Asset lint FAILED (${failed} problem${failed === 1 ? '' : 's'}).`); process.exit(1); }
console.log('Asset lint passed.');
```

- [ ] **Step 6: Wire the lint.** In `package.json` `scripts`:
  - `"lint"` becomes `"node tools/lint-data.mjs && node tools/lint-config.mjs && node tools/lint-assets.mjs"`.
  - Add `"lint:assets": "node tools/lint-assets.mjs",` after `"lint:config"`.

- [ ] **Step 7: Run**

Run: `node --test test/unit/asset-manifest.test.mjs && npm run lint`
Expected: 7 tests PASS. The lint ends with `0 entries, 0.00 MB of the 40.00 MB budget` and `Asset lint passed.`

- [ ] **Step 8: Commit**

```bash
git add tools/lib/manifest.mjs tools/lint-assets.mjs assets/manifest.json test/unit/asset-manifest.test.mjs package.json
git commit -F - <<'EOF'
feat(assets): manifest schema, sha256 verification, 40 MB budget lint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: The neon-noir LUT generator

**Files:**
- Create: `tools/lib/lut.mjs`, `test/unit/lut.test.mjs`

**Interfaces:**
- Produces:
  - `LUT_SIZE = 33`
  - `neonNoir(rgb: [r,g,b]) → [r,g,b]` (display-referred, all channels 0..1)
  - `GRADES = { neonNoir }`
  - `cubeText({ title, size, grade }) → string` (Adobe `.cube`, red fastest)
  - `parseCube(text) → { size, rows: number[][] }`

- [ ] **Step 1: Write the failing test** `test/unit/lut.test.mjs`

```js
// @ts-check
// tools/lib/lut.mjs — the neon-noir colour grade, authored as code because the
// project has no grading tools. A .cube LUT is a lookup table the GPU samples
// with the pixel's own colour, so two properties matter more than the look:
// the table must be in the order LUTCubeLoader reads (red fastest), and the
// grade must be monotone in brightness, or a gradient bands and inverts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neonNoir, cubeText, parseCube, LUT_SIZE, GRADES } from '../../tools/lib/lut.mjs';

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('the .cube header and row count', () => {
  const text = cubeText({ title: 'neon_noir', size: 5, grade: neonNoir });
  const lines = text.trim().split('\n');
  assert.equal(lines[0], 'TITLE "neon_noir"');
  assert.equal(lines[1], 'LUT_3D_SIZE 5');
  assert.equal(lines[2], 'DOMAIN_MIN 0.0 0.0 0.0');
  assert.equal(lines[3], 'DOMAIN_MAX 1.0 1.0 1.0');
  assert.equal(parseCube(text).rows.length, 125);
  assert.ok(text.endsWith('\n'));
});

test('red varies fastest, then green, then blue — the order LUTCubeLoader reads', () => {
  const { rows } = parseCube(cubeText({ title: 'id', size: 2, grade: (c) => c }));
  assert.deepEqual(rows[0], [0, 0, 0]);
  assert.deepEqual(rows[1], [1, 0, 0]);
  assert.deepEqual(rows[2], [0, 1, 0]);
  assert.deepEqual(rows[4], [0, 0, 1]);
  assert.deepEqual(rows[7], [1, 1, 1]);
});

test('every graded value stays inside 0..1', () => {
  for (const row of parseCube(cubeText({ title: 'n', size: 9, grade: neonNoir })).rows) {
    for (const v of row) assert.ok(v >= 0 && v <= 1, `${v} out of range`);
  }
});

test('black stays black and white stays white — the grade tints, it does not fog', () => {
  assert.ok(Math.max(...neonNoir([0, 0, 0])) < 0.05);
  assert.ok(Math.min(...neonNoir([1, 1, 1])) > 0.93);
});

test('a grey ramp never gets darker as it gets brighter (no banding inversions)', () => {
  let prev = -1;
  for (let i = 0; i <= 64; i++) {
    const v = i / 64;
    const l = luma(neonNoir([v, v, v]));
    assert.ok(l >= prev - 1e-9, `luma dipped at ${v}: ${l} < ${prev}`);
    prev = l;
  }
});

test('split tone: teal in the shadows, warm-magenta in the highlights', () => {
  const [sr, , sb] = neonNoir([0.1, 0.1, 0.1]);
  assert.ok(sb > sr, 'shadows lean blue-green');
  const [hr, hg] = neonNoir([0.85, 0.85, 0.85]);
  assert.ok(hr > hg, 'highlights lean warm');
});

test('the shipped defaults', () => {
  assert.equal(LUT_SIZE, 33);
  assert.equal(GRADES.neonNoir, neonNoir);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/lut.test.mjs`
Expected: FAIL, `Cannot find module …/tools/lib/lut.mjs`

- [ ] **Step 3: Implement** `tools/lib/lut.mjs`

```js
// @ts-check
// The neon-noir colour grade, as a function and as an Adobe .cube 3D LUT.
// Generated, not painted: the project has no grading tools, and a grade that
// lives in code can be diffed, tested and retuned in one place. The LUT runs
// AFTER tone-mapping (src/scene3d/postfx.js, LUTPass after OutputPass), so the
// input is display-referred sRGB in 0..1 — which is where a .cube is authored.

export const LUT_SIZE = 33;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * @param {number[]} rgb display-referred 0..1
 * @returns {number[]} graded 0..1
 */
export function neonNoir([r, g, b]) {
  // 1. black point: crush the bottom 1.5% so night reads as night, not grey
  const bp = 0.015;
  let c = [r, g, b].map((v) => Math.max(0, (v - bp) / (1 - bp)));
  // 2. split tone keyed on luminance — teal shadows, warm-magenta highlights.
  //    Squared weights keep the midtones (skin) nearly untouched.
  const l = luma(c);
  const sh = (1 - l) ** 2;
  const hi = l ** 2;
  c = [c[0] + 0.035 * hi, c[1] + 0.025 * sh + 0.005 * hi, c[2] + 0.045 * sh + 0.02 * hi];
  // 3. a little extra saturation around the pixel's own luma: neon should sing
  const l2 = luma(c);
  c = c.map((v) => l2 + (v - l2) * 1.12);
  // 4. gentle S-curve, a quarter of a smoothstep: contrast without clipping
  c = c.map((v) => {
    const x = clamp01(v);
    const s = x * x * (3 - 2 * x);
    return x + (s - x) * 0.25;
  });
  return c.map(clamp01);
}

export const GRADES = { neonNoir };

/**
 * Serialise a grade as a .cube file. Red varies fastest, then green, then blue
 * — the order the format specifies and three's LUTCubeLoader reads.
 * @param {{title:string, size:number, grade:(rgb:number[]) => number[]}} o
 */
export function cubeText({ title, size, grade }) {
  const lines = [`TITLE "${title}"`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
  const n = size - 1;
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        const out = grade([ri / n, gi / n, bi / n]);
        lines.push(out.map((v) => clamp01(v).toFixed(4)).join(' '));
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Parse the data rows back out (tests + sanity checks). @param {string} text */
export function parseCube(text) {
  let size = 0;
  const rows = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('LUT_3D_SIZE')) { size = Number(line.split(/\s+/)[1]); continue; }
    if (/^[A-Z_]/.test(line)) continue;
    rows.push(line.split(/\s+/).map(Number));
  }
  return { size, rows };
}
```

- [ ] **Step 4: Run the test**

Run: `node --test test/unit/lut.test.mjs`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/lib/lut.mjs test/unit/lut.test.mjs
git commit -F - <<'EOF'
feat(tools): neon-noir grade + .cube LUT writer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: glTF model picking and ORM packing libraries

**Files:**
- Create: `tools/lib/gltfPick.mjs`, `tools/lib/pbrPack.mjs`, `test/unit/gltfpick.test.mjs`

**Interfaces:**
- Produces:
  - `pickModel(names: string[], match: string) → string|null`
  - `gltfJson(buf: Buffer, ext: '.glb'|'.gltf') → object`
  - `externalUris(buf, ext) → string[]` (decoded, `data:` excluded)
  - `packOrm({ size, ao, rough, metal }) → Buffer` (size×size×3, R=AO, G=rough, B=metal)

- [ ] **Step 1: Write the failing test** `test/unit/gltfpick.test.mjs`

```js
// @ts-check
// tools/lib/gltfPick.mjs + tools/lib/pbrPack.mjs. Picking decides WHICH Kenney
// model ships under a stable name, and the URI scan decides which sidecar files
// ship with it — miss one and GLTFLoader logs a console.error for a missing
// texture at boot, which the e2e suite treats as a failure. ORM packing decides
// which channel three's aoMap / roughnessMap / metalnessMap read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickModel, gltfJson, externalUris } from '../../tools/lib/gltfPick.mjs';
import { packOrm } from '../../tools/lib/pbrPack.mjs';

/** @param {any} json */
function glb(json) {
  let j = Buffer.from(JSON.stringify(json));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const h = Buffer.alloc(20);
  h.writeUInt32LE(0x46546c67, 0);   // 'glTF'
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(20 + j.length, 8);
  h.writeUInt32LE(j.length, 12);
  h.writeUInt32LE(0x4e4f534a, 16);  // 'JSON'
  return Buffer.concat([h, j]);
}

const NAMES = [
  'Models/GLB format/plantSmall2.glb', 'Models/GLB format/plantSmall1.glb',
  'Models/GLTF format/plantSmall1.gltf', 'Models/GLB format/books.glb',
  'Models/GLB format/bookcaseClosed.glb', 'Models/OBJ format/books.obj',
  'License.txt',
];

test('pickModel prefers .glb, then the shortest name, then alphabetical', () => {
  assert.equal(pickModel(NAMES, 'plantSmall'), 'Models/GLB format/plantSmall1.glb');
  assert.equal(pickModel(NAMES, 'BOOKS'), 'Models/GLB format/books.glb', 'case-insensitive, and never an .obj');
  assert.equal(pickModel(NAMES, 'bookcase'), 'Models/GLB format/bookcaseClosed.glb');
  assert.equal(pickModel(NAMES, 'tank'), null);
});

test('gltfJson reads the JSON chunk of a GLB and a plain .gltf', () => {
  assert.deepEqual(gltfJson(glb({ asset: { version: '2.0' } }), '.glb'), { asset: { version: '2.0' } });
  assert.deepEqual(gltfJson(Buffer.from('{"asset":{"version":"2.0"}}'), '.gltf'), { asset: { version: '2.0' } });
  assert.throws(() => gltfJson(Buffer.from('nope nope nope nope nope'), '.glb'), /not a GLB/);
});

test('externalUris lists sidecar buffers and images, decoded, never data: URIs', () => {
  const buf = glb({
    buffers: [{ byteLength: 4 }, { uri: 'books.bin', byteLength: 4 }],
    images: [{ uri: 'Textures/color%20map.png' }, { uri: 'data:image/png;base64,AAAA' }, { bufferView: 0 }],
  });
  assert.deepEqual(externalUris(buf, '.glb'), ['books.bin', 'Textures/color map.png']);
});

test('packOrm interleaves AO, roughness, metalness into R, G, B', () => {
  const out = packOrm({ size: 2, ao: Buffer.from([10, 20, 30, 40]), rough: Buffer.from([1, 2, 3, 4]), metal: Buffer.from([5, 6, 7, 8]) });
  assert.deepEqual([...out], [10, 1, 5, 20, 2, 6, 30, 3, 7, 40, 4, 8]);
});

test('packOrm: no AO means unoccluded (255), no metal means dielectric (0)', () => {
  const out = packOrm({ size: 1, ao: null, rough: Buffer.from([128]), metal: null });
  assert.deepEqual([...out], [255, 128, 0]);
  assert.throws(() => packOrm({ size: 2, ao: null, rough: Buffer.from([1]), metal: null }), /rough: 1 bytes, expected 4/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/gltfpick.test.mjs`
Expected: FAIL, `Cannot find module …/tools/lib/gltfPick.mjs`

- [ ] **Step 3: Implement** `tools/lib/gltfPick.mjs`

```js
// @ts-check
// Choosing models out of a Kenney pack, and finding the files each one needs.
// Kenney zips ship every model in several formats and variants; the manifest
// names what it wants by substring (`{ as: 'books', match: 'books' }`) so a
// pack re-release that renames `plantSmall1` to `plant-small-1` changes one
// match string, never the game data that refers to `kenney_furniture/books`.
import { posix } from 'node:path';

const MODEL = /\.(glb|gltf)$/i;

/**
 * @param {string[]} names every path in the zip
 * @param {string} match case-insensitive substring of the model's base name
 * @returns {string|null} .glb over .gltf, then the shortest base name (the plain
 *   variant over "-large"/"-corner"), then alphabetical — deterministic for a given zip
 */
export function pickModel(names, match) {
  const want = match.toLowerCase();
  const base = (n) => posix.basename(n).replace(MODEL, '').toLowerCase();
  const hits = names.filter((n) => MODEL.test(n) && base(n).includes(want));
  hits.sort((a, b) => (Number(/\.gltf$/i.test(a)) - Number(/\.gltf$/i.test(b)))
    || (base(a).length - base(b).length)
    || (a < b ? -1 : a > b ? 1 : 0));
  return hits[0] ?? null;
}

/** @param {Buffer} buf @param {string} ext '.glb' | '.gltf' */
export function gltfJson(buf, ext) {
  if (ext.toLowerCase() === '.gltf') return JSON.parse(buf.toString('utf8'));
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const len = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('GLB: the first chunk is not JSON');
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

/**
 * Relative URIs a model loads at runtime (external .bin buffers, texture images).
 * @param {Buffer} buf @param {string} ext @returns {string[]}
 */
export function externalUris(buf, ext) {
  const j = gltfJson(buf, ext);
  const uris = [...(j.buffers ?? []), ...(j.images ?? [])]
    .map((x) => x.uri)
    .filter((u) => typeof u === 'string' && !u.startsWith('data:'))
    .map((u) => decodeURIComponent(u));
  return [...new Set(uris)];
}
```

- [ ] **Step 4: Implement** `tools/lib/pbrPack.mjs`

```js
// @ts-check
/**
 * Pack single-channel AO / roughness / metalness rasters into ONE RGB raster in
 * the glTF "ORM" layout, which is exactly what three reads: aoMap samples R,
 * roughnessMap samples G, metalnessMap samples B. Three maps in one texture is
 * two fewer downloads, decodes and texture units per material.
 * @param {{size:number, ao:Buffer|null, rough:Buffer, metal:Buffer|null}} o
 *   each a size×size single-channel raster
 * @returns {Buffer} size×size×3
 */
export function packOrm({ size, ao, rough, metal }) {
  const n = size * size;
  for (const [k, b] of /** @type {[string, Buffer|null][]} */ ([['ao', ao], ['rough', rough], ['metal', metal]])) {
    if (b && b.length !== n) throw new Error(`${k}: ${b.length} bytes, expected ${n} (one channel at ${size}x${size})`);
  }
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = ao ? ao[i] : 255;          // no AO map = unoccluded
    out[i * 3 + 1] = rough[i];
    out[i * 3 + 2] = metal ? metal[i] : 0;  // no metal map = dielectric (the facade then omits metalnessMap)
  }
  return out;
}
```

- [ ] **Step 5: Run the test**

Run: `node --test test/unit/gltfpick.test.mjs`
Expected: 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add tools/lib/gltfPick.mjs tools/lib/pbrPack.mjs test/unit/gltfpick.test.mjs
git commit -F - <<'EOF'
feat(tools): Kenney model picking, glTF sidecar scan, ORM channel packing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: `tools/fetch-assets.mjs`, the manifest entries, and the committed assets

**Files:**
- Create: `tools/fetch-assets.mjs`
- Modify: `assets/manifest.json` (entries, then tool output), `package.json` (scripts)
- Create (tool output):
  - `assets/hdri/shanghai_bund_{1k,2k}.hdr`
  - `assets/pbr/<9 ids>/<id>_{diff,nor,orm}.jpg`
  - `assets/props/kenney_furniture/*`, `assets/props/kenney_industrial/*`
  - `assets/luts/neon_noir.cube`

**Interfaces:**
- Consumes: `readZip` (Task 1); `validateManifest`, `verifyFiles`, `totalBytes`, `sha256`, `ASSET_BUDGET_BYTES` (Task 3); `cubeText`, `GRADES`, `LUT_SIZE` (Task 4); `pickModel`, `externalUris`, `packOrm` (Task 5)
- Produces:
  - The CLI: `node tools/fetch-assets.mjs [ids…] [--force] | --verify | --list <gltf id>`
  - A filled `assets/manifest.json` with these entries:
    - HDRIs: `shanghai_bund_2k`, `shanghai_bund_1k`
    - PBR sets: `concrete_floor_worn_001`, `smooth_concrete_floor`, `metal_plate_02`, `painted_metal_shutter`, `floor_tiles_08`, `marble_01`, `plank_flooring_04`, `dirty_carpet`, `rusty_metal_02`
    - glTF packs: `kenney_furniture` (models `books`, `plant_small`, `laptop`, `trashcan`, `box_closed`) and `kenney_industrial` (models `tank`, `solar_panel`)
    - LUT: `neon_noir`

- [ ] **Step 1: Implement** `tools/fetch-assets.mjs`

```js
// @ts-check
// Fetch, transform and fingerprint every third-party asset listed in
// assets/manifest.json. DEV-TIME ONLY — the game never downloads anything; it
// serves what this tool committed. Needs the network and the `sharp`
// devDependency.
//
//   node tools/fetch-assets.mjs                 fetch whatever is missing or stale
//   node tools/fetch-assets.mjs <id> [<id>…]    only these entries
//   node tools/fetch-assets.mjs --force <id>    re-fetch even if the files verify
//   node tools/fetch-assets.mjs --verify        check every file's sha256; download nothing
//   node tools/fetch-assets.mjs --list <id>     print the models inside a gltf entry's zip
//
// Idempotent: an entry whose files already match their recorded sha256 is
// skipped without a request. Downloads are cached under node_modules/.cache/
// (git-ignored), so re-running after a transform tweak does not re-download.
//
// Transforms, per entry kind:
//   hdri  copied byte for byte (Poly Haven's .hdr is already the size we want)
//   pbr   sharp resize to transform.size (1024), JPEG transform.quality (82;
//         normals transform.normalQuality, 90), and AO / roughness / metalness
//         packed into ONE `_orm` texture (R/G/B, the glTF layout three's aoMap,
//         roughnessMap and metalnessMap already read): 3 files a set, not 5
//   gltf  unzip, pick models by transform.pick [{as, match}], copy every external
//         buffer/image a picked model references, and rename the model to `as`
//   lut   generated by tools/lib/lut.mjs (transform.generate, transform.size)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, normalize, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readZip } from './lib/archive.mjs';
import { validateManifest, verifyFiles, totalBytes, sha256, ASSET_BUDGET_BYTES } from './lib/manifest.mjs';
import { cubeText, GRADES, LUT_SIZE } from './lib/lut.mjs';
import { pickModel, externalUris } from './lib/gltfPick.mjs';
import { packOrm } from './lib/pbrPack.mjs';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const MANIFEST = join(ROOT, 'assets', 'manifest.json');
const CACHE = join(ROOT, 'node_modules', '.cache', 'ncld-assets');
const mb = (n) => (n / 1048576).toFixed(2);

/** @param {string} url */
async function download(url) {
  const cached = join(CACHE, createHash('sha256').update(url).digest('hex').slice(0, 24));
  if (existsSync(cached)) return readFile(cached);
  console.log(`    ↓ ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'neon-city-lock-down fetch-assets' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(CACHE, { recursive: true });
  await writeFile(cached, buf);
  return buf;
}

/** @typedef {{path:string, role:string, name?:string, buf:Buffer}} Output */

/** @type {Record<string, (entry:any) => Promise<Output[]>>} */
const HANDLERS = {
  async hdri(entry) {
    return [{ path: `assets/hdri/${entry.id}.hdr`, role: 'hdr', buf: await download(entry.urls.hdr) }];
  },

  async pbr(entry) {
    const sharp = (await import('sharp')).default;
    const S = entry.transform.size ?? 1024;
    const q = entry.transform.quality ?? 82;
    const jpeg = (buf, quality = q) => sharp(buf).resize(S, S, { fit: 'fill' }).jpeg({ quality }).toBuffer();
    const channel = (buf) => sharp(buf).resize(S, S, { fit: 'fill' }).extractChannel(0).raw().toBuffer();
    const u = entry.urls;
    const dir = `assets/pbr/${entry.id}`;
    const out = [
      { path: `${dir}/${entry.id}_diff.jpg`, role: 'diff', buf: await jpeg(await download(u.diff)) },
      { path: `${dir}/${entry.id}_nor.jpg`, role: 'nor', buf: await jpeg(await download(u.nor), entry.transform.normalQuality ?? 90) },
    ];
    let orm;
    if (u.arm) {
      orm = await jpeg(await download(u.arm));   // Poly Haven's ARM is already AO/rough/metal in R/G/B
    } else {
      const [ao, rough, metal] = await Promise.all([
        u.ao ? download(u.ao).then(channel) : null,
        download(u.rough).then(channel),
        u.metal ? download(u.metal).then(channel) : null,
      ]);
      orm = await sharp(packOrm({ size: S, ao, rough, metal }), { raw: { width: S, height: S, channels: 3 } })
        .jpeg({ quality: q }).toBuffer();
    }
    out.push({ path: `${dir}/${entry.id}_orm.jpg`, role: 'orm', buf: orm });
    entry.hasMetal = Boolean(u.metal || u.arm);
    return out;
  },

  async gltf(entry) {
    const zip = readZip(await download(entry.urls.zip));
    const names = zip.entries.map((e) => e.name);
    const packDir = `assets/props/${entry.id}/`;
    /** @type {Output[]} */
    const out = [];
    const seen = new Set();
    for (const { as, match } of entry.transform.pick) {
      const src = pickModel(names, match);
      if (!src) throw new Error(`${entry.id}: no model matches "${match}" — run: node tools/fetch-assets.mjs --list ${entry.id}`);
      const ext = posix.extname(src).toLowerCase();
      const buf = zip.read(src);
      out.push({ path: `${packDir}${as}${ext}`, role: 'model', name: as, buf });
      for (const uri of externalUris(buf, ext)) {
        const from = posix.normalize(posix.join(posix.dirname(src), uri));
        const to = posix.normalize(`${packDir}${uri}`);
        if (!to.startsWith(packDir)) throw new Error(`${entry.id}/${as}: "${uri}" points outside the pack directory`);
        if (seen.has(to)) continue;
        seen.add(to);
        if (!names.includes(from)) throw new Error(`${entry.id}/${as}: references ${uri}, which is not in the zip`);
        out.push({ path: to, role: 'dependency', buf: zip.read(from) });
      }
    }
    return out;
  },

  async lut(entry) {
    const grade = GRADES[entry.transform.generate];
    if (!grade) throw new Error(`${entry.id}: unknown grade "${entry.transform.generate}"`);
    const text = cubeText({ title: entry.id, size: entry.transform.size ?? LUT_SIZE, grade });
    return [{ path: `assets/luts/${entry.id}.cube`, role: 'cube', buf: Buffer.from(text) }];
  },
};

async function main() {
  const args = process.argv.slice(2);
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));

  if (args[0] === '--list') {
    const e = manifest.entries.find((x) => x.id === args[1]);
    if (!e || e.kind !== 'gltf') throw new Error(`--list needs a gltf entry id (got "${args[1] ?? ''}")`);
    const zip = readZip(await download(e.urls.zip));
    for (const n of zip.entries.map((x) => x.name).filter((n) => /\.(glb|gltf)$/i.test(n)).sort()) console.log(n);
    return;
  }

  if (args.includes('--verify')) {
    const errs = [...validateManifest(manifest), ...await verifyFiles(manifest, ROOT)];
    for (const e of errs) console.error(`  ✗ ${e}`);
    console.log(`${errs.length ? 'FAILED' : 'ok'} — ${manifest.entries.length} entries, ${mb(totalBytes(manifest))} MB of ${mb(ASSET_BUDGET_BYTES)} MB`);
    if (errs.length) process.exitCode = 1;
    return;
  }

  const force = args.includes('--force');
  const ids = args.filter((a) => !a.startsWith('--'));
  const unknown = ids.filter((id) => !manifest.entries.some((e) => e.id === id));
  if (unknown.length) throw new Error(`unknown id(s): ${unknown.join(', ')}`);

  for (const entry of manifest.entries) {
    if (ids.length && !ids.includes(entry.id)) continue;
    const fresh = entry.files?.length > 0 && (await verifyFiles({ entries: [entry] }, ROOT)).length === 0;
    if (fresh && !force) { console.log(`  = ${entry.id} (up to date)`); continue; }
    const handler = HANDLERS[entry.kind];
    if (!handler) throw new Error(`${entry.id}: no handler for kind "${entry.kind}"`);
    console.log(`  ▸ ${entry.id}`);
    const outputs = await handler(entry);
    entry.files = [];
    for (const o of outputs) {
      const abs = join(ROOT, o.path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, o.buf);
      entry.files.push({ path: o.path, role: o.role, ...(o.name ? { name: o.name } : {}), bytes: o.buf.length, sha256: sha256(o.buf) });
    }
    entry.files.sort((a, b) => a.path.localeCompare(b.path));
    console.log(`    ${entry.files.length} file(s), ${mb(entry.files.reduce((n, f) => n + f.bytes, 0))} MB`);
  }

  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n${mb(totalBytes(manifest))} MB of the ${mb(ASSET_BUDGET_BYTES)} MB budget`);
  const errs = validateManifest(manifest);
  for (const e of errs) console.error(`  ✗ ${e}`);
  if (errs.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
```

- [ ] **Step 2: Write the manifest entries.** Replace `assets/manifest.json` with the following. The `files` arrays start empty, and the tool fills them.

```json
{
  "entries": [
    { "id": "shanghai_bund_2k", "kind": "hdri", "source": "Poly Haven — shanghai_bund (Andreas Mischok)", "license": "CC0",
      "urls": { "hdr": "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/shanghai_bund_2k.hdr" }, "transform": {}, "files": [] },
    { "id": "shanghai_bund_1k", "kind": "hdri", "source": "Poly Haven — shanghai_bund (Andreas Mischok)", "license": "CC0",
      "urls": { "hdr": "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/shanghai_bund_1k.hdr" }, "transform": {}, "files": [] },
    { "id": "concrete_floor_worn_001", "kind": "pbr", "source": "Poly Haven — concrete_floor_worn_001", "license": "CC0",
      "urls": {
        "diff": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_worn_001/concrete_floor_worn_001_diff_1k.jpg",
        "nor": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_worn_001/concrete_floor_worn_001_nor_gl_1k.jpg",
        "rough": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_worn_001/concrete_floor_worn_001_rough_1k.jpg",
        "ao": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_worn_001/concrete_floor_worn_001_ao_1k.jpg" },
      "transform": { "size": 1024, "quality": 82, "normalQuality": 90, "pack": "orm" }, "files": [] },
    { "id": "smooth_concrete_floor", "kind": "pbr", "source": "Poly Haven — smooth_concrete_floor", "license": "CC0",
      "urls": {
        "diff": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/smooth_concrete_floor/smooth_concrete_floor_diff_1k.jpg",
        "nor": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/smooth_concrete_floor/smooth_concrete_floor_nor_gl_1k.jpg",
        "rough": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/smooth_concrete_floor/smooth_concrete_floor_rough_1k.jpg",
        "ao": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/smooth_concrete_floor/smooth_concrete_floor_ao_1k.jpg" },
      "transform": { "size": 1024, "quality": 82, "normalQuality": 90, "pack": "orm" }, "files": [] },
    { "id": "metal_plate_02", "kind": "pbr", "source": "Poly Haven — metal_plate_02", "license": "CC0",
      "urls": {
        "diff": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/metal_plate_02/metal_plate_02_diff_1k.jpg",
        "nor": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/metal_plate_02/metal_plate_02_nor_gl_1k.jpg",
        "rough": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/metal_plate_02/metal_plate_02_rough_1k.jpg",
        "metal": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/metal_plate_02/metal_plate_02_metal_1k.jpg",
        "ao": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/metal_plate_02/metal_plate_02_ao_1k.jpg" },
      "transform": { "size": 1024, "quality": 82, "normalQuality": 90, "pack": "orm" }, "files": [] },
    { "id": "painted_metal_shutter", "kind": "pbr", "source": "Poly Haven — painted_metal_shutter", "license": "CC0",
      "urls": {
        "diff": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/painted_metal_shutter/painted_metal_shutter_diff_1k.jpg",
        "nor": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/painted_metal_shutter/painted_metal_shutter_nor_gl_1k.jpg",
        "rough": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/painted_metal_shutter/painted_metal_shutter_rough_1k.jpg",
        "ao": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/painted_metal_shutter/painted_metal_shutter_ao_1k.jpg" },
      "transform": { "size": 1024, "quality": 82, "normalQuality": 90, "pack": "orm" }, "files": [] },
    { "id": "floor_tiles_08", "kind": "pbr", "source": "Poly Haven — floor_tiles_08", "license": "CC0",
      "urls": {
        "diff": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/floor_tiles_08/floor_tiles_08_diff_1k.jpg",
        "nor": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/floor_tiles_08/floor_tiles_08_nor_gl_1k.jpg",
        "rough": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/floor_tiles_08/floor_tiles_08_rough_1k.jpg",
        "ao": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/floor_tiles_08/floor_tiles_08_ao_1k.jpg" },
      "transform": { "size": 1024, "quality": 82, "normalQuality": 90, "pack": "orm" }, "files": [] },
    { "id": "marble_01", "kind": "pbr", "source": "Poly Haven — marble_01", "license": "CC0",
      "urls": {
        "diff": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/marble_01/marble_01_diff_1k.jpg",
        "nor": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/marble_01/marble_01_nor_gl_1k.jpg",
        "rough": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/marble_01/marble_01_rough_1k.jpg",
        "ao": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/marble_01/marble_01_ao_1k.jpg" },
      "transform": { "size": 1024, "quality": 82, "normalQuality": 90, "pack": "orm" }, "files": [] },
    { "id": "plank_flooring_04", "kind": "pbr", "source": "Poly Haven — plank_flooring_04", "license": "CC0",
      "urls": {
        "diff": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/plank_flooring_04/plank_flooring_04_diff_1k.jpg",
        "nor": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/plank_flooring_04/plank_flooring_04_nor_gl_1k.jpg",
        "rough": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/plank_flooring_04/plank_flooring_04_rough_1k.jpg",
        "ao": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/plank_flooring_04/plank_flooring_04_ao_1k.jpg" },
      "transform": { "size": 1024, "quality": 82, "normalQuality": 90, "pack": "orm" }, "files": [] },
    { "id": "dirty_carpet", "kind": "pbr", "source": "Poly Haven — dirty_carpet", "license": "CC0",
      "urls": {
        "diff": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/dirty_carpet/dirty_carpet_diff_1k.jpg",
        "nor": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/dirty_carpet/dirty_carpet_nor_gl_1k.jpg",
        "rough": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/dirty_carpet/dirty_carpet_rough_1k.jpg",
        "ao": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/dirty_carpet/dirty_carpet_ao_1k.jpg" },
      "transform": { "size": 1024, "quality": 82, "normalQuality": 90, "pack": "orm" }, "files": [] },
    { "id": "rusty_metal_02", "kind": "pbr", "source": "Poly Haven — rusty_metal_02", "license": "CC0",
      "urls": {
        "diff": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rusty_metal_02/rusty_metal_02_diff_1k.jpg",
        "nor": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rusty_metal_02/rusty_metal_02_nor_gl_1k.jpg",
        "arm": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rusty_metal_02/rusty_metal_02_arm_1k.jpg" },
      "transform": { "size": 1024, "quality": 82, "normalQuality": 90, "pack": "orm" }, "files": [] },
    { "id": "kenney_furniture", "kind": "gltf", "source": "Kenney — Furniture Kit 1.0 (kenney.nl)", "license": "CC0",
      "urls": { "zip": "https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip" },
      "transform": { "pick": [
        { "as": "books", "match": "books" },
        { "as": "plant_small", "match": "plantSmall" },
        { "as": "laptop", "match": "laptop" },
        { "as": "trashcan", "match": "trashcan" },
        { "as": "box_closed", "match": "cardboardBoxClosed" }
      ] }, "files": [] },
    { "id": "kenney_industrial", "kind": "gltf", "source": "Kenney — City Kit (Industrial) 2.0 (kenney.nl)", "license": "CC0",
      "urls": { "zip": "https://kenney.nl/media/pages/assets/city-kit-industrial/0ec35b139d-1788171848/kenney_city-kit-industrial_2.0.zip" },
      "transform": { "pick": [
        { "as": "tank", "match": "tank" },
        { "as": "solar_panel", "match": "solar" }
      ] }, "files": [] },
    { "id": "neon_noir", "kind": "lut", "source": "Generated by tools/lib/lut.mjs (neonNoir grade) for this project", "license": "CC0",
      "urls": {}, "transform": { "generate": "neonNoir", "size": 33 }, "files": [] }
  ]
}
```

- [ ] **Step 3: Confirm the Kenney picks against the real zips**

Run: `node tools/fetch-assets.mjs --list kenney_furniture` and `node tools/fetch-assets.mjs --list kenney_industrial`
Expected: each prints the `.glb`/`.gltf` paths inside the zip.

For every `match` in the two `pick` arrays, find the path `pickModel` will choose: prefer `.glb`, then the shortest base name that contains the match (case-insensitive). Check it is the model the `as` name describes:
- `books`: a stack of books.
- `plant_small`: a small potted plant.
- `laptop`: an open laptop.
- `trashcan`: a bin.
- `box_closed`: a closed cardboard box.
- `tank`: a storage tank or silo.
- `solar_panel`: a solar panel.

If a match hits nothing or the wrong model, edit only that `match` string to a substring of the right listed name. Keep `as` unchanged, because game data refers to `as`.

- [ ] **Step 4: Fetch everything**

Run: `node tools/fetch-assets.mjs`
Expected:
- A `▸ <id>` line for each of the 14 entries, each followed by `N file(s), X.XX MB`.
- The final budget line shows about 18–26 MB of the 40.00 MB budget.
- No `✗` lines.

Each `pbr` entry has 3 files. Each `hdri` entry has 1. Each `gltf` entry has one `model` file per pick, plus any `dependency` files the models reference, such as a shared `Textures/colormap.png`.

A `404` fails the entry with its URL:
- If the 404 is on the 1K HDRI URL, open `https://polyhaven.com/a/shanghai_bund` in a browser to confirm the 1K link. Poly Haven's pattern is `…/HDRIs/hdr/1k/<id>_1k.hdr`.
- If it is on a PBR map, confirm the map name on the asset's Poly Haven page.

Correct the URL in the manifest and re-run the command. Entries that already verify are skipped.

- [ ] **Step 5: Verify idempotence and fingerprints**

Run: `node tools/fetch-assets.mjs && node tools/fetch-assets.mjs --verify && npm run lint`
Expected:
- The first command prints `= <id> (up to date)` for all 14 entries and makes no downloads.
- `--verify` prints `ok — 14 entries, …`.
- The lint ends with `Asset lint passed.`

- [ ] **Step 6: Add the npm scripts.** In `package.json` `scripts`, add:

```json
    "assets:fetch": "node tools/fetch-assets.mjs",
    "assets:verify": "node tools/fetch-assets.mjs --verify",
```

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: all pass. `asset-manifest.test.mjs` now verifies 14 real entries against disk.

- [ ] **Step 8: Commit**

```bash
git add tools/fetch-assets.mjs assets/manifest.json assets/hdri assets/pbr assets/props assets/luts package.json
git commit -F - <<'EOF'
feat(assets): fetch-assets tool + the CC0 set (HDRI, 9 PBR sets, Kenney props, LUT)

tools/fetch-assets.mjs downloads and transforms every manifest entry
(1K JPEG via sharp, AO/rough/metal packed into one ORM map, Kenney models
picked by name with their sidecar files, the neon-noir .cube generated),
records sha256 + bytes, and is idempotent (--verify checks without
downloading). All CC0; inside the 40 MB budget.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: MIME types and the asset facade

**Files:**
- Create: `src/assets/assets.js`, `test/unit/assets.test.mjs`
- Modify: `tools/serve.mjs` (MIME map)

**Interfaces:**
- Produces `createAssets(opts)`:
  - Options: `loaders` (an `AssetLoaders` object, a Promise of one, or `null`), `enabled` (default `true`), `base` (default `'/'`), `fetchJson`, `log`.
  - It returns an object with this API:
    - `enabled` (getter)
    - `init(manifestUrl?) → Promise<void>`
    - `loadTexture(id, role) → Promise<Texture|null>`
    - `loadPBR(id) → Promise<PbrSet|null>`, `peekPBR(id) → PbrSet|null`
    - `loadEquirect(id) → Promise<DataTexture|null>`, `peekEquirect(id)`
    - `loadHDRI(id) → Promise<Texture|null>` (PMREM)
    - `loadGLTF(ref) → Promise<Object3D|null>` (a fresh clone per call), `peekGLTF(ref) → Object3D|null` (a fresh clone)
    - `loadLUT(id) → Promise<{texture3D}|null>`, `peekLUT(id)`
    - `preload(list: {kind:'pbr'|'equirect'|'hdri'|'gltf'|'lut', id}[]) → Promise<void>`
    - `setAnisotropy(n)`
    - `textures() → Texture[]`
- `PbrSet = { map, normalMap, roughnessMap, aoMap, metalnessMap|null }`, where `roughnessMap` and `aoMap` are the same ORM texture.
- `AssetLoaders = { texture(url), hdr(url), gltf(url) → {scene}, lut(url) → {texture3D}, pmrem?(equirect), clone?(scene) }`

- [ ] **Step 1: Write the failing test** `test/unit/assets.test.mjs`

```js
// @ts-check
// src/assets/assets.js — the facade's contract. Everything the game draws from
// the asset pipeline has a procedural twin, and this is the seam between them:
// every load resolves to null (never rejects) on a missing id, a missing file
// or a throwing decoder, warns ONCE per asset, and `enabled: false` (the
// ?noassets=1 switch) never touches a loader at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAssets } from '../../src/assets/assets.js';

const pbrFiles = (id) => ['diff', 'nor', 'orm'].map((role) => ({ path: `assets/pbr/${id}/${id}_${role}.jpg`, role }));
const MANIFEST = {
  entries: [
    { id: 'rock', kind: 'pbr', hasMetal: false, files: pbrFiles('rock') },
    { id: 'steel', kind: 'pbr', hasMetal: true, files: pbrFiles('steel') },
    { id: 'gone', kind: 'pbr', hasMetal: false, files: pbrFiles('gone') },
    { id: 'city_2k', kind: 'hdri', files: [{ path: 'assets/hdri/city_2k.hdr', role: 'hdr' }] },
    { id: 'pack', kind: 'gltf', files: [{ path: 'assets/props/pack/cup.glb', role: 'model', name: 'cup' }] },
    { id: 'grade', kind: 'lut', files: [{ path: 'assets/luts/grade.cube', role: 'cube' }] },
  ],
};

function make({ enabled = true, missing = ['/gone/'], manifest = MANIFEST } = {}) {
  const calls = [];
  const logs = [];
  const miss = (url) => missing.some((m) => url.includes(m));
  const hit = (url) => { calls.push(url); if (miss(url)) throw new Error(`404 ${url}`); };
  /** @type {import('../../src/assets/assets.js').AssetLoaders} */
  const loaders = {
    texture: async (url) => { hit(url); const t = new THREE.Texture(); t.name = url; return t; },
    hdr: async (url) => { hit(url); return new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType); },
    gltf: async (url) => {
      hit(url);
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
      return { scene };
    },
    lut: async (url) => { hit(url); return { texture3D: new THREE.Data3DTexture(new Uint8Array(32), 2, 2, 2) }; },
    pmrem: (eq) => { const t = new THREE.Texture(); t.userData.from = eq; return t; },
  };
  const assets = createAssets({
    loaders, enabled, log: (m) => logs.push(m),
    fetchJson: async () => { if (!manifest) throw new Error('HTTP 404'); return manifest; },
  });
  return { assets, calls, logs };
}

test('a PBR set: sRGB on the albedo only, repeat wrapping, ORM shared by roughness + AO', async () => {
  const { assets } = make();
  await assets.init();
  const set = await assets.loadPBR('rock');
  assert.ok(set);
  assert.equal(set.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(set.normalMap.colorSpace, THREE.NoColorSpace, 'normals are data — an sRGB decode flattens them');
  assert.equal(set.roughnessMap.colorSpace, THREE.NoColorSpace);
  assert.equal(set.roughnessMap, set.aoMap);
  assert.equal(set.map.wrapS, THREE.RepeatWrapping);
  assert.equal(set.metalnessMap, null, 'no metal channel → the material keeps its metalness scalar');
  assert.equal((await assets.loadPBR('steel')).metalnessMap, (await assets.loadPBR('steel')).roughnessMap);
});

test('an id missing from the manifest resolves to null and warns once', async () => {
  const { assets, logs, calls } = make();
  await assets.init();
  assert.equal(await assets.loadPBR('nope'), null);
  assert.equal(await assets.loadPBR('nope'), null);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /nope/);
  assert.equal(calls.length, 0, 'never requests a file the manifest does not list — a 404 is a console error in the browser');
});

test('a file that fails to load resolves to null, warns once, and is not retried', async () => {
  const { assets, logs, calls } = make();
  await assets.init();
  assert.equal(await assets.loadPBR('gone'), null);
  const before = calls.length;
  assert.equal(await assets.loadPBR('gone'), null);
  assert.equal(calls.length, before, 'the failed promise is cached');
  assert.equal(logs.length, 1);
});

test('enabled:false (?noassets=1) never calls a loader and resolves everything to null', async () => {
  const { assets, calls, logs } = make({ enabled: false });
  await assets.init();
  assert.equal(assets.enabled, false);
  assert.equal(await assets.loadPBR('rock'), null);
  assert.equal(await assets.loadEquirect('city_2k'), null);
  assert.equal(await assets.loadGLTF('pack/cup'), null);
  assert.equal(await assets.loadLUT('grade'), null);
  assert.equal(calls.length, 0);
  assert.equal(logs.length, 1, 'one line says the pipeline is off');
});

test('peek* is null until preloaded, then synchronous', async () => {
  const { assets } = make();
  await assets.init();
  assert.equal(assets.peekPBR('rock'), null);
  await assets.preload([{ kind: 'pbr', id: 'rock' }, { kind: 'equirect', id: 'city_2k' }, { kind: 'gltf', id: 'pack/cup' }, { kind: 'lut', id: 'grade' }]);
  assert.ok(assets.peekPBR('rock')?.map);
  assert.ok(assets.peekEquirect('city_2k'));
  assert.ok(assets.peekGLTF('pack/cup'));
  assert.ok(assets.peekLUT('grade')?.texture3D);
});

test('every loadGLTF / peekGLTF returns its own clone', async () => {
  const { assets } = make();
  await assets.init();
  const a = await assets.loadGLTF('pack/cup');
  const b = await assets.loadGLTF('pack/cup');
  const c = assets.peekGLTF('pack/cup');
  assert.ok(a && b && c);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.equal(a.children.length, 1);
  assert.equal(await assets.loadGLTF('pack/saucer'), null, 'a model name the pack does not have');
});

test('loadEquirect marks the mapping; loadHDRI hands back the PMREM texture', async () => {
  const { assets } = make();
  await assets.init();
  const eq = await assets.loadEquirect('city_2k');
  assert.equal(eq.mapping, THREE.EquirectangularReflectionMapping);
  const pm = await assets.loadHDRI('city_2k');
  assert.equal(pm.userData.from, eq);
});

test('setAnisotropy reaches textures that are already loaded', async () => {
  const { assets } = make();
  await assets.init();
  const set = await assets.loadPBR('rock');
  assets.setAnisotropy(8);
  assert.equal(set.map.anisotropy, 8);
  assert.equal(set.normalMap.anisotropy, 8);
  const later = await assets.loadPBR('steel');
  assert.equal(later.map.anisotropy, 8, 'and to textures loaded after');
  assert.ok(assets.textures().includes(set.map));
});

test('loadTexture fetches one map of an entry by role', async () => {
  const { assets } = make();
  await assets.init();
  const t = await assets.loadTexture('rock', 'diff');
  assert.match(t.name, /rock_diff\.jpg$/);
  assert.equal(t.colorSpace, THREE.SRGBColorSpace);
  assert.equal(await assets.loadTexture('rock', 'height'), null);
});

test('a manifest that fails to load degrades every asset to null', async () => {
  const { assets, logs, calls } = make({ manifest: null });
  await assets.init();
  assert.equal(await assets.loadPBR('rock'), null);
  assert.equal(calls.length, 0);
  assert.ok(logs.some((l) => /manifest/.test(l)));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/assets.test.mjs`
Expected: FAIL, `Cannot find module …/src/assets/assets.js`

- [ ] **Step 3: Implement** `src/assets/assets.js`

```js
// @ts-check
// The asset facade: the ONE door every binary asset (HDRI, PBR set, glTF prop,
// colour LUT) comes through.
//
// HYBRID BY CONTRACT. Every loader resolves to `null` on any failure — an id
// the manifest does not list, a file missing from disk, a decoder that throws,
// or `?noassets=1` — logs ONE warning per asset, and never rejects. Callers
// branch on null and build the procedural version the game shipped with, so a
// broken asset can cost looks but never the boot.
//
// Nothing is requested unless assets/manifest.json lists it: the browser logs
// every 404 as a console error, and the e2e suite treats a console error as a
// failure.
//
// Node-safe: imports three core only. The real loaders (GLTFLoader, HDRLoader,
// LUTCubeLoader, PMREM) are injected — src/assets/loaders.js builds them in the
// browser — so unit tests drive this with fakes.
import * as THREE from 'three';

/** @typedef {{path:string, role:string, name?:string, bytes?:number, sha256?:string}} ManifestFile */
/** @typedef {{id:string, kind:string, hasMetal?:boolean, files:ManifestFile[]}} ManifestEntry */
/**
 * @typedef {{map:THREE.Texture, normalMap:THREE.Texture, roughnessMap:THREE.Texture,
 *            aoMap:THREE.Texture, metalnessMap:THREE.Texture|null}} PbrSet
 */
/**
 * @typedef {object} AssetLoaders
 * @property {(url:string) => Promise<THREE.Texture>} texture 8-bit image (JPEG/PNG)
 * @property {(url:string) => Promise<THREE.DataTexture>} hdr float equirect (.hdr)
 * @property {(url:string) => Promise<{scene: THREE.Object3D}>} gltf
 * @property {(url:string) => Promise<{texture3D: THREE.Data3DTexture}>} lut .cube
 * @property {(equirect: THREE.Texture) => THREE.Texture} [pmrem] equirect → PMREM
 * @property {(scene: THREE.Object3D) => THREE.Object3D} [clone] deep clone (skeleton-aware in the browser)
 */
/** @typedef {'pbr'|'equirect'|'hdri'|'gltf'|'lut'} AssetKind */

/**
 * @param {{
 *   loaders?: AssetLoaders | Promise<AssetLoaders|null> | null,
 *   enabled?: boolean,
 *   base?: string,
 *   fetchJson?: (url:string) => Promise<any>,
 *   log?: (msg:string) => void,
 * }} [opts]
 */
export function createAssets(opts = {}) {
  const enabled = opts.enabled !== false;
  const base = opts.base ?? '/';
  const log = opts.log ?? ((m) => console.warn(m));
  const fetchJson = opts.fetchJson ?? (async (url) => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });

  /** @type {Map<string, ManifestEntry>} */
  const entries = new Map();
  /** @type {Map<string, Promise<any>>} */
  const pending = new Map();
  /** @type {Map<string, any>} */
  const done = new Map();
  const warned = new Set();
  /** @type {Set<THREE.Texture>} */
  const textures = new Set();
  let anisotropy = 1;
  /** @type {AssetLoaders|null} */
  let resolved = null;

  const warnOnce = (key, msg) => {
    if (warned.has(key)) return;
    warned.add(key);
    log(`[assets] ${msg}`);
  };
  const loaders = async () => {
    resolved ??= (await opts.loaders) ?? null;
    if (!resolved) throw new Error('no asset loaders');
    return resolved;
  };
  const url = (/** @type {ManifestFile} */ f) => `${base}${f.path}`;
  const cloneScene = (/** @type {THREE.Object3D} */ s) => (resolved?.clone ?? ((x) => x.clone(true)))(s);

  /** @param {string} id @param {string} kind */
  function entry(id, kind) {
    const e = entries.get(id);
    if (!e) throw new Error(`"${id}" is not in assets/manifest.json`);
    if (e.kind !== kind) throw new Error(`"${id}" is a ${e.kind}, not a ${kind}`);
    return e;
  }
  /** @param {ManifestEntry} e @param {string} role @param {string} [name] */
  function file(e, role, name) {
    const f = e.files.find((x) => x.role === role && (name === undefined || x.name === name));
    if (!f) throw new Error(`"${e.id}" has no ${name ? `${role} "${name}"` : role} file`);
    return f;
  }
  /** Resolve once per key; the promise never rejects. */
  function once(key, make) {
    let p = pending.get(key);
    if (p) return p;
    p = (async () => {
      if (!enabled) return null;
      try {
        const v = (await make()) ?? null;
        done.set(key, v);
        return v;
      } catch (err) {
        done.set(key, null);
        warnOnce(key, `${key} unavailable (${err instanceof Error ? err.message : err}) — using the procedural fallback`);
        return null;
      }
    })();
    pending.set(key, p);
    return p;
  }
  /** @param {THREE.Texture} t @param {boolean} srgb */
  const prep = (t, srgb) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
    textures.add(t);
    return t;
  };
  /** 'pack/model' → ['pack', 'model'] @param {string} ref */
  const splitRef = (ref) => {
    const i = ref.indexOf('/');
    if (i <= 0) throw new Error(`"${ref}" is not a <pack>/<model> reference`);
    return [ref.slice(0, i), ref.slice(i + 1)];
  };

  const api = {
    get enabled() { return enabled; },

    /** Read the manifest. Nothing loads before this settles. */
    async init(manifestUrl = `${base}assets/manifest.json`) {
      if (!enabled) {
        log('[assets] disabled (?noassets=1) — every surface uses its procedural fallback');
        return;
      }
      try {
        const m = await fetchJson(manifestUrl);
        for (const e of m?.entries ?? []) entries.set(e.id, e);
      } catch (err) {
        warnOnce('manifest', `manifest unavailable (${err instanceof Error ? err.message : err}) — every asset falls back to procedural`);
      }
    },

    /** @param {string} id @param {string} role e.g. 'diff' */
    loadTexture(id, role) {
      return once(`texture:${id}:${role}`, async () => {
        const e = entries.get(id);
        if (!e) throw new Error(`"${id}" is not in assets/manifest.json`);
        const t = await (await loaders()).texture(url(file(e, role)));
        return prep(t, role === 'diff');
      });
    },

    /** @param {string} id @returns {Promise<PbrSet|null>} */
    loadPBR(id) {
      return once(`pbr:${id}`, async () => {
        const e = entry(id, 'pbr');
        const L = await loaders();
        const [map, normalMap, orm] = await Promise.all(['diff', 'nor', 'orm'].map((r) => L.texture(url(file(e, r)))));
        prep(map, true);
        prep(normalMap, false);
        prep(orm, false);
        return { map, normalMap, roughnessMap: orm, aoMap: orm, metalnessMap: e.hasMetal ? orm : null };
      });
    },
    /** @param {string} id @returns {PbrSet|null} */
    peekPBR: (id) => done.get(`pbr:${id}`) ?? null,

    /** @param {string} id @returns {Promise<THREE.DataTexture|null>} */
    loadEquirect(id) {
      return once(`equirect:${id}`, async () => {
        const e = entry(id, 'hdri');
        const t = await (await loaders()).hdr(url(file(e, 'hdr')));
        t.mapping = THREE.EquirectangularReflectionMapping;
        textures.add(t);
        return t;
      });
    },
    /** @param {string} id */
    peekEquirect: (id) => done.get(`equirect:${id}`) ?? null,

    /** The prefiltered (PMREM) environment for an HDRI. @param {string} id */
    loadHDRI(id) {
      return once(`hdri:${id}`, async () => {
        const eq = await api.loadEquirect(id);
        if (!eq) throw new Error('its equirect did not load');
        const L = await loaders();
        if (!L.pmrem) throw new Error('no PMREM generator');
        return L.pmrem(eq);
      });
    },

    /** @param {string} ref 'pack/model' @returns {Promise<THREE.Object3D|null>} a fresh clone */
    loadGLTF(ref) {
      return once(`gltf:${ref}`, async () => {
        const [pack, name] = splitRef(ref);
        const g = await (await loaders()).gltf(url(file(entry(pack, 'gltf'), 'model', name)));
        return g.scene;
      }).then((scene) => (scene ? cloneScene(scene) : null));
    },
    /** @param {string} ref @returns {THREE.Object3D|null} a fresh clone */
    peekGLTF(ref) {
      const s = done.get(`gltf:${ref}`);
      return s ? cloneScene(s) : null;
    },

    /** @param {string} id */
    loadLUT(id) {
      return once(`lut:${id}`, async () => (await loaders()).lut(url(file(entry(id, 'lut'), 'cube'))));
    },
    /** @param {string} id */
    peekLUT: (id) => done.get(`lut:${id}`) ?? null,

    /** @param {{kind: AssetKind, id: string}[]} list */
    async preload(list) {
      const by = { pbr: api.loadPBR, equirect: api.loadEquirect, hdri: api.loadHDRI, gltf: api.loadGLTF, lut: api.loadLUT };
      await Promise.all(list.map(({ kind, id }) => {
        const fn = by[kind];
        if (!fn) { warnOnce(`kind:${kind}`, `preload: unknown asset kind "${kind}"`); return null; }
        return fn(id);
      }));
    },

    /** @param {number} n */
    setAnisotropy(n) {
      anisotropy = n;
      for (const t of textures) {
        if (t.isDataTexture) continue;   // float equirects are sampled by PMREM, not at grazing angles
        t.anisotropy = n;
        t.needsUpdate = true;
      }
    },

    /** Every texture the facade has created (for the texture-memory log). */
    textures: () => [...textures],
  };
  return api;
}
```

- [ ] **Step 4: MIME types.** In `tools/serve.mjs`, add these to the `MIME` map, after `'.txt'`:

```js
  // v0.7 asset pipeline (src/assets/assets.js). .hdr stays octet-stream: it is
  // read as an ArrayBuffer by HDRLoader, and there is no registered type.
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.cube': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/unit/assets.test.mjs && npm test && npm run lint`
Expected: 10 facade tests PASS, and everything else stays green.

- [ ] **Step 6: Commit**

```bash
git add src/assets/assets.js test/unit/assets.test.mjs tools/serve.mjs
git commit -F - <<'EOF'
feat(assets): the asset facade — null-on-failure loaders, warn once, ?noassets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Browser loaders, app wiring, and the `?noassets=1` smoke test

**Files:**
- Create: `src/assets/loaders.js`
- Modify: `src/core/app.js`, `test/smoke/smoke.spec.mjs`

**Interfaces:**
- Consumes: `createAssets` (Task 7)
- Produces:
  - `browserLoaders(renderer) → Promise<AssetLoaders>`
  - `app.assets` (the facade) and `app.assetsReady` (a Promise that never rejects)
  - The `?noassets=1` flag
  - `bootToRun(page, url = URL)` (the smoke-spec helper gains an optional URL)

- [ ] **Step 1: Implement** `src/assets/loaders.js`

```js
// @ts-check
// Browser-side loaders for src/assets/assets.js. Kept out of the facade so the
// facade stays importable under `node --test`, and imported lazily so a boot
// that never loads an asset (?noassets=1) never fetches GLTFLoader and friends.
import * as THREE from 'three';

/** Where DRACOLoader fetches its wasm decoder (vendored by tools/vendor-three.mjs). */
const DRACO_PATH = './vendor/three/addons/libs/draco/gltf/';

/**
 * @param {THREE.WebGLRenderer} renderer
 * @returns {Promise<import('./assets.js').AssetLoaders>}
 */
export async function browserLoaders(renderer) {
  const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }, { HDRLoader }, { LUTCubeLoader }, { clone }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/DRACOLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
    import('three/addons/loaders/HDRLoader.js'),
    import('three/addons/loaders/LUTCubeLoader.js'),
    import('three/addons/utils/SkeletonUtils.js'),
  ]);
  const textures = new THREE.TextureLoader();
  // Draco + meshopt are wired now so sub-project 3's compressed character
  // GLBs load through the same facade; the v0.7 Kenney props need neither.
  const gltf = new GLTFLoader()
    .setDRACOLoader(new DRACOLoader().setDecoderPath(DRACO_PATH))
    .setMeshoptDecoder(MeshoptDecoder);
  const hdr = new HDRLoader();   // HalfFloat by default — linear HDR, the right input for PMREM
  const lut = new LUTCubeLoader();
  /** @type {THREE.PMREMGenerator|null} */
  let pmrem = null;
  return {
    texture: (url) => textures.loadAsync(url),
    hdr: (url) => hdr.loadAsync(url),
    gltf: (url) => gltf.loadAsync(url),
    lut: (url) => lut.loadAsync(url),
    pmrem: (equirect) => {
      pmrem ??= new THREE.PMREMGenerator(renderer);
      return pmrem.fromEquirectangular(equirect).texture;
    },
    // skeleton-aware: a plain .clone(true) shares bones between copies of a rig
    clone: (scene) => clone(scene),
  };
}
```

- [ ] **Step 2: Wire it in `src/core/app.js`**
  - Add these imports next to the other `../scene3d/…` imports:

```js
import { createAssets } from '../assets/assets.js';
import { browserLoaders } from '../assets/loaders.js';
```

  - In the `App` constructor, directly after `this.stage = new Stage(…);`, insert:

```js
    // The asset facade. `?noassets=1` forces every loader to its procedural
    // fallback without a single request — the switch the e2e suite uses to
    // prove the game boots with no asset pipeline at all. A loader set that
    // fails to import degrades the same way: warned once, then null.
    const noAssets = params.get('noassets') === '1';
    this.assets = createAssets({
      enabled: !noAssets,
      loaders: noAssets ? null : browserLoaders(this.stage.renderer).catch((err) => {
        console.warn('[assets] loaders unavailable — procedural fallbacks only', err);
        return null;
      }),
    });
    /** settles (never rejects) once the manifest is read */
    this.assetsReady = this.assets.init();
```

  - In `startRun()`, directly before `this.world = new World3D(…)`, insert `await this.assetsReady;`.

- [ ] **Step 3: Smoke test.** In `test/smoke/smoke.spec.mjs`:
  - Change the helper's signature from `async function bootToRun(page) {` to `async function bootToRun(page, url = URL) {`.
  - In its body, change `await page.goto(URL, …)` to `await page.goto(url, …)`.
  - Then add this test inside the `test.describe` block, after `'boots to a live run with no console errors'`:

```js
  test('?noassets=1 boots on procedural fallbacks with no console errors', async ({ page }) => {
    // The asset pipeline is an enhancement. With it switched off entirely the
    // game must still boot, build every floor and render — the same path a
    // clone with a missing or corrupt asset takes.
    const errors = await bootToRun(page, `${URL}&noassets=1`);
    const state = await page.evaluate(() => ({
      enabled: window.__ncld.app.assets.enabled,
      mode: window.__ncld.app.mode,
      floor: window.__ncld.app.world.activeFloor,
    }));
    expect(state.enabled).toBe(false);
    expect(state.mode).toBe('run');
    expect(state.floor).toBe('penthouse');
    expect(errors, `console errors during a no-assets boot:\n${errors.join('\n')}`).toEqual([]);
  });
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run lint && npm run test:e2e`
Expected: all green. The e2e count goes up by one.

- [ ] **Step 5: Commit**

```bash
git add src/assets/loaders.js src/core/app.js test/smoke/smoke.spec.mjs
git commit -F - <<'EOF'
feat(assets): browser loader set, app.assets, and a ?noassets=1 smoke test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: New screenshot shots and the "before" set

The README's before/after pairs (rc.1) need the v0.6 look captured **before** any visual change lands, so this task runs before alpha.2.

**Files:**
- Modify: `tools/screenshots.mjs`
- Create: `docs/screenshots/v0.6/{03-penthouse-lounge,14-bar,15-rooftop,16-exterior}.jpg`

**Interfaces:**
- Produces:
  - New shots `bar` → `14-bar`, `rooftop` → `15-rooftop` and `exterior` → `16-exterior`.
  - The CLI flag `--out <dir>`.

- [ ] **Step 1: Add the shots.** In `tools/screenshots.mjs`, append these three entries to the `SHOTS` array (before its closing `];`):

```js
  {
    // v0.7 before/after pairs: the bar is marble, metal and wood — the three
    // surfaces the PBR pass changes most
    name: 'bar', file: '14-bar', size: WIDE,
    stage: async (page) => {
      await quiet(page);
      await game(page, (app) => {
        app.cameraRig.setMode('director');
        app.cameraRig.orbit.maxDistance = 60;
        app.cameraRig.orbit.target.set(4.6, 1.05, -4.6);
        app.stage.camera.position.set(1.4, 1.75, -0.9);
        app.cameraRig.orbit.update();
      });
      await sleep(3000);
    },
  },
  {
    name: 'rooftop', file: '15-rooftop', size: WIDE,
    stage: async (page) => {
      await quiet(page);
      await game(page, (app) => {
        app.setFloor('rooftop');
        app.cameraRig.setMode('director');
        app.cameraRig.orbit.maxDistance = 60;
        app.cameraRig.orbit.target.set(203, 0.8, 0.5);    // rooftop floor offset is x+200
        app.stage.camera.position.set(193.5, 4.2, 7.2);
        app.cameraRig.orbit.update();
      });
      await sleep(4000);
    },
  },
  {
    // through the curtain wall: skyline, towers, rain
    name: 'exterior', file: '16-exterior', size: WIDE,
    stage: async (page) => {
      await quiet(page);
      await game(page, (app) => {
        app.cameraRig.setMode('director');
        app.cameraRig.orbit.maxDistance = 60;
        app.cameraRig.orbit.target.set(3, 3.5, 30);
        app.stage.camera.position.set(2.2, 1.7, 6.4);
        app.cameraRig.orbit.update();
      });
      await sleep(4000);
    },
  },
```

- [ ] **Step 2: Add `--out`.** Make these three edits:
  - Change `async function capture(browser, shot) {` to `async function capture(browser, shot, outDir = OUT) {`.
  - Inside `capture`, change the output line from

    ```js
    const out = join(OUT, `${shot.file}.jpg`);
    ```

    to

    ```js
    const out = join(outDir, `${shot.file}.jpg`);
    ```
  - In `main()`, replace the lines from `const wanted = args.length` down to the `if (unknown.length) throw …` line with the block below. Also change `mkdirSync(OUT, { recursive: true });` to `mkdirSync(outDir, { recursive: true });` and `try { await capture(browser, shot); }` to `try { await capture(browser, shot, outDir); }`.

```js
  // `--out <dir>` writes somewhere other than docs/screenshots — used for the
  // v0.6 "before" set the README's before/after pairs compare against
  const outAt = args.indexOf('--out');
  const outDir = outAt >= 0 ? args[outAt + 1] : OUT;
  if (outAt >= 0 && !outDir) throw new Error('--out needs a directory');
  const names = outAt >= 0 ? args.filter((_, i) => i !== outAt && i !== outAt + 1) : args;
  const wanted = names.length
    ? SHOTS.filter((s) => names.includes(s.name) || names.includes(s.file))
    : SHOTS;
  const unknown = names.filter((a) => !SHOTS.some((s) => s.name === a || s.file === a));
  if (unknown.length) throw new Error(`unknown shot(s): ${unknown.join(', ')} — try --list`);
```

  - Add this line to the header usage comment:

```js
//   node tools/screenshots.mjs --out docs/screenshots/v0.6 bar   # somewhere else
```

- [ ] **Step 3: Capture the before set.** Start the server in another terminal (`node tools/serve.mjs 8420`), then run:

`node tools/screenshots.mjs --out docs/screenshots/v0.6 penthouse-lounge bar rooftop exterior`

Expected: four `✓ docs/screenshots/v0.6/<file>.jpg 1710x907 …KB` lines.

Open each image and check the framing:
- The bar counter and shelves fill the bar shot.
- The helipad and planters show in the rooftop shot.
- The glass, skyline and towers show in the exterior shot.

If a shot misses its subject, adjust that shot's `target`/`position` numbers and re-capture only that shot.

- [ ] **Step 4: Commit**

```bash
git add tools/screenshots.mjs docs/screenshots/v0.6
git commit -F - <<'EOF'
docs(screenshots): bar/rooftop/exterior shots, --out, and the v0.6 "before" set

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: alpha.1 release bookkeeping

**Files:**
- Modify: `package.json`, `CHANGELOG.md`, `README.md`, `AGENTS.md`, `docs/development.md`, `docs/systems/scene-audio-ui.md`

- [ ] **Step 1: Version.** Set `package.json` `"version"` to `"0.7.0-alpha.1"`.

- [ ] **Step 2: CHANGELOG.** Add at the top, below the file's intro paragraph and above the newest existing entry. Use today's date (`date +%F`).

```markdown
## [0.7.0-alpha.1] — YYYY-MM-DD — Plumbing

The first stage of sub-project 2 (asset pipeline + render quality). Nothing
looks different yet: this release adds the tools and the runtime seam the
rest of 0.7 loads real assets through, with the procedural look as the
fallback everywhere.

### Added
- **`tools/vendor-three.mjs`** — vendors three@0.185.0 example addons
  (GLTFLoader, DRACOLoader + the glTF Draco decoder, meshopt, HDRLoader,
  LUTCubeLoader, BufferGeometryUtils, SkeletonUtils, SMAAPass, LUTPass,
  RoundedBoxGeometry) from the pinned npm tarball, following relative imports
  transitively. It refuses an unresolved import, records every file in
  `vendor/three/addons/VENDORED.json`, and generates `node_modules/three/addons/*`
  shims so unit tests import `three/addons/…` exactly like the browser.
- **`tools/fetch-assets.mjs` + `assets/manifest.json`** — downloads and
  transforms the CC0 set: Poly Haven's `shanghai_bund` HDRI (1K + 2K), nine
  1K PBR sets (AO/roughness/metalness packed into one ORM map), a selection of
  Kenney Furniture Kit and City Kit (Industrial) models, and a generated
  neon-noir `.cube` LUT. Every file is recorded with sha256 + bytes; the tool
  is idempotent and `--verify` checks without downloading.
- **`tools/lint-assets.mjs`** (in `npm run lint`) — manifest schema, sha256 of
  every file, no stray files, CC0 on every entry, and the **40 MB budget**
  (also asserted by `test/unit/asset-manifest.test.mjs`).
- **`src/assets/assets.js`** — the asset facade. Every loader resolves to
  `null` on failure and warns once, so every caller falls back to procedural;
  `?noassets=1` switches the pipeline off without a single request.
- New screenshot shots `bar`, `rooftop`, `exterior`, a `--out` flag, and the
  v0.6 "before" set in `docs/screenshots/v0.6/`.
- `.glb`, `.gltf`, `.bin`, `.cube`, `.wasm` MIME types in `tools/serve.mjs`.
```

- [ ] **Step 3: README.**
  - In `## Development`'s command block, after the `node tools/lint-config.mjs` line, add:

```bash
node tools/lint-assets.mjs            # assets/manifest.json: sha256, CC0 licences, 40 MB budget
node tools/fetch-assets.mjs --verify  # check the committed CC0 assets (no download)
node tools/fetch-assets.mjs           # (re)fetch + transform assets listed in the manifest (dev, needs network)
node tools/vendor-three.mjs           # (re)vendor three@0.185.0 addons + Node shims (dev, needs network)
```

  - Update the two test-count comments to the numbers `npm test` and `npm run test:e2e` print.
  - Replace the sentence ``No bundler. Plain ES modules + an import map; `vendor/three.module.js` is the only vendored library.`` with:

``No bundler. Plain ES modules + an import map; three.js and the handful of its example addons listed in `vendor/three/addons/VENDORED.json` are the only vendored code.``

  - In the `<details>` project layout, add a line under `index.html`:

```
assets/               CC0 assets from tools/fetch-assets.mjs (manifest.json: sha256, licence, 40 MB budget)
```

  - Also append `src/assets/            the asset facade (null-on-failure loaders) + browser loader set` after the `src/core/` line.
  - In `## License`, append this sentence:

`The HDRI and PBR textures are CC0 from Poly Haven and the prop models are CC0 from Kenney; each is listed with its source in assets/manifest.json. The three.js example addons in vendor/three/addons/ are MIT, like three.js itself.`

- [ ] **Step 4: AGENTS.md.**
  - Current version line: change `**0.6.0-rc.1**` to `**0.7.0-alpha.1**`, and change the rest of the sentence to `, sub-project 2 of the 7-part upgrade (asset pipeline + render quality).`.
  - In the `## Run / test / lint` block, add the two lines below:

```bash
npm run assets:verify       # sha256-check the committed CC0 assets (no download)
node tools/fetch-assets.mjs # fetch/transform manifest assets; node tools/vendor-three.mjs for three addons
```

  - In `## Architecture spine`, add this bullet:

```markdown
- **`src/assets/assets.js`** — the only way a binary asset (HDRI, PBR set,
  glTF, LUT) enters the game. Every loader resolves to `null` on failure and
  warns once; every caller MUST handle `null` by building the procedural
  version. `?noassets=1` forces that path for the whole game. Assets are added
  only through `assets/manifest.json` + `tools/fetch-assets.mjs` (CC0 only,
  40 MB budget, sha256-checked by `npm run lint`).
```

  - In `## Conventions`, change the `vendor/three.module.js` sentence to:

``Plain ES modules + an import map. No bundler, no framework. `vendor/three.module.js` plus the addons recorded in `vendor/three/addons/VENDORED.json` are the only vendored runtime code — add addons with `tools/vendor-three.mjs`, never by hand. Node resolves `three/addons/*` through the generated `node_modules/three/addons/` shims.``

  - In `## Roadmap`, change item 1 to `1. Content cleanse + bonds (v0.6, released)` and item 2 to `2. Asset pipeline + render quality (this sub-project, at alpha.1)`.

- [ ] **Step 5: docs.**
  - In `docs/development.md`, add a section `## Assets and vendored addons` covering:
    - the four commands from Step 3 and what each writes;
    - that `assets/manifest.json` is the source of truth (id, kind, source, licence, urls, transform, files with sha256);
    - that the 40 MB budget and CC0 licence are enforced by `npm run lint`;
    - the four-step recipe to add an asset: add an entry with `"files": []`, run `node tools/fetch-assets.mjs <id>`, run `npm run lint`, commit the manifest and the files;
    - that the game never downloads at runtime.
  - In `docs/systems/scene-audio-ui.md`, add a subsection `### Asset facade (src/assets/)` covering:
    - `createAssets`, its methods and the null-on-failure contract;
    - `?noassets=1`;
    - `browserLoaders` (GLTF + Draco + meshopt, HDR, LUT, PMREM, SkeletonUtils clone);
    - that nothing outside the manifest is ever requested, because a browser 404 is a console error.

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run lint && npm run test:e2e`
Expected: all green.

```bash
git add package.json CHANGELOG.md README.md AGENTS.md docs/development.md docs/systems/scene-audio-ui.md
git commit -F - <<'EOF'
docs: v0.7.0-alpha.1 — asset pipeline, vendored addons, facade

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---
# Stage alpha.2: PBR materials, world-scale UVs, bevels

### Task 11: Seeded texGen and a fake canvas DOM for Node

**Files:**
- Create: `test/unit/helpers/dom.mjs`, `src/scene3d/materials/cityWindows.js`, `test/unit/texgen.test.mjs`
- Modify: `src/scene3d/materials/texGen.js`, `src/scene3d/tower/zoneBuilder.js` (move `cityWindowsTexture` out)

**Interfaces:**
- Consumes: `hashStr`, `mulberry32` from `src/core/rng.js`
- Produces:
  - `recipeRandom(key: string) → () => number` in texGen.js
  - The texGen recipe draw signature becomes `(ctx, size, rand)`
  - `cityWindowsTexture() → THREE.CanvasTexture`, moved to `cityWindows.js`
  - `installFakeDom({ record?: string[] }) → JSDOM` for tests

- [ ] **Step 1: Create the test helper** `test/unit/helpers/dom.mjs`

```js
// @ts-check
// Just enough DOM for the canvas texture generators to run under `node --test`:
// jsdom for document/canvas elements, and a 2D context that answers every call
// texGen makes. With `record`, every draw call and property write is logged as
// a string — two runs of a seeded generator must produce the same log.
// (Not a *.test.mjs file, so `npm test` does not run it on its own.)
import { JSDOM } from 'jsdom';

const fmt = (v) => (typeof v === 'number' ? v.toFixed(4) : typeof v === 'string' ? v : typeof v);

/** @param {Uint8ClampedArray} data */
function checksum(data) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/** @param {any} canvas @param {string[]|null} record */
function fakeCtx(canvas, record) {
  const note = (s) => { if (record) record.push(s); };
  const image = (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
  const target = {
    canvas,
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    getImageData: (x, y, w, h) => image(w, h),
    createImageData: (w, h) => image(w, h),
    putImageData: (img) => note(`putImageData(${checksum(img.data)})`),
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[/** @type {keyof typeof t} */ (k)];
      return (...args) => note(`${String(k)}(${args.map(fmt).join(',')})`);
    },
    set(t, k, v) { note(`${String(k)}=${fmt(v)}`); return true; },
  });
}

/** @param {{record?: string[]|null}} [opts] */
export function installFakeDom({ record = null } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const g = /** @type {any} */ (globalThis);
  g.window = dom.window;
  g.document = dom.window.document;
  g.HTMLElement = dom.window.HTMLElement;
  g.Image = dom.window.Image;
  dom.window.HTMLCanvasElement.prototype.getContext = function () { return /** @type {any} */ (fakeCtx(this, record)); };
  return dom;
}
```

- [ ] **Step 2: Write the failing test** `test/unit/texgen.test.mjs`

```js
// @ts-check
// src/scene3d/materials/texGen.js — procedural textures are SEEDED. They used to
// draw with Math.random(), so every boot painted a different concrete, a
// different wood grain and a different skyline: screenshots could never be
// compared, and a "looks wrong" report could not be reproduced. Each recipe now
// seeds its own stream from its cache key, so it paints the same pixels no
// matter what was generated before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './helpers/dom.mjs';

/** generate a few recipes in a FRESH module instance and return the draw log */
async function paint(tag, order) {
  const log = [];
  installFakeDom({ record: log });
  const tg = await import(`../../src/scene3d/materials/texGen.js?instance=${tag}`);
  const recipes = {
    concrete: () => tg.concreteTex('#181c2a', 1),
    wood: () => tg.woodTex('#2b1e18', 1),
    marble: () => tg.marbleTex('#353b4a', 1),
    tile: () => tg.tileTex('#11141f', '#05060a', 4, 1),
  };
  const byRecipe = {};
  for (const name of order) {
    const start = log.length;
    recipes[name]();
    byRecipe[name] = log.slice(start);
  }
  return byRecipe;
}

test('recipeRandom: the same key gives the same stream; different keys differ', async () => {
  installFakeDom();
  const { recipeRandom } = await import('../../src/scene3d/materials/texGen.js');
  const a = recipeRandom('wood:#2b1e18:1');
  const b = recipeRandom('wood:#2b1e18:1');
  const c = recipeRandom('wood:#2b1e18:2');
  const sa = [a(), a(), a()];
  assert.deepEqual(sa, [b(), b(), b()]);
  assert.notDeepEqual(sa, [c(), c(), c()]);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

test('a recipe paints identically across fresh module instances', async () => {
  const one = await paint('a', ['concrete', 'wood', 'marble', 'tile']);
  const two = await paint('b', ['concrete', 'wood', 'marble', 'tile']);
  assert.deepEqual(one, two);
  assert.ok(one.wood.length > 40, 'the log really recorded the grain strokes');
});

test('...and regardless of generation order', async () => {
  const fwd = await paint('c', ['concrete', 'wood', 'marble', 'tile']);
  const rev = await paint('d', ['tile', 'marble', 'wood', 'concrete']);
  assert.deepEqual(fwd.wood, rev.wood);
  assert.deepEqual(fwd.concrete, rev.concrete);
});

test('no Math.random left in the texture generators', () => {
  for (const f of ['src/scene3d/materials/texGen.js', 'src/scene3d/materials/cityWindows.js']) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /Math\.random/, f);
  }
});

test('the city-window canvas is seeded too', async () => {
  const logA = [];
  installFakeDom({ record: logA });
  (await import('../../src/scene3d/materials/cityWindows.js?instance=a')).cityWindowsTexture();
  const logB = [];
  installFakeDom({ record: logB });
  (await import('../../src/scene3d/materials/cityWindows.js?instance=b')).cityWindowsTexture();
  assert.deepEqual(logA, logB);
  assert.ok(logA.length > 50);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/unit/texgen.test.mjs`
Expected: FAIL. `recipeRandom` is not exported, and `cityWindows.js` does not exist.

- [ ] **Step 4: Seed `src/scene3d/materials/texGen.js`**
  - Replace the import line with:

```js
import * as THREE from 'three';
import { hashStr, mulberry32 } from '../../core/rng.js';
```

  - Add this directly after the `normalCache` declaration:

```js
/**
 * The random stream for ONE texture recipe, seeded by its cache key. Per key,
 * not one module-wide stream: a texture must not depend on which other
 * textures happened to be generated before it, or the same concrete would
 * change whenever a floor started building in a different order.
 * @param {string} key
 * @returns {() => number} floats in [0, 1)
 */
export function recipeRandom(key) {
  return mulberry32(hashStr(`texgen:${key}`));
}
```

  - In `make()`, change `drawFn(c.getContext('2d', { willReadFrequently: true }), size);` to:

```js
  drawFn(c.getContext('2d', { willReadFrequently: true }), size, recipeRandom(key));
```

  - Replace everything from `function noise(ctx, size, alpha, mono = true) {` to the end of the file with:

```js
/** @param {CanvasRenderingContext2D} ctx @param {number} size @param {number} alpha @param {() => number} rand */
function noise(ctx, size, alpha, rand, mono = true) {
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 255 * alpha;
    img.data[i] += n;
    img.data[i + 1] += mono ? n : (rand() - 0.5) * 255 * alpha;
    img.data[i + 2] += mono ? n : (rand() - 0.5) * 255 * alpha;
  }
  ctx.putImageData(img, 0, 0);
}

/** Dark concrete/plaster with subtle grime. */
export function concreteTex(tint = '#181c2a', repeat = 2) {
  return make(`concrete:${tint}:${repeat}`, 256, (ctx, s, rand) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.06, rand);
    // grime streaks
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = rand() > 0.5 ? '#000' : '#456';
      const x = rand() * s;
      ctx.fillRect(x, 0, 2 + rand() * 12, s);
    }
    ctx.globalAlpha = 1;
  }, { repeat });
}

/** Large dark floor tiles with grout lines and sheen variation. */
export function tileTex(tint = '#11141f', grout = '#05060a', tiles = 4, repeat = 3) {
  return make(`tile:${tint}:${tiles}:${repeat}`, 256, (ctx, s, rand) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.045, rand);
    ctx.strokeStyle = grout;
    ctx.lineWidth = 3;
    const step = s / tiles;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(s, i * step); ctx.stroke();
    }
    // per-tile sheen variance
    for (let x = 0; x < tiles; x++) for (let y = 0; y < tiles; y++) {
      ctx.fillStyle = `rgba(255,255,255,${rand() * 0.03})`;
      ctx.fillRect(x * step + 2, y * step + 2, step - 4, step - 4);
    }
  }, { repeat });
}

/** Brushed metal panels with seams. */
export function metalTex(tint = '#2a3040', repeat = 2) {
  return make(`metal:${tint}:${repeat}`, 256, (ctx, s, rand) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    // brush lines
    ctx.globalAlpha = 0.08;
    for (let y = 0; y < s; y += 2) {
      ctx.fillStyle = rand() > 0.5 ? '#fff' : '#000';
      ctx.fillRect(0, y, s, 1);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, s, s / 2);
    ctx.strokeRect(0, s / 2, s, s / 2);
  }, { repeat });
}

/** Fabric weave for upholstery. */
export function fabricTex(tint = '#2c2434', repeat = 4) {
  return make(`fabric:${tint}:${repeat}`, 128, (ctx, s, rand) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    ctx.globalAlpha = 0.12;
    for (let y = 0; y < s; y += 3) {
      ctx.fillStyle = (y / 3) % 2 ? '#000' : '#fff';
      ctx.fillRect(0, y, s, 1);
    }
    for (let x = 0; x < s; x += 3) {
      ctx.fillStyle = (x / 3) % 2 ? '#000' : '#fff';
      ctx.fillRect(x, 0, 1, s);
    }
    ctx.globalAlpha = 1;
    noise(ctx, s, 0.05, rand);
  }, { repeat });
}

/** Dark wood planks. */
export function woodTex(tint = '#2b1e18', repeat = 2) {
  return make(`wood:${tint}:${repeat}`, 256, (ctx, s, rand) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(${rand() > 0.5 ? '10,5,3' : '90,60,40'},${0.1 + rand() * 0.15})`;
      ctx.lineWidth = 1 + rand() * 2;
      const y = rand() * s;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.3, y + (rand() - 0.5) * 14, s * 0.7, y + (rand() - 0.5) * 14, s, y);
      ctx.stroke();
    }
    // plank seams
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(0, i * s / 4); ctx.lineTo(s, i * s / 4); ctx.stroke();
    }
  }, { repeat });
}

/** Veined marble for bar tops / vanity. */
export function marbleTex(tint = '#353b4a', repeat = 1) {
  return make(`marble:${tint}:${repeat}`, 256, (ctx, s, rand) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.05, rand);
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = `rgba(220,225,235,${0.06 + rand() * 0.10})`;
      ctx.lineWidth = 1 + rand() * 1.5;
      ctx.beginPath();
      let x = rand() * s, y = 0;
      ctx.moveTo(x, y);
      while (y < s) {
        x += (rand() - 0.5) * 40;
        y += 10 + rand() * 25;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, { repeat });
}
```

  - Update the `normalFor()` comment that mentions `per-pixel Math.random() noise`. It becomes `per-pixel seeded noise`.

- [ ] **Step 5: Create** `src/scene3d/materials/cityWindows.js`, moving the canvas out of zoneBuilder and seeding it:

```js
// @ts-check
// The exterior towers' lit-window texture. The canvas version is the fallback
// for assets/city/windows.jpg and the first frame before that image decodes.
// Seeded, so every run and every screenshot shows the same skyline windows.
import * as THREE from 'three';
import { hashStr, mulberry32 } from '../../core/rng.js';

export function cityWindowsTexture() {
  const rand = mulberry32(hashStr('city-windows'));
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  ctx.fillStyle = '#04050a';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      if (rand() < 0.42) {
        ctx.fillStyle = rand() < 0.16 ? '#ff6fc0' : (rand() < 0.5 ? '#6eefff' : '#ffd9a0');
        ctx.globalAlpha = 0.35 + rand() * 0.65;
        ctx.fillRect(x, y, 4, 3);
      }
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
```

In `src/scene3d/tower/zoneBuilder.js`:
- Delete the local `function cityWindowsTexture() { … }` (lines 15–34).
- Add `import { cityWindowsTexture } from '../materials/cityWindows.js';` after the `neon.js` import.

- [ ] **Step 6: Run the tests**

Run: `node --test test/unit/texgen.test.mjs && npm test`
Expected: 5 texgen tests PASS, and the whole suite stays green. `floorheight.test.mjs` still builds every floor.

- [ ] **Step 7: Commit**

```bash
git add test/unit/helpers/dom.mjs test/unit/texgen.test.mjs src/scene3d/materials/texGen.js src/scene3d/materials/cityWindows.js src/scene3d/tower/zoneBuilder.js
git commit -F - <<'EOF'
fix(texgen): seed every procedural texture from its recipe key

Math.random() painted a different concrete, grain and skyline every boot,
so screenshots could not be compared and visual reports could not be
reproduced. Each recipe now seeds its own mulberry32 stream from its cache
key; the city-window canvas moves to materials/cityWindows.js, also seeded.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 12: World-scale UVs

**Files:**
- Create: `src/scene3d/materials/worldUV.js`, `test/unit/worlduv.test.mjs`

**Interfaces:**
- Produces:
  - `boxProjectUVs(positions, normals, metresPerRepeat) → Float32Array` (pure)
  - `applyWorldUVs(geometry, metresPerRepeat) → geometry`
  - `applyWorldUVsTo(root: Object3D) → number` (count rewritten). It rewrites every unscaled box-type mesh whose material has `userData.metresPerRepeat`, once per geometry (`geometry.userData.worldUV`).

- [ ] **Step 1: Write the failing test** `test/unit/worlduv.test.mjs`

```js
// @ts-check
// src/scene3d/materials/worldUV.js — texel density that does not depend on
// object size. BoxGeometry maps its 0..1 UVs across every face, so the same
// texture stretched once over a 2.4 m counter and once over a 0.3 m shelf: the
// wood grain on the shelf was eight times finer. Box-projecting from the
// vertex positions gives one repeat per N metres everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { boxProjectUVs, applyWorldUVs, applyWorldUVsTo } from '../../src/scene3d/materials/worldUV.js';

/** span of one UV component over the vertices whose normal equals `n` */
function faceSpan(geo, n, comp) {
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < nor.count; i++) {
    if (nor.getX(i) !== n[0] || nor.getY(i) !== n[1] || nor.getZ(i) !== n[2]) continue;
    const v = comp === 0 ? uv.getX(i) : uv.getY(i);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi - lo;
}
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('a 2.4 m counter and a 0.3 m shelf get the same texel density', () => {
  const counter = applyWorldUVs(new THREE.BoxGeometry(2.4, 1, 0.6), 1.2);
  const shelf = applyWorldUVs(new THREE.BoxGeometry(0.3, 0.04, 0.25), 1.2);
  assert.ok(near(faceSpan(counter, [0, 0, 1], 0), 2.0), '2.4 m at 1.2 m per repeat = 2 repeats');
  assert.ok(near(faceSpan(shelf, [0, 0, 1], 0), 0.25));
  assert.ok(near(faceSpan(counter, [0, 0, 1], 0) / 2.4, faceSpan(shelf, [0, 0, 1], 0) / 0.3), 'repeats per metre match');
});

test('each face projects along its own plane', () => {
  const g = applyWorldUVs(new THREE.BoxGeometry(2, 3, 4), 1);
  assert.ok(near(faceSpan(g, [0, 1, 0], 0), 2), 'top: u runs along X');
  assert.ok(near(faceSpan(g, [0, 1, 0], 1), 4), 'top: v runs along Z');
  assert.ok(near(faceSpan(g, [1, 0, 0], 0), 4), 'side: u runs along Z');
  assert.ok(near(faceSpan(g, [1, 0, 0], 1), 3), 'side: v runs up Y');
  assert.ok(near(faceSpan(g, [0, 0, -1], 1), 3));
});

test('halving metres-per-repeat doubles the repeats', () => {
  const a = applyWorldUVs(new THREE.BoxGeometry(1, 1, 1), 1);
  const b = applyWorldUVs(new THREE.BoxGeometry(1, 1, 1), 0.5);
  assert.ok(near(faceSpan(b, [0, 0, 1], 0), 2 * faceSpan(a, [0, 0, 1], 0)));
});

test('boxProjectUVs on raw arrays', () => {
  const uv = boxProjectUVs(new Float32Array([1, 2, 3]), new Float32Array([0, 0, 1]), 2);
  assert.deepEqual([...uv], [0.5, 1]);
});

test('applyWorldUVs is a no-op without normals or with a bad scale', () => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const before = g.getAttribute('uv');
  applyWorldUVs(g, 0);
  assert.equal(g.getAttribute('uv'), before);
  g.deleteAttribute('normal');
  applyWorldUVs(g, 1);
  assert.equal(g.getAttribute('uv'), before);
});

test('applyWorldUVsTo rewrites unscaled boxes with a metres-per-repeat material, once', () => {
  const tiled = new THREE.MeshStandardMaterial();
  tiled.userData.metresPerRepeat = 2;
  const root = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.2), tiled);
  const scaled = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), tiled);
  scaled.scale.set(3, 1, 1);   // local-space projection would misreport its size
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4), tiled);
  const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  root.add(wall, scaled, pipe, plain);
  assert.equal(applyWorldUVsTo(root), 1);
  assert.equal(wall.geometry.userData.worldUV, 2);
  assert.ok(near(faceSpan(wall.geometry, [0, 0, 1], 0), 3));
  assert.equal(scaled.geometry.userData.worldUV, undefined);
  assert.equal(pipe.geometry.userData.worldUV, undefined);
  assert.equal(plain.geometry.userData.worldUV, undefined);
  assert.equal(applyWorldUVsTo(root), 0, 'idempotent');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/worlduv.test.mjs`
Expected: FAIL, `Cannot find module …/worldUV.js`

- [ ] **Step 3: Implement** `src/scene3d/materials/worldUV.js`

```js
// @ts-check
// World-scale UVs: one texture repeat per N metres on every face, whatever the
// size of the box. BoxGeometry's own UVs run 0..1 across every face, so one
// texture stretched once over a 2.4 m counter and once over a 0.3 m shelf. Box
// projection from local vertex positions fixes the density; the per-material N
// lives on the material (`userData.metresPerRepeat`, set by materials/pbr.js).
import * as THREE from 'three';

/** Geometry types that are axis-aligned boxes. RoundedBoxGeometry extends BoxGeometry. */
const BOXY = new Set(['BoxGeometry', 'RoundedBoxGeometry']);

/**
 * PURE. Planar-project each vertex onto the plane its normal is most aligned
 * with. Signs flip on the negative faces so no face shows its texture mirrored.
 * @param {ArrayLike<number>} positions xyz triples (local space, metres)
 * @param {ArrayLike<number>} normals xyz triples
 * @param {number} metresPerRepeat
 * @returns {Float32Array} uv pairs
 */
export function boxProjectUVs(positions, normals, metresPerRepeat) {
  const n = positions.length / 3;
  const uv = new Float32Array(n * 2);
  const k = 1 / metresPerRepeat;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let u, v;
    if (ax >= ay && ax >= az) { u = nx > 0 ? -z : z; v = y; }      // ±X faces run along Z
    else if (ay >= az) { u = x; v = ny > 0 ? -z : z; }               // ±Y faces: plan view
    else { u = nz > 0 ? x : -x; v = y; }                             // ±Z faces run along X
    uv[i * 2] = u * k;
    uv[i * 2 + 1] = v * k;
  }
  return uv;
}

/**
 * @param {THREE.BufferGeometry} geometry
 * @param {number} metresPerRepeat
 */
export function applyWorldUVs(geometry, metresPerRepeat) {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  if (!pos || !nor || !(metresPerRepeat > 0)) return geometry;
  geometry.setAttribute('uv', new THREE.BufferAttribute(boxProjectUVs(pos.array, nor.array, metresPerRepeat), 2));
  return geometry;
}

/**
 * Rewrite every eligible box under `root`. Run once per floor after it is
 * built: it covers shells, furniture and inline architecture alike, so no
 * builder has to remember to call it.
 * @param {THREE.Object3D} root
 * @returns {number} geometries rewritten
 */
export function applyWorldUVsTo(root) {
  let n = 0;
  root.traverse((o) => {
    const mesh = /** @type {THREE.Mesh} */ (o);
    if (!mesh.isMesh || /** @type {any} */ (mesh).isInstancedMesh || Array.isArray(mesh.material)) return;
    const mpr = /** @type {THREE.Material} */ (mesh.material)?.userData?.metresPerRepeat;
    const g = mesh.geometry;
    if (!mpr || g.userData.worldUV || !BOXY.has(g.type)) return;
    // local-space projection would misreport a scaled mesh's size
    if (Math.abs(mesh.scale.x - 1) + Math.abs(mesh.scale.y - 1) + Math.abs(mesh.scale.z - 1) > 1e-6) return;
    applyWorldUVs(g, mpr);
    g.userData.worldUV = mpr;
    n++;
  });
  return n;
}
```

- [ ] **Step 4: Run the test**

Run: `node --test test/unit/worlduv.test.mjs`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/scene3d/materials/worldUV.js test/unit/worlduv.test.mjs
git commit -F - <<'EOF'
feat(materials): world-scale box UVs — one repeat per N metres on every face

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 13: The PBR material library

**Files:**
- Create: `src/scene3d/materials/pbr.js`, `test/unit/pbr.test.mjs`

**Interfaces:**
- Consumes: texGen generators and `surfaced` (Task 11); the facade's `peekPBR` (Task 7)
- Produces:
  - `PBR_LIBRARY: Record<name, PbrSpec>` with the names `concrete`, `concreteFloor`, `metal`, `metalDark`, `tile`, `marble`, `wood`, `fabric`, `bedding`, `rust`
  - `PBR_SET_IDS: string[]`
  - `pbrMaterial(name, {tint?, roughness?, metalness?}) → MeshStandardMaterial`, shared per key. It carries `userData.pbr`, `userData.source: 'pbr'|'procedural'` and `userData.metresPerRepeat`.
  - `setPbrAssets(facade|null)`, `_resetPbrLibrary()`, `pbrTint(tint, gain) → Color`

- [ ] **Step 1: Write the failing test** `test/unit/pbr.test.mjs`

```js
// @ts-check
// src/scene3d/materials/pbr.js — the named surface library. Hybrid by design:
// a material is built from a Poly Haven set when the facade has one decoded,
// and from the canvas generators when it does not, so a missing asset costs
// looks, never a blank box. The library is the ONE place a set id is named,
// so it is also checked against the manifest here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './helpers/dom.mjs';

installFakeDom();
const THREE = await import('three');
const { PBR_LIBRARY, PBR_SET_IDS, pbrMaterial, setPbrAssets, _resetPbrLibrary, pbrTint } =
  await import('../../src/scene3d/materials/pbr.js');

const NAMES = ['concrete', 'concreteFloor', 'metal', 'metalDark', 'tile', 'marble', 'wood', 'fabric', 'bedding', 'rust'];
const t = () => new THREE.Texture();
/** a fake facade holding the given sets */
function facade(ids, { metal = [] } = {}) {
  const sets = {};
  for (const id of ids) {
    const orm = t();
    sets[id] = { map: t(), normalMap: t(), roughnessMap: orm, aoMap: orm, metalnessMap: metal.includes(id) ? orm : null };
  }
  return { peekPBR: (id) => sets[id] ?? null, sets };
}

test('the library has the spec’s ten names, each with a positive metres-per-repeat', () => {
  assert.deepEqual(Object.keys(PBR_LIBRARY).sort(), [...NAMES].sort());
  for (const n of NAMES) assert.ok(PBR_LIBRARY[n].metresPerRepeat > 0, n);
});

test('with no assets every material is procedural and tiles at repeat 1 (world UVs carry the density)', () => {
  _resetPbrLibrary();
  for (const n of NAMES) {
    const m = pbrMaterial(n);
    assert.equal(m.userData.source, 'procedural', n);
    assert.equal(m.userData.pbr, n);
    assert.equal(m.userData.metresPerRepeat, PBR_LIBRARY[n].metresPerRepeat);
    assert.ok(m.map?.isCanvasTexture, `${n} has a canvas albedo`);
    assert.equal(m.map.repeat.x, 1, `${n}: a repeating texture on top of world UVs would double the density`);
  }
});

test('identical requests share one material; a different tint or roughness does not', () => {
  _resetPbrLibrary();
  assert.equal(pbrMaterial('concrete'), pbrMaterial('concrete'));
  assert.notEqual(pbrMaterial('concrete'), pbrMaterial('concrete', { tint: '#1c1218' }));
  assert.notEqual(pbrMaterial('metal'), pbrMaterial('metal', { roughness: 0.35 }));
});

test('a loaded set wins, per material: its maps, ORM as roughness + AO, the tint lifted by gain', () => {
  _resetPbrLibrary();
  const f = facade(['metal_plate_02'], { metal: ['metal_plate_02'] });
  setPbrAssets(f);
  const m = pbrMaterial('metal');
  const set = f.sets.metal_plate_02;
  assert.equal(m.userData.source, 'pbr');
  assert.equal(m.map, set.map);
  assert.equal(m.normalMap, set.normalMap);
  assert.equal(m.roughnessMap, set.roughnessMap);
  assert.equal(m.aoMap, set.roughnessMap);
  assert.equal(m.metalnessMap, set.roughnessMap);
  assert.equal(m.metalness, 1, 'the metal channel carries metalness');
  assert.equal(m.roughness, 1, 'the ORM G channel carries roughness');
  assert.ok(m.color.equals(pbrTint(PBR_LIBRARY.metal.tint, PBR_LIBRARY.metal.gain)));
  assert.equal(pbrMaterial('wood').userData.source, 'procedural', 'a set the facade does not hold falls back on its own');
});

test('no metal channel: metalnessMap stays null and the scalar applies', () => {
  _resetPbrLibrary();
  setPbrAssets(facade(['plank_flooring_04']));
  const m = pbrMaterial('wood', { metalness: 0.2 });
  assert.equal(m.metalnessMap, null);
  assert.equal(m.metalness, 0.2);
});

test('bedding is procedural-only, even when every set is loaded', () => {
  _resetPbrLibrary();
  setPbrAssets(facade(PBR_SET_IDS));
  assert.equal(PBR_LIBRARY.bedding.set, null);
  assert.equal(pbrMaterial('bedding').userData.source, 'procedural');
});

test('pointing the library at a new facade drops materials built against the old one', () => {
  _resetPbrLibrary();
  const procedural = pbrMaterial('tile');
  setPbrAssets(facade(['floor_tiles_08']));
  assert.notEqual(pbrMaterial('tile'), procedural);
  assert.equal(pbrMaterial('tile').userData.source, 'pbr');
});

test('pbrTint lifts by gain in linear space and clamps at 1', () => {
  const c = pbrTint('#ffffff', 3);
  assert.deepEqual([c.r, c.g, c.b], [1, 1, 1]);
  const d = pbrTint('#101010', 2);
  assert.ok(d.r > new THREE.Color('#101010').r);
});

test('every set the library names is a pbr entry in assets/manifest.json', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../assets/manifest.json', import.meta.url), 'utf8'));
  for (const id of PBR_SET_IDS) {
    const e = manifest.entries.find((x) => x.id === id);
    assert.ok(e && e.kind === 'pbr', `${id} is not a pbr entry in the manifest`);
  }
});

test('an unknown name throws with the list of real ones', () => {
  assert.throws(() => pbrMaterial('velvet'), /unknown PBR material "velvet".*concrete/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/pbr.test.mjs`
Expected: FAIL, `Cannot find module …/pbr.js`

- [ ] **Step 3: Implement** `src/scene3d/materials/pbr.js`

```js
// @ts-check
// The named surface library every shell and furniture piece draws from.
//
// HYBRID. A material is built from a Poly Haven PBR set when the asset pipeline
// has one decoded (src/assets/assets.js), and from the canvas generators in
// texGen.js when it does not — a missing file, `?noassets=1`, or a Node test all
// get the procedural surface the game shipped with, never an untextured box.
//
// Every material carries `userData.metresPerRepeat`. src/scene3d/materials/
// worldUV.js rewrites box UVs to one repeat per that many metres, so a 2.4 m
// counter and a 0.3 m shelf show their grain at the same scale — which is also
// why every texture here tiles at repeat 1.
import * as THREE from 'three';
import { concreteTex, tileTex, metalTex, woodTex, marbleTex, fabricTex, surfaced } from './texGen.js';

/**
 * @typedef {object} PbrSpec
 * @property {string|null} set  Poly Haven set id in assets/manifest.json; null = procedural only
 * @property {number} metresPerRepeat
 * @property {string} tint  the canvas tint for the fallback; × gain, the colour multiplier on a loaded set
 * @property {number} gain  linear lift for `tint` on a loaded set. A photographed albedo averages
 *   ~0.2-0.5 linear while the canvas swatch IS the final colour, so the bare tint would crush a
 *   loaded set to black
 * @property {number} roughness  fallback roughness (a loaded set takes it from its ORM map)
 * @property {number} metalness  metalness; ignored when the set has a metal channel
 * @property {number} normalScale
 * @property {number} relief  Sobel strength for the fallback's derived normal map
 * @property {(tint:string) => THREE.CanvasTexture} canvas  the procedural albedo, at repeat 1
 */

/** @type {Record<string, PbrSpec>} */
export const PBR_LIBRARY = {
  concrete: { set: 'smooth_concrete_floor', metresPerRepeat: 2.5, tint: '#181c2a', gain: 5, roughness: 0.85, metalness: 0, normalScale: 0.8, relief: 1.6, canvas: (t) => concreteTex(t, 1) },
  concreteFloor: { set: 'concrete_floor_worn_001', metresPerRepeat: 2.0, tint: '#12151f', gain: 5, roughness: 0.82, metalness: 0, normalScale: 0.8, relief: 1.6, canvas: (t) => concreteTex(t, 1) },
  metal: { set: 'metal_plate_02', metresPerRepeat: 1.0, tint: '#2a3040', gain: 4, roughness: 0.4, metalness: 0.7, normalScale: 0.35, relief: 1.2, canvas: (t) => metalTex(t, 1) },
  metalDark: { set: 'painted_metal_shutter', metresPerRepeat: 1.2, tint: '#151923', gain: 4, roughness: 0.5, metalness: 0.6, normalScale: 0.4, relief: 1.2, canvas: (t) => metalTex(t, 1) },
  tile: { set: 'floor_tiles_08', metresPerRepeat: 2.4, tint: '#11141f', gain: 4, roughness: 0.35, metalness: 0.15, normalScale: 1.0, relief: 2.2, canvas: (t) => tileTex(t, '#05060a', 4, 1) },
  marble: { set: 'marble_01', metresPerRepeat: 1.5, tint: '#353b4a', gain: 2, roughness: 0.25, metalness: 0.1, normalScale: 0.25, relief: 0.9, canvas: (t) => marbleTex(t, 1) },
  wood: { set: 'plank_flooring_04', metresPerRepeat: 1.8, tint: '#2b1e18', gain: 3, roughness: 0.7, metalness: 0, normalScale: 0.7, relief: 1.8, canvas: (t) => woodTex(t, 1) },
  fabric: { set: 'dirty_carpet', metresPerRepeat: 0.8, tint: '#2c2434', gain: 3, roughness: 0.9, metalness: 0, normalScale: 0.6, relief: 1.1, canvas: (t) => fabricTex(t, 1) },
  // the quilt weave reads better than any carpet scan at bed scale; procedural by choice
  bedding: { set: null, metresPerRepeat: 0.6, tint: '#3a3348', gain: 1, roughness: 0.95, metalness: 0, normalScale: 0.6, relief: 1.1, canvas: (t) => fabricTex(t, 1) },
  rust: { set: 'rusty_metal_02', metresPerRepeat: 1.2, tint: '#3a4038', gain: 3, roughness: 0.6, metalness: 0.5, normalScale: 0.5, relief: 1.0, canvas: (t) => metalTex(t, 1) },
};

/** Every Poly Haven set the library can use — World3D preloads these before building. */
export const PBR_SET_IDS = [...new Set(Object.values(PBR_LIBRARY).map((s) => s.set).filter((s) => typeof s === 'string'))];

/** @type {Map<string, THREE.MeshStandardMaterial>} */
const cache = new Map();
/** @type {{peekPBR:(id:string) => any}|null} */
let assets = null;

/**
 * Point the library at an asset facade (World3D does this before it builds).
 * Clears the cache: a material built against the old source must not leak into
 * a world built against the new one.
 * @param {{peekPBR:(id:string) => any}|null} facade
 */
export function setPbrAssets(facade) {
  if (facade === assets) return;
  assets = facade;
  cache.clear();
}

/** Test hook: forget the facade and every cached material. */
export function _resetPbrLibrary() {
  assets = null;
  cache.clear();
}

/**
 * `tint` × `gain` in linear space, clamped to 1.
 * @param {string} tint @param {number} gain
 */
export function pbrTint(tint, gain) {
  const c = new THREE.Color(tint).multiplyScalar(gain);
  return c.setRGB(Math.min(1, c.r), Math.min(1, c.g), Math.min(1, c.b));
}

/**
 * The shared material for a library surface. Identical requests return the
 * same instance (one program, better batching, and — from rc.1 — mergeable).
 * @param {string} name a PBR_LIBRARY key
 * @param {{tint?:string, roughness?:number, metalness?:number}} [o]
 * @returns {THREE.MeshStandardMaterial}
 */
export function pbrMaterial(name, o = {}) {
  const spec = PBR_LIBRARY[name];
  if (!spec) throw new Error(`unknown PBR material "${name}" (have: ${Object.keys(PBR_LIBRARY).join(', ')})`);
  const tint = o.tint ?? spec.tint;
  const roughness = o.roughness ?? spec.roughness;
  const metalness = o.metalness ?? spec.metalness;
  const key = `${name}|${tint}|${roughness}|${metalness}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const set = spec.set ? assets?.peekPBR(spec.set) ?? null : null;
  /** @type {THREE.MeshStandardMaterial} */
  let m;
  if (set) {
    m = new THREE.MeshStandardMaterial({
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(spec.normalScale, spec.normalScale),
      roughnessMap: set.roughnessMap,
      aoMap: set.aoMap,
      metalnessMap: set.metalnessMap,
      color: pbrTint(tint, spec.gain),
      roughness: 1,                               // the ORM G channel IS the roughness; the scalar multiplies it
      metalness: set.metalnessMap ? 1 : metalness,
    });
  } else {
    m = new THREE.MeshStandardMaterial({ ...surfaced(spec.canvas(tint), spec.relief, spec.normalScale), roughness, metalness });
  }
  m.name = `pbr:${name}`;
  m.userData.pbr = name;
  m.userData.source = set ? 'pbr' : 'procedural';
  m.userData.metresPerRepeat = spec.metresPerRepeat;
  cache.set(key, m);
  return m;
}
```

- [ ] **Step 4: Run the test**

Run: `node --test test/unit/pbr.test.mjs`
Expected: 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/scene3d/materials/pbr.js test/unit/pbr.test.mjs
git commit -F - <<'EOF'
feat(materials): PBR library — Poly Haven sets with a texGen fallback per surface

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 14: Furniture and shells on the PBR library, bevels, per-floor preload

**Files:**
- Create: `src/scene3d/tower/floorAssets.js`, `test/unit/furniture-pbr.test.mjs`
- Modify: `src/scene3d/tower/furniture.js`, `src/scene3d/tower/zoneBuilder.js`, `src/core/app.js`, `test/smoke/smoke.spec.mjs`

**Interfaces:**
- Consumes: `pbrMaterial`, `setPbrAssets`, `PBR_SET_IDS` (Task 13); `applyWorldUVsTo` (Task 12); `RoundedBoxGeometry` (Task 2); `app.assets` (Task 8)
- Produces:
  - `assetsForFloor(floorId) → {kind, id}[]`
  - `World3D.create(stage, rng, assets) → Promise<World3D>`
  - `new World3D(stage, rng, assets = null, { build = true })`
  - `world._buildFloor(floor)`, `world._finishBuild()`
  - `world.assets`
  - `world.furnitureGroups: Record<floorId, Object3D[]>` (non-interactive furniture roots)
  - `box(group, material, w, h, d, x, y, z, ry = 0, { bevel = 0 } = {})` in furniture.js

- [ ] **Step 1: Write the failing test** `test/unit/furniture-pbr.test.mjs`

```js
// @ts-check
// The tower on the PBR library. Hero furniture is bevelled — a hard 90° box
// edge catches no highlight, which is most of why the old furniture read as
// untextured boxes — but colliders and sockets must not move by a millimetre:
// the FP collision, the actor queue and the bed scene all address them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './helpers/dom.mjs';

installFakeDom();
const THREE = await import('three');
const { RoundedBoxGeometry } = await import('three/addons/geometries/RoundedBoxGeometry.js');
const { FURNITURE } = await import('../../src/scene3d/tower/furniture.js');
const { World3D } = await import('../../src/scene3d/tower/zoneBuilder.js');
const { assetsForFloor } = await import('../../src/scene3d/tower/floorAssets.js');
const { PBR_SET_IDS } = await import('../../src/scene3d/materials/pbr.js');
const { FLOORS } = await import('../../data/zones.js');

const rounded = (group) => { let n = 0; group.traverse((o) => { if (o.isMesh && o.geometry instanceof RoundedBoxGeometry) n++; }); return n; };
const rng = { next: () => 0.5, chance: () => false, int: (a) => a, pick: (a) => a[0], range: (a) => a };

test('hero pieces are bevelled', () => {
  assert.ok(rounded(FURNITURE.couch().group) >= 7, 'seat, back, arms and cushions');
  assert.ok(rounded(FURNITURE.bed().group) >= 4, 'platform, mattress, pillows, headboard');
  assert.ok(rounded(FURNITURE.coffee_table().group) >= 1);
  assert.ok(rounded(FURNITURE.bar_counter().group) >= 2);
  assert.ok(rounded(FURNITURE.sink_counter().group) >= 2);
  assert.equal(rounded(FURNITURE.weapon_rack().group), 0, 'clutter stays crisp');
});

test('bevelling moved no collider and no socket', () => {
  assert.deepEqual(FURNITURE.couch().colliders, [{ min: [-1.15, 0, -0.5], max: [1.15, 0.9, 0.5] }]);
  assert.deepEqual(FURNITURE.bed().colliders, [{ min: [-1.0, 0, -1.2], max: [1.0, 0.6, 1.15] }]);
  assert.deepEqual(FURNITURE.coffee_table().colliders, [{ min: [-0.6, 0, -0.31], max: [0.6, 0.42, 0.31] }]);
  const s = FURNITURE.bed().sockets;
  assert.deepEqual(Object.keys(s).sort(), ['lie_center', 'lie_left', 'lie_right', 'seat0', 'seat1']);
  assert.deepEqual(s.seat1.position.toArray(), [-0.7, 0.5, 0.85]);
});

test('furniture surfaces come from the library', () => {
  const couch = FURNITURE.couch().group;
  const names = new Set();
  couch.traverse((o) => { if (o.isMesh) names.add(o.material.userData.pbr); });
  assert.ok(names.has('fabric'));
  assert.ok(names.has('metalDark'));
});

test('assetsForFloor asks for every PBR set the library uses', () => {
  const list = assetsForFloor('penthouse');
  assert.deepEqual(list.filter((x) => x.kind === 'pbr').map((x) => x.id).sort(), [...PBR_SET_IDS].sort());
});

test('the built tower has world-scale UVs on its walls and slabs', () => {
  const stage = { scene: new THREE.Scene() };
  const world = new World3D(/** @type {any} */ (stage), /** @type {any} */ (rng));
  let tagged = 0;
  world.floorGroups.penthouse.traverse((o) => { if (o.isMesh && o.geometry.userData.worldUV) tagged++; });
  assert.ok(tagged > 20, `only ${tagged} penthouse geometries got world UVs`);
});

test('World3D.create preloads each floor before building it', async () => {
  const stage = { scene: new THREE.Scene() };
  const built = () => stage.scene.children.filter((c) => c.name.startsWith('floor_')).length;
  const seen = [];
  const facade = {
    preload: async () => { seen.push(built()); },
    peekPBR: () => null, peekGLTF: () => null, peekEquirect: () => null,
  };
  const world = await World3D.create(/** @type {any} */ (stage), /** @type {any} */ (rng), /** @type {any} */ (facade));
  assert.equal(seen.length, Object.keys(FLOORS).length);
  assert.deepEqual(seen, seen.map((_, i) => i), 'preload N runs before floor N is built');
  assert.equal(world.activeFloor, 'penthouse');
  assert.ok(world.furnitureGroups.penthouse.length > 5);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/furniture-pbr.test.mjs`
Expected: FAIL, `Cannot find module …/floorAssets.js`

- [ ] **Step 3: Create** `src/scene3d/tower/floorAssets.js`

```js
// @ts-check
// What each floor needs from the asset pipeline before it is built.
// World3D.create() awaits this list per floor, so a floor's materials, props and
// sky are decoded before its geometry exists — nothing pops in. PURE.
import { PBR_SET_IDS } from '../materials/pbr.js';

/**
 * @param {string} floorId
 * @returns {{kind: import('../../assets/assets.js').AssetKind, id: string}[]}
 */
export function assetsForFloor(floorId) {
  // the library's sets are shared by every floor; after the first floor these resolve from cache
  /** @type {{kind: import('../../assets/assets.js').AssetKind, id: string}[]} */
  const list = PBR_SET_IDS.map((id) => ({ kind: 'pbr', id }));
  void floorId;   // later stages add per-floor assets (props: Task 15, the sky HDRI: Task 18)
  return list;
}
```

- [ ] **Step 4: Furniture on the library, with bevels** (`src/scene3d/tower/furniture.js`)
  - Replace the two import lines `import { PALETTE } from '../materials/palette.js';` and `import { fabricTex, woodTex, marbleTex, metalTex, concreteTex, surfaced } from '../materials/texGen.js';` with the first block below. Then replace everything from the comment `// Cache non-glow materials so identical surfaces share one material…` through the closing `};` of `const mat = {` with the second block. `const concreteTexLazy = …` and the `Furniture` typedef stay where they are.

```js
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../materials/palette.js';
import { fabricTex, concreteTex } from '../materials/texGen.js';
import { pbrMaterial } from '../materials/pbr.js';
```

```js
// Library surfaces (src/scene3d/materials/pbr.js): a Poly Haven set when the
// asset pipeline has it, the texGen canvas + Sobel normal otherwise. Shared per
// name, so identical surfaces share one material across all furniture.
const _matCache = new Map();
const cached = (key, make) => { let m = _matCache.get(key); if (!m) _matCache.set(key, (m = make())); return m; };
const mat = {
  fabric: () => pbrMaterial('fabric'),
  leather: () => cached('leather', () => new THREE.MeshStandardMaterial({ color: PALETTE.leather, roughness: 0.55, metalness: 0.05 })),
  wood: () => pbrMaterial('wood'),
  marble: () => pbrMaterial('marble'),
  metal: () => pbrMaterial('metal'),
  bedding: () => pbrMaterial('bedding'),
  metalDark: () => pbrMaterial('metalDark'),
  glow: (color, intensity = 2) => cached(`glow:${color}:${intensity}`, () => new THREE.MeshStandardMaterial({
    color: 0x111111, emissive: new THREE.Color(color), emissiveIntensity: intensity,
  })),
};

// Bevels for the hero pieces. A hard 90° edge catches no highlight at all,
// which is most of why furniture read as untextured boxes; 2 cm is enough to
// draw a specular line along every edge without softening the silhouette.
// Upholstery gets a rounder 4.5 cm. Colliders are NOT derived from geometry,
// so none of this moves one.
const HERO = { bevel: 0.02 };
const SOFT = { bevel: 0.045 };
```

  - Replace `function box(…) { … }` with:

```js
function box(group, material, w, h, d, x, y, z, ry = 0, { bevel = 0 } = {}) {
  // RoundedBoxGeometry clamps the radius to half the shortest side itself;
  // below ~2 mm a bevel is invisible and only costs vertices
  const geo = bevel > 0.002 ? new RoundedBoxGeometry(w, h, d, 2, bevel) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = m.receiveShadow = true;
  group.add(m);
  return m;
}
```

  - Apply the bevels to these exact lines. Each gains `, 0, SOFT` or `, 0, HERO` before its closing `)`, and trailing comments stay.
    - **couch** gets `SOFT` on its five fabric boxes:
      - `box(group, fab, w, 0.16, 0.95, 0, 0.28, 0, 0, SOFT);`
      - `box(group, fab, w, 0.42, 0.22, 0, 0.62, -0.38, 0, SOFT);`
      - both arm lines, `…, 0.51, 0, 0, SOFT);`
      - the cushion line, `box(group, fab, w / n - 0.04, 0.12, 0.8, cx, 0.42, 0.04, 0, SOFT);`
      - The plinth stays unbevelled.
    - **armchair** gets `SOFT` on its four leather boxes (the first four `box(group, fab, …)` lines).
    - **coffee_table** gets `HERO` on the top only: `box(group, mat.marble(), 1.2, 0.05, 0.62, 0, 0.36, 0, 0, HERO);`
    - **bed**:
      - platform `…, 0, 0.18, 0, 0, HERO);`
      - mattress `…, 0, 0.42, 0, 0, SOFT);`
      - pillows `…, 0, 0.56, -0.75, 0, SOFT);`
      - headboard `…, 0, 0.65, -1.16, 0, HERO);`
      - The neon strip stays unbevelled.
    - **vanity_table**: `box(group, mat.wood(), 1.5, 0.05, 0.5, 0, 0.74, 0, 0, HERO);` and `box(group, mat.wood(), 1.4, 0.7, 0.42, 0, 0.37, 0, 0, HERO);`
    - **sink_counter**: `box(group, mat.marble(), 1.6, 0.06, 0.55, 0, 0.86, 0, 0, HERO);` and `box(group, mat.wood(), 1.5, 0.8, 0.48, 0, 0.43, 0, 0, HERO);`
    - **security_desk**: `box(group, mat.metal(), 2.6, 0.05, 0.8, 0, 0.76, 0, 0, HERO);` and `box(group, mat.metalDark(), 2.5, 0.72, 0.7, 0, 0.38, 0, 0, HERO);`
    - **reception_desk**: `box(group, mat.marble(), 3.4, 0.07, 0.9, 0, 1.05, 0, 0, HERO);` and `box(group, mat.wood(), 3.3, 1.0, 0.8, 0, 0.52, 0, 0, HERO);`
    - **bar_counter**: `box(group, mat.marble(), w, 0.06, 0.68, 0, 1.06, 0, 0, HERO);         // top` and `box(group, mat.wood(), w - 0.06, 1.0, 0.58, 0, 0.52, 0, 0, HERO);     // body`

  - Then run `grep -n "surfaced\|woodTex\|marbleTex\|metalTex" src/scene3d/tower/furniture.js`. Expected: no output. If a line still uses one of them, it is a one-off material: replace it with the matching `pbrMaterial(…)` name and keep its colour as `tint`.

- [ ] **Step 5: Shells on the library** (`src/scene3d/tower/zoneBuilder.js`)
  - Replace `import { tileTex, concreteTex, metalTex, surfaced } from '../materials/texGen.js';` with:

```js
import { pbrMaterial, setPbrAssets } from '../materials/pbr.js';
import { applyWorldUVsTo } from '../materials/worldUV.js';
import { assetsForFloor } from './floorAssets.js';
```

  - Replace the two material factories:

```js
const mullionMat = () => pbrMaterial('metalDark', { tint: '#1a1f2c', roughness: 0.5, metalness: 0.7 });
const wallMatOf = (tint) => pbrMaterial('concrete', { tint });
```

  - Then replace each remaining `new THREE.MeshStandardMaterial({ ...surfaced(…) … })` (and the ground marble colour material) in place:

| Where (current code) | Becomes |
|---|---|
| `doorMat` (`metalTex('#232a3a'), … roughness: 0.35, metalness: 0.8`) | `pbrMaterial('metal', { tint: '#232a3a', roughness: 0.35, metalness: 0.8 })` |
| penthouse `floorTex` (`tileTex()`) | `pbrMaterial('tile')` |
| penthouse balcony slab (`concreteTex('#141824') … roughness: 0.8`) | `pbrMaterial('concreteFloor', { tint: '#141824', roughness: 0.8 })` |
| `turretMat` (`metalTex('#232a3a') … 0.35 / 0.8`) | `pbrMaterial('metal', { tint: '#232a3a', roughness: 0.35, metalness: 0.8 })` |
| penthouse shutter (`metalTex('#1c222e') … roughness: 0.5, metalness: 0.7`) | `pbrMaterial('metalDark', { tint: '#1c222e', roughness: 0.5, metalness: 0.7 })` |
| rooftop slab (`concreteTex('#161a26') … roughness: 0.95`) | `pbrMaterial('concreteFloor', { tint: '#161a26', roughness: 0.95 })` |
| rooftop HVAC (`metalTex('#2a3038') … metalness: 0.55, roughness: 0.45`) | `pbrMaterial('rust', { tint: '#2a3038', metalness: 0.55, roughness: 0.45 })` |
| `_roomShell` default floor (`concreteTex(floorTint) … roughness: 0.82`) | `pbrMaterial('concreteFloor', { tint: floorTint })` |
| fl40 dais (`metalTex('#1a1520') … 0.35 / 0.5`) | `pbrMaterial('metalDark', { tint: '#1a1520', metalness: 0.35, roughness: 0.5 })` |
| fl40 beams (`metalTex('#2a1820') … 0.5 / 0.45`) | `pbrMaterial('metal', { tint: '#2a1820', metalness: 0.5, roughness: 0.45 })` |
| fl27 `tile` (`metalTex('#15202c') … 0.45 / 0.4`) | `pbrMaterial('metal', { tint: '#15202c', metalness: 0.45, roughness: 0.4 })` |
| fl27 dais (`metalTex('#1a2430') … 0.55 / 0.4`) | `pbrMaterial('metal', { tint: '#1a2430', metalness: 0.55, roughness: 0.4 })` |
| fl12 `tile` (`tileTex('#d8e4ee') … roughness: 0.42, metalness: 0.06`) | `pbrMaterial('tile', { tint: '#d8e4ee', roughness: 0.42, metalness: 0.06 })` |
| ground `marble` (`{ color: 0x2a3140, roughness: 0.22, metalness: 0.18 }`) | `pbrMaterial('marble', { tint: '#2a3140', roughness: 0.22, metalness: 0.18 })` |
| ground mezzanine (`metalTex('#1a2230') … 0.4 / 0.45`) | `pbrMaterial('metal', { tint: '#1a2230', metalness: 0.4, roughness: 0.45 })` |
| ground `colMat` (`concreteTex('#2a3140') … roughness: 0.55, metalness: 0.12`) | `pbrMaterial('concrete', { tint: '#2a3140', roughness: 0.55, metalness: 0.12 })` |
| basement ramp (`concreteTex('#1a1c22') … roughness: 0.9`) | `pbrMaterial('concreteFloor', { tint: '#1a1c22', roughness: 0.9 })` |
| basement pipes (`metalTex('#3a4038') … 0.7 / 0.4`) | `pbrMaterial('rust', { tint: '#3a4038', metalness: 0.7, roughness: 0.4 })` |
| basement `colM` (`concreteTex('#1a1c20') … roughness: 0.75`) | `pbrMaterial('concrete', { tint: '#1a1c20', roughness: 0.75 })` |

  - Check: `grep -n "surfaced\|tileTex\|concreteTex\|metalTex" src/scene3d/tower/zoneBuilder.js`
    Expected: no output.

- [ ] **Step 6: Per-floor build in `World3D`**
  - Replace the constructor (from its JSDoc to the closing `}` after `this.setActiveFloor('penthouse');`) with:

```js
  /**
   * @param {import('../stage.js').Stage} stage
   * @param {import('../../core/rng.js').RngStream} rng
   * @param {ReturnType<typeof import('../../assets/assets.js').createAssets>|null} [assets]
   *   the asset facade; null (Node tests, ?noassets=1 paths) builds everything procedurally
   * @param {{build?: boolean}} [opts] build:false leaves the floors to World3D.create()
   */
  constructor(stage, rng, assets = null, { build = true } = {}) {
    this.stage = stage;
    this.rng = rng;
    this.assets = assets;
    /** @type {Record<string, THREE.Group>} */
    this.floorGroups = {};
    /** @type {Record<string, {x:[number,number], z:[number,number]}[]>} WORLD-space walk rects */
    this.walkRects = {};
    /** @type {Record<string, THREE.Box3[]>} WORLD-space furniture colliders */
    this.collidersByFloor = {};
    /** @type {Record<string, Record<string, THREE.Object3D>>} furnitureId → sockets */
    this.sockets = {};
    /** @type {{mesh: THREE.Object3D, id:string, prompt:string, floor:string}[]} */
    this.props = [];
    /** @type {THREE.Object3D[]} animated bits (fish, rings, fire) found by name */
    this.animated = [];
    this.fireSprites = [];
    /** @type {Record<string, THREE.Object3D[]>} non-interactive furniture roots per floor (rc.1 merges them) */
    this.furnitureGroups = {};
    this.activeFloor = 'penthouse';
    // every library material from here on reads this facade (src/scene3d/materials/pbr.js)
    setPbrAssets(assets);
    if (!build) return;
    for (const floor of Object.values(FLOORS)) this._buildFloor(floor);
    this._finishBuild();
  }

  /**
   * Build the tower floor by floor, awaiting each floor's assets first, so the
   * materials and props a floor is made of are decoded before its geometry
   * exists — no pop-in. Never rejects on a missing asset: the facade resolves
   * those to null and the floor builds procedurally.
   * @param {import('../stage.js').Stage} stage
   * @param {import('../../core/rng.js').RngStream} rng
   * @param {ReturnType<typeof import('../../assets/assets.js').createAssets>} assets
   */
  static async create(stage, rng, assets) {
    const world = new World3D(stage, rng, assets, { build: false });
    for (const floor of Object.values(FLOORS)) {
      await assets?.preload(assetsForFloor(floor.id));
      world._buildFloor(floor);
    }
    world._finishBuild();
    return world;
  }

  /** @param {(typeof FLOORS)[keyof typeof FLOORS]} floor */
  _buildFloor(floor) {
    const group = new THREE.Group();
    group.name = `floor_${floor.id}`;
    group.position.x = floor.offsetX;
    this.floorGroups[floor.id] = group;
    this.walkRects[floor.id] = [];
    this.collidersByFloor[floor.id] = [];
    this.furnitureGroups[floor.id] = [];
    this[`_build_${floor.shell}`](group, floor);
    this._buildElevatorDoor(group, floor);
    // v0.4 added ~100 architecture meshes — dais, cages, server columns, lobby
    // columns, basement pillars, HVAC, the ramp — and registered NONE of them
    // as colliders, so the player walked straight through the lot. Anything
    // tagged `userData.solid` is picked up automatically from here on.
    this._collectSolids(group, floor.id);
    this.stage.scene.add(group);
    this._buildFurniture(floor.id);
    // one texture repeat per N metres on every box of this floor, whatever its size
    applyWorldUVsTo(group);
  }

  _finishBuild() {
    this._collectAnimated();
    this.setActiveFloor('penthouse');
  }
```

  - Change `_buildFurniture() {` to `_buildFurniture(floorId) {`, and add `if (zone.floor !== floorId) continue;` as the first line inside its `for (const zone of Object.values(ZONES))` loop.
  - At the end of that `if (PROP_PROMPTS[f.id]) { … }` block, add the `else` branch:

```js
        } else {
          // not interactive: nothing addresses it after build, so rc.1 may batch it
          this.furnitureGroups[zone.floor].push(item.group);
        }
```

- [ ] **Step 7: App wiring** (`src/core/app.js`)
  - In `startRun()`, replace `this.world = new World3D(this.stage, this.rng.stream('world'));` with:

```js
    this.world = await World3D.create(this.stage, this.rng.stream('world'), this.assets);
```

  - In the constructor, directly after `this.assetsReady = this.assets.init();`, add the line below. beta.2 moves anisotropy into the quality preset.

```js
    this.assets.setAnisotropy(Math.min(8, this.stage.renderer.capabilities.getMaxAnisotropy()));
```

- [ ] **Step 8: Smoke test.** In `test/smoke/smoke.spec.mjs`:
  - Add this test:

```js
  test('room surfaces come from the asset pipeline', async ({ page }) => {
    await bootToRun(page);
    const src = await page.evaluate(() => {
      const out = {};
      window.__ncld.app.world.floorGroups.penthouse.traverse((o) => {
        const p = o.material?.userData?.pbr;
        if (p) out[p] = o.material.userData.source;
      });
      return out;
    });
    expect(src.tile).toBe('pbr');
    expect(src.concrete).toBe('pbr');
    expect(src.fabric).toBe('pbr');
    expect(src.bedding).toBe('procedural');   // procedural by choice
  });
```

  - In the `?noassets=1` test's `page.evaluate`, add this property:

```js
      tile: (() => { let s = null; window.__ncld.app.world.floorGroups.penthouse.traverse((o) => { if (o.material?.userData?.pbr === 'tile') s = o.material.userData.source; }); return s; })(),
```

  - Then add `expect(state.tile).toBe('procedural');`.

- [ ] **Step 9: Run everything**

Run: `node --test test/unit/furniture-pbr.test.mjs && npm test && npm run lint && npm run test:e2e`
Expected: 6 new tests PASS. `floorheight` and `regressions` stay green: their source anchors and the synchronous constructor are unchanged. The e2e suite is green.

- [ ] **Step 10: Look at it.** Serve the game (`node tools/serve.mjs 8420`), start a run, and compare the penthouse to `docs/screenshots/v0.6/03-penthouse-lounge.jpg`.
  - The overall brightness should read the same, and the surfaces should now carry scanned detail.
  - If a surface reads much darker or lighter than before, adjust only that entry's `gain` in `PBR_LIBRARY` (±1 per try).
  - Then reload with `?noassets=1` and check the room still renders textured, from canvases.

- [ ] **Step 11: Commit**

```bash
git add src/scene3d/tower/floorAssets.js src/scene3d/tower/furniture.js src/scene3d/tower/zoneBuilder.js src/scene3d/materials/pbr.js src/core/app.js test/unit/furniture-pbr.test.mjs test/smoke/smoke.spec.mjs
git commit -F - <<'EOF'
feat(scene): furniture + shells on the PBR library, bevelled hero pieces, per-floor preload

World3D.create() awaits each floor's assets before building it (no
pop-in); the synchronous constructor still builds procedurally for tests.
Every box gets world-scale UVs; couch, counters, bed and tables use
RoundedBoxGeometry. Colliders and sockets are unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 15: Kenney prop dressing

**Files:**
- Create: `data/propDressing.js`, `src/scene3d/tower/props.js`, `test/unit/props.test.mjs`
- Modify: `src/scene3d/tower/floorAssets.js`, `src/scene3d/tower/zoneBuilder.js`, `tools/lint-assets.mjs`

**Interfaces:**
- Consumes: `checkPropRefs` (Task 3); `pbrMaterial`, `PBR_LIBRARY` (Task 13); `applyWorldUVs` (Task 12); `assets.peekGLTF` (Task 7)
- Produces:
  - `PROP_DRESSING: {asset, floor, at, y?, ry?, height, skin, solid?}[]`
  - `fitProp(model, height, material) → THREE.Group` (base at y=0, centred, scaled to height)
  - `world._dressProps(floorId)`
  - Prop roots carry `userData.dressing = asset`

- [ ] **Step 1: Write the failing test** `test/unit/props.test.mjs`

```js
// @ts-check
// Kenney clutter: opt-in data, fitted to a real height, re-skinned with the
// room's own PBR materials, and simply ABSENT when the model did not load —
// never replaced by a placeholder, so ?noassets=1 shows the v0.6 room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './helpers/dom.mjs';

installFakeDom();
const THREE = await import('three');
const { fitProp } = await import('../../src/scene3d/tower/props.js');
const { PROP_DRESSING } = await import('../../data/propDressing.js');
const { World3D } = await import('../../src/scene3d/tower/zoneBuilder.js');
const { assetsForFloor } = await import('../../src/scene3d/tower/floorAssets.js');
const { PBR_LIBRARY, pbrMaterial } = await import('../../src/scene3d/materials/pbr.js');
const { checkPropRefs } = await import('../../tools/lib/manifest.mjs');

const rng = { next: () => 0.5, chance: () => false, int: (a) => a, pick: (a) => a[0], range: (a) => a };
/** a stand-in Kenney model: 2 x 4 x 1 units, offset, under a scaled parent */
function model() {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(0.5);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
  mesh.position.set(5, 3, 0);
  inner.add(mesh);
  root.add(inner);
  return root;
}

test('fitProp: fitted height, base on y=0, centred, re-skinned, source untouched', () => {
  const src = model();
  const before = src.children[0].children[0].geometry.getAttribute('position').array.slice();
  const skin = pbrMaterial('metal');
  const prop = fitProp(src, 0.5, skin);
  const box = new THREE.Box3().setFromObject(prop);
  assert.ok(Math.abs(box.max.y - box.min.y - 0.5) < 1e-6, 'fitted to 0.5 m');
  assert.ok(Math.abs(box.min.y) < 1e-6, 'stands on its origin');
  assert.ok(Math.abs((box.min.x + box.max.x) / 2) < 1e-6 && Math.abs((box.min.z + box.max.z) / 2) < 1e-6, 'centred');
  prop.traverse((o) => {
    if (!o.isMesh) return;
    assert.equal(o.material, skin);
    assert.ok(o.geometry.getAttribute('uv'), 'world UVs for the tiled skin');
    assert.equal(o.castShadow, true);
  });
  assert.deepEqual(src.children[0].children[0].geometry.getAttribute('position').array, before, 'the cached model is never mutated');
});

test('dressing appears only where its model loaded, and a solid prop becomes a collider', () => {
  const loaded = new Set(['kenney_furniture/books', 'kenney_industrial/tank']);
  const facade = { peekPBR: () => null, peekEquirect: () => null, peekGLTF: (ref) => (loaded.has(ref) ? model() : null) };
  const stage = { scene: new THREE.Scene() };
  const plain = new World3D(/** @type {any} */ ({ scene: new THREE.Scene() }), /** @type {any} */ (rng));
  const world = new World3D(/** @type {any} */ (stage), /** @type {any} */ (rng), /** @type {any} */ (facade));
  const dressed = (floor) => { const out = []; world.floorGroups[floor].traverse((o) => { if (o.userData.dressing) out.push(o.userData.dressing); }); return out; };
  assert.deepEqual(dressed('penthouse'), PROP_DRESSING.filter((p) => p.floor === 'penthouse' && loaded.has(p.asset)).map((p) => p.asset));
  assert.deepEqual(dressed('fl40'), [], 'the laptop did not load, so there is no laptop — and no placeholder');
  const solidTanks = PROP_DRESSING.filter((p) => p.floor === 'rooftop' && p.solid && loaded.has(p.asset)).length;
  assert.equal(world.collidersByFloor.rooftop.length, plain.collidersByFloor.rooftop.length + solidTanks);
});

test('assetsForFloor asks for each floor’s own dressing', () => {
  const refs = (f) => assetsForFloor(f).filter((x) => x.kind === 'gltf').map((x) => x.id);
  assert.deepEqual(refs('penthouse'), PROP_DRESSING.filter((p) => p.floor === 'penthouse').map((p) => p.asset));
  assert.deepEqual(refs('fl27'), []);
});

test('every dressing entry names a real model and a real skin', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../assets/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(checkPropRefs(manifest, PROP_DRESSING, Object.keys(PBR_LIBRARY)), []);
  const bad = checkPropRefs(manifest, [{ asset: 'kenney_furniture/sofa_xl', floor: 'penthouse', skin: 'velvet' }], Object.keys(PBR_LIBRARY));
  assert.equal(bad.length, 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/props.test.mjs`
Expected: FAIL, `Cannot find module …/props.js`

- [ ] **Step 3: Create** `data/propDressing.js`

```js
// @ts-check
// Opt-in CC0 clutter. Each entry places ONE model from a Kenney pack
// (assets/manifest.json → kenney_*) on a floor, re-skinned with a PBR library
// material so it shares the room's surfaces instead of Kenney's flat palette.
// Clutter only: the hero furniture stays procedural (src/scene3d/tower/
// furniture.js) — Kenney's chunky style reads as detail at hand scale and as a
// toy at room scale.
//
// A model that did not load is simply absent: dressing never falls back to a
// placeholder, so ?noassets=1 shows the v0.6 room.
//
// PURE DATA. tools/lint-assets.mjs checks every `asset` against the manifest
// and every `skin` against the PBR library.

/**
 * @typedef {object} PropDressing
 * @property {string} asset 'pack/model' — a model `as` name in assets/manifest.json
 * @property {string} floor
 * @property {[number, number]} at floor-local x, z in metres
 * @property {number} [y] base height: the top of whatever it stands on (default 0, the floor)
 * @property {number} [ry] yaw in radians
 * @property {number} height fitted height in metres (the model is scaled uniformly to it)
 * @property {string} skin a PBR_LIBRARY material name
 * @property {boolean} [solid] register its bounding box as an FP collider
 */

/** @type {PropDressing[]} */
export const PROP_DRESSING = [
  // penthouse — bar counter top y 1.09, coffee table top y 0.39
  { asset: 'kenney_furniture/books', floor: 'penthouse', at: [5.3, -4.3], y: 1.09, ry: 0.3, height: 0.2, skin: 'fabric' },
  { asset: 'kenney_furniture/plant_small', floor: 'penthouse', at: [-3.55, -0.2], y: 0.39, ry: 0.8, height: 0.32, skin: 'fabric' },
  { asset: 'kenney_furniture/trashcan', floor: 'penthouse', at: [2.7, -5.5], height: 0.5, skin: 'metal' },
  // fl40 — security desk top y 0.785
  { asset: 'kenney_furniture/laptop', floor: 'fl40', at: [-4.7, -2.3], y: 0.785, ry: 0.15, height: 0.22, skin: 'metalDark' },
  // basement — boxes stacked by the stash crate
  { asset: 'kenney_furniture/box_closed', floor: 'basement', at: [9.6, -7.1], ry: 0.4, height: 0.5, skin: 'wood', solid: true },
  { asset: 'kenney_furniture/box_closed', floor: 'basement', at: [9.9, -6.3], ry: -0.2, height: 0.42, skin: 'wood', solid: true },
  // rooftop — clear of the helipad (centre 4.5,0, r 3.2), the planters and the HVAC units
  { asset: 'kenney_industrial/tank', floor: 'rooftop', at: [8.2, 5.6], height: 2.4, skin: 'rust', solid: true },
  { asset: 'kenney_industrial/solar_panel', floor: 'rooftop', at: [-2.5, 6.4], ry: Math.PI, height: 1.1, skin: 'metal', solid: true },
];
```

- [ ] **Step 4: Create** `src/scene3d/tower/props.js`

```js
// @ts-check
// Fitting a loaded model into the room. Kenney models come in arbitrary units
// and pivots, so every prop is baked to world geometry, stood on its own
// origin, centred, scaled uniformly to a real height in metres, and re-skinned
// with one library material (with world UVs, since Kenney's atlas UVs mean
// nothing to a tiled PBR texture).
import * as THREE from 'three';
import { applyWorldUVs } from '../materials/worldUV.js';

/**
 * @param {THREE.Object3D} model a fresh clone from the asset facade — read, never mutated
 * @param {number} height target height in metres
 * @param {THREE.Material} material
 * @returns {THREE.Group}
 */
export function fitProp(model, height, material) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const h = box.max.y - box.min.y;
  const s = h > 1e-6 ? height / h : 1;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const mpr = material.userData?.metresPerRepeat ?? 1;
  const out = new THREE.Group();
  model.traverse((o) => {
    const mesh = /** @type {THREE.Mesh} */ (o);
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    g.translate(-cx, -box.min.y, -cz);
    g.scale(s, s, s);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    applyWorldUVs(g, mpr);
    const m = new THREE.Mesh(g, material);
    m.castShadow = m.receiveShadow = true;
    out.add(m);
  });
  return out;
}
```

- [ ] **Step 5: Floor assets and the builder**
  - In `src/scene3d/tower/floorAssets.js`:
    - Add `import { PROP_DRESSING } from '../../../data/propDressing.js';`.
    - Replace the `void floorId;` line with:

```js
  // this floor's own clutter (data/propDressing.js)
  for (const p of PROP_DRESSING) if (p.floor === floorId) list.push({ kind: 'gltf', id: p.asset });
```

  - In `src/scene3d/tower/zoneBuilder.js`:
    - Add these imports:

```js
import { fitProp } from './props.js';
import { PROP_DRESSING } from '../../../data/propDressing.js';
```

    - In `_buildFloor`, add `this._dressProps(floor.id);` directly after `this._buildFurniture(floor.id);`.
    - Add this method after `_buildFurniture`:

```js
  /**
   * Place this floor's Kenney clutter (data/propDressing.js). A model the
   * facade does not hold is skipped outright — clutter is optional detail,
   * and a placeholder box would be worse than the empty surface.
   * @param {string} floorId
   */
  _dressProps(floorId) {
    if (!this.assets) return;
    const group = this.floorGroups[floorId];
    for (const p of PROP_DRESSING) {
      if (p.floor !== floorId) continue;
      const model = this.assets.peekGLTF(p.asset);
      if (!model) continue;
      const prop = fitProp(model, p.height, pbrMaterial(p.skin));
      prop.position.set(p.at[0], p.y ?? 0, p.at[1]);
      prop.rotation.y = p.ry ?? 0;
      prop.userData.dressing = p.asset;
      group.add(prop);
      this.furnitureGroups[floorId].push(prop);
      if (p.solid) {
        prop.updateMatrixWorld(true);
        this.collidersByFloor[floorId].push(new THREE.Box3().setFromObject(prop));
      }
    }
  }
```

- [ ] **Step 6: Lint the references.** In `tools/lint-assets.mjs`:
  - Add these imports:

```js
import { checkPropRefs } from './lib/manifest.mjs';
import { PROP_DRESSING } from '../data/propDressing.js';
import { PBR_LIBRARY } from '../src/scene3d/materials/pbr.js';
```

  - Merge `checkPropRefs` into the existing `./lib/manifest.mjs` import rather than adding a second import from it.
  - Add this after the stray-files report:

```js
report('prop dressing names real models and skins', checkPropRefs(manifest, PROP_DRESSING, Object.keys(PBR_LIBRARY)));
```

- [ ] **Step 7: Run everything**

Run: `node --test test/unit/props.test.mjs && npm test && npm run lint && npm run test:e2e`
Expected: 4 prop tests PASS. The lint shows `✓ prop dressing names real models and skins`. The e2e suite is green with no console errors: a missing texture referenced by a GLB would be a GLTFLoader console error, which Task 6 prevented by shipping every sidecar.

- [ ] **Step 8: Look at it.** Start a run and visit the penthouse, fl40, the basement and the rooftop (`__ncld.debug.floor('<id>')`). Each prop should sit on its surface, not float or sink, and should not intersect furniture. Nudge `at`/`y` in `data/propDressing.js` for any that do, and re-check.

- [ ] **Step 9: Commit**

```bash
git add data/propDressing.js src/scene3d/tower/props.js src/scene3d/tower/floorAssets.js src/scene3d/tower/zoneBuilder.js tools/lint-assets.mjs test/unit/props.test.mjs
git commit -F - <<'EOF'
feat(scene): Kenney clutter as opt-in, re-skinned prop dressing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 16: alpha.2 release bookkeeping

**Files:**
- Modify: `package.json`, `CHANGELOG.md`, `README.md`, `AGENTS.md`, `docs/systems/scene-audio-ui.md`, `docs/screenshots/*.jpg`

- [ ] **Step 1: Version.** Set `package.json` `"version"` to `"0.7.0-alpha.2"`.

- [ ] **Step 2: CHANGELOG.** Add above the alpha.1 entry:

```markdown
## [0.7.0-alpha.2] — YYYY-MM-DD — Surfaces

The tower stops looking like untextured boxes. Every shell and furniture
surface comes from a named PBR library backed by Poly Haven scans, with the
old canvas textures as the fallback per surface.

### Added
- **PBR material library** (`src/scene3d/materials/pbr.js`) — `concrete`,
  `concreteFloor`, `metal`, `metalDark`, `tile`, `marble`, `wood`, `fabric`,
  `bedding`, `rust`. Each is a 1K Poly Haven set (albedo, normal, packed
  AO/roughness/metalness) when the asset pipeline has it, and the texGen
  canvas + Sobel normal map otherwise.
- **World-scale UVs** (`src/scene3d/materials/worldUV.js`) — one texture repeat
  per N metres on every box, so a 2.4 m counter and a 0.3 m shelf show their
  grain at the same scale.
- **Bevelled hero furniture** — couch, armchairs, bed, tables, counters and
  desks use RoundedBoxGeometry, so their edges catch a highlight. Colliders and
  sockets are unchanged.
- **Kenney prop dressing** (`data/propDressing.js`) — books, a plant, a bin, a
  laptop, boxes, a rooftop tank and solar panel, fitted to real heights and
  re-skinned with library materials. Opt-in per prop; absent (never a
  placeholder) if the model did not load.
- `World3D.create()` preloads each floor's assets before building it, so
  nothing pops in.

### Fixed
- Procedural textures were drawn with `Math.random()`, so every boot painted
  different concrete, wood grain and skyline windows. Each recipe now seeds its
  own stream from its cache key.
```

- [ ] **Step 3: Screenshots.** With the server running, run `node tools/screenshots.mjs`, which re-captures every shot at the default quality. Open each image and check:
  - the surfaces are textured;
  - nothing is black or blown out;
  - dressing props sit correctly.

- [ ] **Step 4: README / AGENTS / docs.**
  - README `## Features`, in the **Procedural 3D everything** bullet: change `14 zones across 7 floors` to `14 zones across 7 floors built from a PBR material library (Poly Haven scans, procedural fallback) with world-scale UVs and bevelled hero furniture`.
  - README: update the test counts in `## Development`.
  - AGENTS.md: set the version line to `**0.7.0-alpha.2**` and the roadmap item to `(this sub-project, at alpha.2)`.
  - AGENTS.md `## Architecture spine`: add this bullet:

```markdown
- **`src/scene3d/materials/pbr.js`** — every shell and furniture surface is a
  named library material (`pbrMaterial(name, {tint, roughness, metalness})`),
  shared per key, carrying `userData.metresPerRepeat` for world UVs. Add a
  surface to the library rather than building a one-off MeshStandardMaterial.
```

  - `docs/systems/scene-audio-ui.md`: add a `### Materials` subsection covering:
    - the library table (name → Poly Haven set → metres per repeat);
    - the hybrid rule;
    - world UVs (`applyWorldUVsTo` runs once per floor);
    - bevels (`box(…, { bevel })`);
    - the seeded texGen (`recipeRandom`);
    - prop dressing (`fitProp`, absent-not-placeholder);
    - `World3D.create()` per-floor preload.

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run lint && npm run test:e2e`

```bash
git add package.json CHANGELOG.md README.md AGENTS.md docs/systems/scene-audio-ui.md docs/screenshots
git commit -F - <<'EOF'
docs: v0.7.0-alpha.2 — PBR surfaces, world UVs, bevels, prop dressing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---
# Stage beta.1: HDRI, skyline, rain

### Task 17: Environment math (pure)

**Files:**
- Create: `src/scene3d/envMath.js`, `test/unit/envmath.test.mjs`

**Interfaces:**
- Produces:
  - `dipAndSwap(t, dur) → { k, swap, done }`
  - `windowOffsets(count, rng) → Float32Array` (xy pairs on a 1/8 grid in [0,1))
  - `rainLayout(count, vol, rng) → Float32Array` (xyz inside vol)
  - `rainCount(density) → int`
  - `RAIN_BASE = 900`, `RAIN_MAX = 1800`

- [ ] **Step 1: Write the failing test** `test/unit/envmath.test.mjs`

```js
// @ts-check
// src/scene3d/envMath.js — the pure half of the beta.1 environment work.
// The env crossfade is the one that matters most: PMREM maps cannot be blended,
// so a lighting preset change used to hard-cut every reflection in the room in
// one frame. Dipping environmentIntensity to 0 and swapping at the bottom hides
// the cut — but only if the swap really happens at the bottom and the
// intensity really comes back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dipAndSwap, windowOffsets, rainLayout, rainCount, RAIN_BASE, RAIN_MAX } from '../../src/scene3d/envMath.js';

const seq = (vals) => { let i = 0; return { next: () => vals[i++ % vals.length] }; };

test('dipAndSwap: full at the ends, zero at the bottom, swap exactly in the second half', () => {
  assert.deepEqual(dipAndSwap(0, 0.6), { k: 1, swap: false, done: false });
  const bottom = dipAndSwap(0.3, 0.6);
  assert.ok(Math.abs(bottom.k) < 1e-9);
  assert.equal(bottom.swap, true);
  assert.equal(dipAndSwap(0.2999, 0.6).swap, false);
  assert.deepEqual(dipAndSwap(0.6, 0.6), { k: 1, swap: true, done: true });
  assert.deepEqual(dipAndSwap(5, 0.6), { k: 1, swap: true, done: true });
});

test('dipAndSwap: down monotonically, then up monotonically', () => {
  let prev = 1;
  for (let t = 0; t <= 0.3; t += 0.01) { const { k } = dipAndSwap(t, 0.6); assert.ok(k <= prev + 1e-12); prev = k; }
  for (let t = 0.3; t < 0.6; t += 0.01) { const { k } = dipAndSwap(t, 0.6); assert.ok(k >= prev - 1e-12); prev = k; }
});

test('dipAndSwap: a zero duration is an immediate swap', () => {
  assert.deepEqual(dipAndSwap(0, 0), { k: 1, swap: true, done: true });
});

test('windowOffsets: one xy per tower, on the window grid, deterministic', () => {
  const a = windowOffsets(80, seq([0.01, 0.2, 0.51, 0.99]));
  assert.equal(a.length, 160);
  for (const v of a) {
    assert.ok(v >= 0 && v < 1);
    assert.equal(v * 8, Math.round(v * 8), 'snapped to 1/8 so window columns stay aligned');
  }
  assert.deepEqual([...windowOffsets(4, seq([0.3, 0.7]))], [...windowOffsets(4, seq([0.3, 0.7]))]);
});

test('rainLayout: every drop inside its volume', () => {
  const vol = { x: /** @type {[number,number]} */ ([-16, 30]), y: /** @type {[number,number]} */ ([0, 18]), z: /** @type {[number,number]} */ ([5, 40]) };
  const p = rainLayout(200, vol, seq([0, 0.25, 0.5, 0.75, 0.999]));
  assert.equal(p.length, 600);
  for (let i = 0; i < 200; i++) {
    assert.ok(p[i * 3] >= -16 && p[i * 3] < 30);
    assert.ok(p[i * 3 + 1] >= 0 && p[i * 3 + 1] < 18);
    assert.ok(p[i * 3 + 2] >= 5 && p[i * 3 + 2] < 40);
  }
});

test('rainCount scales with density and clamps', () => {
  assert.equal(rainCount(1), RAIN_BASE);
  assert.equal(rainCount(0.5), RAIN_BASE / 2);
  assert.equal(rainCount(0), 0);
  assert.equal(rainCount(-1), 0);
  assert.equal(rainCount(99), RAIN_MAX);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/envmath.test.mjs`
Expected: FAIL, `Cannot find module …/envMath.js`

- [ ] **Step 3: Implement** `src/scene3d/envMath.js`

```js
// @ts-check
// Pure helpers for the environment + exterior pass (lighting.js, zoneBuilder.js,
// rain.js). No three.js, no DOM — so the timing and layout rules are unit-tested.

const smooth = (x) => x * x * (3 - 2 * x);

/**
 * The environment-map crossfade. PMREM textures cannot be blended, so a preset
 * change dips `scene.environmentIntensity` to 0 over the first half, swaps the
 * map at the bottom (where the swap is invisible), and rises over the second.
 * @param {number} t seconds since the dip began
 * @param {number} dur total dip length, seconds
 * @returns {{k:number, swap:boolean, done:boolean}} k multiplies the target intensity
 */
export function dipAndSwap(t, dur) {
  if (!(dur > 0) || t >= dur) return { k: 1, swap: true, done: true };
  const half = dur / 2;
  if (t < half) return { k: 1 - smooth(Math.max(0, t) / half), swap: false, done: false };
  return { k: smooth((t - half) / half), swap: true, done: false };
}

/**
 * Per-tower offsets into the lit-window texture, so no two neighbouring towers
 * show the same windows. Snapped to 1/8 — the texture's window grid — so every
 * offset lands a whole window, never half of one.
 * @param {number} count @param {{next: () => number}} rng
 */
export function windowOffsets(count, rng) {
  const out = new Float32Array(count * 2);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(rng.next() * 8) / 8;
  return out;
}

/**
 * Initial drop positions, uniformly inside `vol`. The shader wraps them, so
 * this is the only time rain touches the CPU.
 * @param {number} count
 * @param {{x:[number,number], y:[number,number], z:[number,number]}} vol
 * @param {{next: () => number}} rng
 */
export function rainLayout(count, vol, rng) {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] = vol.x[0] + rng.next() * (vol.x[1] - vol.x[0]);
    out[i * 3 + 1] = vol.y[0] + rng.next() * (vol.y[1] - vol.y[0]);
    out[i * 3 + 2] = vol.z[0] + rng.next() * (vol.z[1] - vol.z[0]);
  }
  return out;
}

/** Streaks at density 1 (the high preset). */
export const RAIN_BASE = 900;
/** Allocated once per volume; ultra's 1.4 fits, anything denser clamps. */
export const RAIN_MAX = 1800;

/** @param {number} density preset rain density (0 = dry) */
export function rainCount(density) {
  if (!(density > 0)) return 0;
  return Math.min(RAIN_MAX, Math.round(RAIN_BASE * density));
}
```

- [ ] **Step 4: Run the test**

Run: `node --test test/unit/envmath.test.mjs`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/scene3d/envMath.js test/unit/envmath.test.mjs
git commit -F - <<'EOF'
feat(scene): pure env-dip, window-offset and rain-layout helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 18: HDRI image-based lighting with a crossfade

**Files:**
- Modify:
  - `src/scene3d/env.js`, `src/scene3d/lighting.js`
  - `data/lightingPresets.js`, `config/lighting.yaml`
  - `data/configDefaults.js`, `data/configSchema.js`, `config/render.yaml` (`render.hdri.id`)
  - `src/scene3d/tower/floorAssets.js`, `src/scene3d/tower/zoneBuilder.js` (the `World3D.create` option)
  - `src/core/app.js`, `test/unit/envmath.test.mjs`, `test/unit/furniture-pbr.test.mjs`, `test/smoke/smoke.spec.mjs`

**Interfaces:**
- Consumes: `dipAndSwap` (Task 17); `assets.loadEquirect`/`peekEquirect` (Task 7)
- Produces:
  - `EnvBuilder.setHDRI(equirect|null)`, `EnvBuilder.hdri`
  - `env.get(key, { …, skyTint, skyExposure })`
  - `new Lighting(stage, assets = null, { hdri = 'off', hdriId = 'shanghai_bund' })`
  - `lighting.ready: Promise<equirect|null>`
  - `lighting.setHDRI(res: 'off'|'1k'|'2k') → Promise<equirect|null>`
  - `lighting.skyColor: THREE.Color`, `lighting.onSkyGrade: ((c: Color) => void)|null`
  - Per-preset data `ibl: { envIntensity, rotation, skyTint, skyExposure }`
  - `assetsForFloor(floorId, { equirect })`
  - `World3D.create(stage, rng, assets, { equirect })`, `world.equirectId`
  - Config key `render.hdri.id`

- [ ] **Step 1: Write the failing tests**
  - Append to `test/unit/envmath.test.mjs`:

```js
test('every lighting preset grades the IBL and the sky; a blackout darkens the sky', async () => {
  const { LIGHTING_PRESETS } = await import('../../data/lightingPresets.js');
  for (const [id, p] of Object.entries(LIGHTING_PRESETS)) {
    assert.ok(p.ibl, `${id} has no ibl block`);
    for (const k of ['envIntensity', 'rotation', 'skyTint', 'skyExposure']) assert.equal(typeof p.ibl[k], 'number', `${id}.ibl.${k}`);
  }
  assert.ok(LIGHTING_PRESETS.blackout_emergency.ibl.skyExposure < LIGHTING_PRESETS.neon_night.ibl.skyExposure);
});
```

  - Append to `test/unit/furniture-pbr.test.mjs`:

```js
test('the sky floors also preload the HDRI equirect', () => {
  const eq = (f) => assetsForFloor(f, { equirect: 'shanghai_bund_2k' }).filter((x) => x.kind === 'equirect').map((x) => x.id);
  assert.deepEqual(eq('penthouse'), ['shanghai_bund_2k']);
  assert.deepEqual(eq('rooftop'), ['shanghai_bund_2k']);
  assert.deepEqual(eq('fl27'), [], 'an interior floor has no sky to show');
  assert.deepEqual(assetsForFloor('penthouse').filter((x) => x.kind === 'equirect'), [], 'hdri off → none');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/unit/envmath.test.mjs test/unit/furniture-pbr.test.mjs`
Expected: FAIL, with `neon_night has no ibl block` and the equirect assertion.

- [ ] **Step 3: Preset data.** In `data/lightingPresets.js`:
  - Extend the `LightPreset` typedef with ` ibl?:{envIntensity:number, rotation:number, skyTint:number, skyExposure:number},` before `pulse?`.
  - Add one `ibl:` line to each preset, directly after its `exposure:` line:

| Preset | Line to add |
|---|---|
| `neon_night` | `ibl: { envIntensity: 0.4, rotation: 0, skyTint: 0xffffff, skyExposure: 1.0 },` |
| `blackout_emergency` | `ibl: { envIntensity: 0.15, rotation: 0, skyTint: 0x6a5060, skyExposure: 0.25 },` |
| `golden_hour` | `ibl: { envIntensity: 0.5, rotation: 1.2, skyTint: 0xffd0a0, skyExposure: 1.3 },` |
| `candlelit` | `ibl: { envIntensity: 0.25, rotation: 0, skyTint: 0xffc890, skyExposure: 0.5 },` |
| `dawn_grey` | `ibl: { envIntensity: 0.45, rotation: 2.4, skyTint: 0xc8d0e0, skyExposure: 0.9 },` |
| `storm` | `ibl: { envIntensity: 0.3, rotation: 0.8, skyTint: 0x9fb0d0, skyExposure: 0.6 },` |
| `club_pulse` | `ibl: { envIntensity: 0.45, rotation: 0, skyTint: 0xffa8e8, skyExposure: 1.1 },` |
| `fireplace_warm` | `ibl: { envIntensity: 0.3, rotation: 0, skyTint: 0xffb080, skyExposure: 0.6 },` |
| `security_red` | `ibl: { envIntensity: 0.25, rotation: 0, skyTint: 0xff7070, skyExposure: 0.5 },` |
| `morning_haze` | `ibl: { envIntensity: 0.5, rotation: 2.0, skyTint: 0xe0e8f0, skyExposure: 1.1 },` |

  - Add the same values to `config/lighting.yaml` as one line per preset after its `exposure:` line, in flow style. For example, under `neon_night:` add `    ibl: { envIntensity: 0.4, rotation: 0, skyTint: 0xffffff, skyExposure: 1.0 }`.
  - Add this comment line to the file header:

```yaml
# `ibl` grades image-based lighting per preset: envIntensity (reflection
# strength), rotation (radians, turns the reflected city), and skyTint ×
# skyExposure (the exterior HDRI dome, e.g. a blackout darkens the city).
```

- [ ] **Step 4: Config key for the HDRI id.**
  - In `data/configDefaults.js` `render: { … }`, before `fov:`, add:

```js
    hdri: { id: 'shanghai_bund' },   // assets/manifest.json hdri entries are `${id}_${1k|2k}`
```

  - In `data/configSchema.js` `render: { … }`, before `fov:`, add `hdri: { id: { type: 'string' } },`.
  - In `config/render.yaml`, before `fov:`, add:

```yaml
# The HDRI behind image-based lighting and the exterior sky dome. The quality
# preset picks the resolution (assets/manifest.json has `${id}_1k` and `${id}_2k`).
hdri:
  id: shanghai_bund
```

- [ ] **Step 5: `src/scene3d/env.js`**
  - Replace the header paragraph that starts `// Everything here is generated at runtime` (through the parenthesised note about `tools/gen-art.mjs`) with:

```js
// Two sources, one output. With the asset pipeline, the sky is the
// `shanghai_bund` HDRI — a real night city — tinted per lighting preset;
// without it (?noassets=1, a missing file), a generated gradient sky with a
// city-glow band. Either way a few dim neon sign cards and a warm floor bounce
// are composited in as local accents, and the lot is PMREM-prefiltered once per
// preset, so a preset change retints what chrome, glass, skin and hair reflect.
```

  - In the constructor, after `this.cache = new Map();`, add:

```js
    /** @type {THREE.Texture|null} equirect HDRI from the asset pipeline; null = procedural sky */
    this.hdri = null;
```

  - Add this method after the constructor:

```js
  /**
   * Swap the sky source. Clears the cache: every preset's prefiltered map was
   * built from the old sky.
   * @param {THREE.Texture|null} equirect
   */
  setHDRI(equirect) {
    if (equirect === this.hdri) return;
    this.hdri = equirect;
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
  }
```

  - In `get()`:
    - Extend the `opts` JSDoc with `skyTint?:number, skyExposure?:number`.
    - Add `skyTint = 0xffffff, skyExposure = 1,` to the destructuring.
    - Replace the block from `const skyGeo = new THREE.SphereGeometry(60, 24, 16);` through `disposables.push(skyGeo, skyMat);` with:

```js
    const skyGeo = new THREE.SphereGeometry(60, 48, 24);
    disposables.push(skyGeo);
    if (this.hdri) {
      // The real night city, graded by the preset: a blackout darkens what the
      // chrome reflects as well as what the window shows.
      const skyMat = new THREE.MeshBasicMaterial({
        map: this.hdri, side: THREE.BackSide, depthWrite: false,
        color: new THREE.Color(skyTint).multiplyScalar(skyExposure),
      });
      const sky = new THREE.Mesh(skyGeo, skyMat);
      sky.scale.x = -1;   // seen from inside, a sphere mirrors the panorama; flip it back
      scene.add(sky);
      disposables.push(skyMat);
    } else {
      const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          skyColor: { value: new THREE.Color(sky) },
          horizonColor: { value: new THREE.Color(horizon) },
          groundColor: { value: new THREE.Color(ground) },
          horizonTightness: { value: 5.0 },
          intensity: { value: intensity },
        },
        vertexShader: SkyShader.vertexShader,
        fragmentShader: SkyShader.fragmentShader,
      });
      scene.add(new THREE.Mesh(skyGeo, skyMat));
      disposables.push(skyMat);
    }
```

- [ ] **Step 6: `src/scene3d/lighting.js`**
  - Add `import { dipAndSwap } from './envMath.js';` to the imports.
  - Add these module-level declarations below `const todKeys = …`:

```js
/** Seconds for the environment-map dip-and-swap on a preset change. */
const ENV_DIP_SEC = 0.6;

/** A preset's exterior-sky grade as one linear colour: skyTint × skyExposure. */
function skyGrade(p) {
  return new THREE.Color(p?.ibl?.skyTint ?? 0xffffff).multiplyScalar(p?.ibl?.skyExposure ?? 1);
}
```

  - Change the constructor signature to `constructor(stage, assets = null, { hdri = 'off', hdriId = 'shanghai_bund' } = {})` and extend its JSDoc:

```js
  /**
   * @param {import('./stage.js').Stage} stage
   * @param {ReturnType<typeof import('../assets/assets.js').createAssets>|null} [assets]
   * @param {{hdri?: 'off'|'1k'|'2k', hdriId?: string}} [opts]
   */
```

  - Replace the last two constructor lines (`this.env = new EnvBuilder(stage.renderer);` and `this._applyEnv('neon_night');`) with:

```js
    this.env = new EnvBuilder(stage.renderer);
    this.assets = assets;
    this.hdriId = hdriId;
    /** @type {'off'|'1k'|'2k'} */
    this.hdriRes = 'off';
    /** @type {{t:number, dur:number, id:string, swapped:boolean}|null} */
    this._envDip = null;
    this._envTarget = cfg('lighting.envIntensity', 0.4);
    /** @type {((color: THREE.Color) => void)|null} set by the app — grades the exterior sky dome */
    this.onSkyGrade = null;
    this.skyColor = skyGrade(presets().neon_night);
    this._skyFrom = this.skyColor.clone();
    this._skyTo = this.skyColor.clone();
    this._applyEnv('neon_night', { dip: false });
    /** settles (never rejects) once the HDRI is loaded and the environment rebuilt from it */
    this.ready = this.setHDRI(hdri);
```

  - Replace the whole `_applyEnv(id) { … }` method (and its JSDoc) with:

```js
  /**
   * Retarget the environment for a preset. PMREM maps cannot blend, so a
   * preset change dips environmentIntensity to 0, swaps the map at the bottom,
   * and brings it back (ENV_DIP_SEC) — the old hard cut changed every
   * reflection in the room in a single frame.
   * @param {string} id @param {{dip?: boolean}} [o]
   */
  _applyEnv(id, { dip = true } = {}) {
    if (!presets()[id]) return;
    if (!dip) { this._envDip = null; this._swapEnv(id); return; }
    this._envDip = { t: 0, dur: ENV_DIP_SEC, id, swapped: false };
  }

  /** @param {string} id */
  _swapEnv(id) {
    const p = presets()[id];
    if (!p) return;
    try {
      this.stage.scene.environment = this.env.get(id, {
        sky: p.fog?.color ?? 0x05070f,
        horizon: p.hemi?.sky ?? 0x1b2a55,
        ground: p.hemi?.ground ?? 0x07060a,
        signs: [p.cool?.color ?? 0x39e6ff, p.accent?.color ?? 0xff3fa4, p.warm?.color ?? 0xffb347],
        intensity: THREE.MathUtils.clamp(p.hemi?.intensity ?? 1, 0.12, 2),
        skyTint: p.ibl?.skyTint ?? 0xffffff,
        skyExposure: p.ibl?.skyExposure ?? 1,
      });
      // reflections should not overpower the authored key/fill balance
      this._envTarget = p.ibl?.envIntensity ?? cfg('lighting.envIntensity', 0.4);
      if (!this._envDip) this.stage.scene.environmentIntensity = this._envTarget;
      // turns the reflected city only; the visible dome stays put, so the
      // skyline never jumps when a preset changes
      this.stage.scene.environmentRotation.y = p.ibl?.rotation ?? 0;
      this.hemi.intensity = this._hemi(p.hemi?.intensity ?? this.hemi.intensity);
    } catch (err) {
      // IBL is an enhancement, never a boot blocker
      console.warn('[lighting] env map build failed', err);
    }
  }

  /** @param {number} dt seconds */
  _stepEnvDip(dt) {
    const d = /** @type {{t:number, dur:number, id:string, swapped:boolean}} */ (this._envDip);
    d.t += dt;
    const { k, swap, done } = dipAndSwap(d.t, d.dur);
    if (swap && !d.swapped) { this._swapEnv(d.id); d.swapped = true; }
    this.stage.scene.environmentIntensity = this._envTarget * k;
    if (done) { this._envDip = null; this.stage.scene.environmentIntensity = this._envTarget; }
  }

  /**
   * Switch the IBL source to the HDRI at `res`, or back to the procedural sky.
   * Resolves with the equirect (or null) so the caller can hand the same
   * texture to the exterior dome. Never rejects.
   * @param {'off'|'1k'|'2k'} res
   */
  async setHDRI(res) {
    this.hdriRes = res;
    const id = res === 'off' ? null : `${this.hdriId}_${res}`;
    const eq = id && this.assets ? await this.assets.loadEquirect(id) : null;
    if (this.hdriRes !== res) return eq;   // a later call won the race
    this.env.setHDRI(eq);
    this._swapEnv(this.presetId);
    return eq;
  }
```

  - In `apply(id, fadeSec)`, replace `this._applyEnv(id);` with:

```js
    this._skyFrom.copy(this.skyColor);
    this._skyTo.copy(skyGrade(preset));
    this._applyEnv(id, { dip: fadeSec >= 0.05 });
```

  - In `update(dt)`:
    - Directly after `this._t += dt;`, add `if (this._envDip) this._stepEnvDip(dt);`.
    - Inside the `if (this._fadeT < 1 && this._from) { … }` block, after the `toneMappingExposure` lerp line, add:

```js
      this.skyColor.copy(this._skyFrom).lerp(this._skyTo, k);
      this.onSkyGrade?.(this.skyColor);
```

- [ ] **Step 7: Floor assets and `World3D.create`.**
  - `src/scene3d/tower/floorAssets.js`: replace the function with:

```js
/** Floors whose exterior shows the sky dome (zoneBuilder `_buildExterior`). */
export const SKY_FLOORS = ['penthouse', 'rooftop'];

/**
 * @param {string} floorId
 * @param {{equirect?: string|null}} [opts] the HDRI equirect id the sky dome uses; null = no HDRI
 * @returns {{kind: import('../../assets/assets.js').AssetKind, id: string}[]}
 */
export function assetsForFloor(floorId, { equirect = null } = {}) {
  // the library's sets are shared by every floor; after the first floor these resolve from cache
  /** @type {{kind: import('../../assets/assets.js').AssetKind, id: string}[]} */
  const list = PBR_SET_IDS.map((id) => ({ kind: 'pbr', id }));
  if (equirect && SKY_FLOORS.includes(floorId)) list.push({ kind: 'equirect', id: equirect });
  // this floor's own clutter (data/propDressing.js)
  for (const p of PROP_DRESSING) if (p.floor === floorId) list.push({ kind: 'gltf', id: p.asset });
  return list;
}
```

  - `src/scene3d/tower/zoneBuilder.js`:
    - Constructor signature: change `{ build = true } = {}` to `{ build = true, equirect = null } = {}` and document it: ` equirect: the HDRI equirect id for the sky dome (null = the flat skyline plate)`.
    - Add `this.equirectId = equirect;` after `this.assets = assets;`.
    - `create()`: change its signature to `static async create(stage, rng, assets, { equirect = null } = {})`, construct with `new World3D(stage, rng, assets, { build: false, equirect })`, and preload with `assetsForFloor(floor.id, { equirect })`.

- [ ] **Step 8: App wiring** (`src/core/app.js`)
  - Add `import { cfg } from './config.js';` if it is not already imported.
  - In `startRun()`, replace the `World3D.create(…)` line and the `this.lighting = new Lighting(this.stage);` line as follows:

```js
    // beta.2 moves the resolution into the quality preset (render.quality → hdri)
    const hdri = /** @type {'off'|'1k'|'2k'} */ ('2k');
    const hdriId = cfg('render.hdri.id', 'shanghai_bund');
    this.world = await World3D.create(this.stage, this.rng.stream('world'), this.assets, {
      equirect: hdri === 'off' ? null : `${hdriId}_${hdri}`,
    });
```

```js
    this.lighting = new Lighting(this.stage, this.assets, { hdri, hdriId });
    await this.lighting.ready;   // the env is rebuilt from the HDRI before shaders compile
```

  - Keep `rimPool.init(…)`, `this.world.precompile(…)`, `this.lighting.clock = …` and `this.lighting.apply('neon_night', 0.01);` in their current order after these lines.

- [ ] **Step 9: Smoke test.** Add to `test/smoke/smoke.spec.mjs`:

```js
  test('image-based lighting comes from the HDRI, and a preset change dips and swaps it', async ({ page }) => {
    await bootToRun(page);
    const r = await page.evaluate(async () => {
      const app = window.__ncld.app;
      const envBefore = app.stage.scene.environment?.uuid;
      const target0 = app.lighting._envTarget;
      app.lighting.apply('blackout_emergency', 1.2);
      // poll the dip instead of sampling once: under SwiftShader a frame can take 200ms
      let lowest = Infinity;
      const t0 = performance.now();
      while (performance.now() - t0 < 4000 && app.lighting._envDip) {
        lowest = Math.min(lowest, app.stage.scene.environmentIntensity);
        await new Promise((res) => setTimeout(res, 30));
      }
      return {
        hdri: !!app.lighting.env.hdri, target0, lowest,
        swapped: app.stage.scene.environment?.uuid !== envBefore,
        after: app.stage.scene.environmentIntensity, target: app.lighting._envTarget,
      };
    });
    expect(r.hdri).toBe(true);
    expect(r.lowest).toBeLessThan(r.target0);
    expect(r.swapped).toBe(true);
    expect(r.after).toBeCloseTo(r.target, 5);
  });
```

  - In the `?noassets=1` test, add `hdri: !!window.__ncld.app.lighting.env.hdri,` to the evaluated state and `expect(state.hdri).toBe(false);`.

- [ ] **Step 10: Run everything**

Run: `npm test && npm run lint && npm run test:e2e`
Expected: all green, and the config lint passes with the new `render.hdri` key.

- [ ] **Step 11: Commit**

```bash
git add src/scene3d/env.js src/scene3d/lighting.js data/lightingPresets.js config/lighting.yaml data/configDefaults.js data/configSchema.js config/render.yaml src/scene3d/tower/floorAssets.js src/scene3d/tower/zoneBuilder.js src/core/app.js test/unit/envmath.test.mjs test/unit/furniture-pbr.test.mjs test/smoke/smoke.spec.mjs
git commit -F - <<'EOF'
feat(lighting): HDRI image-based lighting, graded per preset, with a dip-and-swap crossfade

The shanghai_bund HDRI replaces the gradient sky inside the PMREM capture
(sign cards and floor bounce still composited as local accents); each
preset sets envIntensity, a rotation and a sky tint/exposure. Preset
changes dip environmentIntensity over 0.6s instead of hard-cutting every
reflection. The procedural sky stays as the fallback.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 19: Skyline dome and emissive windows with per-tower offsets

**Files:**
- Create: `test/unit/skyline.test.mjs`, `test/unit/shaderpatch.test.mjs`
- Modify: `src/scene3d/materials/cityWindows.js`, `src/scene3d/tower/zoneBuilder.js`, `src/core/app.js`, `test/smoke/smoke.spec.mjs`

**Interfaces:**
- Consumes: `windowOffsets` (Task 17); `lighting.skyColor` and `onSkyGrade` (Task 18); `world.equirectId`
- Produces:
  - `patchWindowOffsets(material) → material`, `cityTowerMaterial(emissiveMap) → MeshStandardMaterial`
  - `world.exteriors: {group, fromRoof, plate, dome}[]`
  - `world.setSkyTexture(equirect|null)`, `world.setSkyGrade(color)`
  - `DOME_RADIUS = 180`

- [ ] **Step 1: Write the failing tests**
  - Create `test/unit/shaderpatch.test.mjs`:

```js
// @ts-check
// onBeforeCompile patches find their anchors by #include name. three renames
// chunks between releases, and a missing anchor makes String.replace a silent
// no-op: the material compiles, the effect never appears. So the patches are
// run against r185's REAL shader sources here, not stand-in strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { patchWindowOffsets } from '../../src/scene3d/materials/cityWindows.js';

/** @param {string} lib */
const shaderOf = (lib) => ({ uniforms: {}, vertexShader: THREE.ShaderLib[lib].vertexShader, fragmentShader: THREE.ShaderLib[lib].fragmentShader });

test('the window-offset patch lands in the r185 standard vertex shader', () => {
  const m = patchWindowOffsets(new THREE.MeshStandardMaterial());
  const s = shaderOf('standard');
  m.onBeforeCompile(/** @type {any} */ (s), /** @type {any} */ (null));
  assert.match(s.vertexShader, /attribute vec2 aWinOffset;/);
  assert.match(s.vertexShader, /vEmissiveMapUv \+= aWinOffset;/);
  assert.equal(m.customProgramCacheKey(), 'city-window-offsets');
});
```

  - Create `test/unit/skyline.test.mjs`:

```js
// @ts-check
// The exterior: the HDRI dome replaces the flat skyline billboard when the
// HDRI loaded, the billboard remains the fallback, the preset grades the dome,
// and every tower reads the window texture at its own offset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './helpers/dom.mjs';

installFakeDom();
const THREE = await import('three');
const { World3D } = await import('../../src/scene3d/tower/zoneBuilder.js');

const rng = { next: () => 0.5, chance: () => false, int: (a) => a, pick: (a) => a[0], range: (a) => a };
const equirect = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
const facade = { peekPBR: () => null, peekGLTF: () => null, peekEquirect: (id) => (id === 'sky_2k' ? equirect : null) };
const build = (eq) => new World3D(/** @type {any} */ ({ scene: new THREE.Scene() }), /** @type {any} */ (rng), /** @type {any} */ (facade), { equirect: eq });

test('with the HDRI: one dome per exterior, textured with it', () => {
  const world = build('sky_2k');
  assert.equal(world.exteriors.length, 2, 'penthouse + rooftop');
  for (const ext of world.exteriors) {
    assert.ok(ext.dome?.visible);
    assert.equal(ext.dome.material.map, equirect);
    assert.equal(ext.dome.material.fog, false);
  }
});

test('without it: no dome — the skyline plate is the fallback', () => {
  for (const ext of build(null).exteriors) assert.equal(ext.dome, null);
});

test('setSkyTexture toggles live; setSkyGrade tints every dome', () => {
  const world = build('sky_2k');
  world.setSkyTexture(null);
  for (const ext of world.exteriors) assert.equal(ext.dome.visible, false);
  world.setSkyTexture(equirect);
  for (const ext of world.exteriors) assert.equal(ext.dome.visible, true);
  world.setSkyGrade(new THREE.Color(0.2, 0.1, 0.1));
  for (const ext of world.exteriors) assert.ok(ext.dome.material.color.equals(new THREE.Color(0.2, 0.1, 0.1)));
  const later = build(null);
  later.setSkyGrade(new THREE.Color(0.5, 0.5, 0.5));
  later.setSkyTexture(equirect);
  assert.ok(later.exteriors[0].dome.material.color.equals(new THREE.Color(0.5, 0.5, 0.5)), 'a dome created later picks up the current grade');
});

test('the towers are one instanced, emissive, per-instance-offset mesh per exterior', () => {
  const world = build(null);
  for (const ext of world.exteriors) {
    const towers = ext.group.children.find((o) => o.isInstancedMesh);
    assert.ok(towers, 'instanced towers');
    assert.equal(towers.geometry.getAttribute('aWinOffset').count, towers.count);
    assert.ok(towers.material.isMeshStandardMaterial);
    assert.ok(towers.material.emissiveMap);
    assert.equal(towers.material.customProgramCacheKey(), 'city-window-offsets');
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/unit/shaderpatch.test.mjs test/unit/skyline.test.mjs`
Expected: FAIL. `patchWindowOffsets` is not exported, and `world.exteriors` is undefined.

- [ ] **Step 3: `src/scene3d/materials/cityWindows.js`**: append:

```js
/**
 * Every tower is one instance of one box, so without this they all read the
 * window texture at the same place and the skyline repeats itself. Each
 * instance carries its own offset (InstancedBufferAttribute `aWinOffset`,
 * see src/scene3d/envMath.js windowOffsets) added to the emissive map UV.
 * @template {THREE.MeshStandardMaterial} M
 * @param {M} material
 * @returns {M}
 */
export function patchWindowOffsets(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWinOffset;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_EMISSIVEMAP\n\tvEmissiveMapUv += aWinOffset;\n#endif');
  };
  // the patch changes the program, so it needs its own cache key
  material.customProgramCacheKey = () => 'city-window-offsets';
  return material;
}

/**
 * The exterior towers: dark lit bodies that catch the HDRI in reflections, with
 * the windows as EMISSION (they are light sources, not a painted texture).
 * @param {THREE.Texture} emissiveMap
 */
export function cityTowerMaterial(emissiveMap) {
  // offsets reach past 1, so the texture must wrap rather than smear its edge
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  return patchWindowOffsets(new THREE.MeshStandardMaterial({
    color: 0x07080d, roughness: 0.55, metalness: 0.35,
    emissive: 0xffffff, emissiveMap, emissiveIntensity: 1.25,
  }));
}
```

- [ ] **Step 4: `src/scene3d/tower/zoneBuilder.js`**
  - Change the cityWindows import to `import { cityWindowsTexture, cityTowerMaterial } from '../materials/cityWindows.js';` and add `import { windowOffsets } from '../envMath.js';`.
  - Add a module constant after `const TAU = …`:

```js
/** Radius of the HDRI sky dome: past the farthest tower (≈95 m) and well inside the camera's 400 m far plane. */
const DOME_RADIUS = 180;
```

  - In the constructor, add these fields before `this.activeFloor = 'penthouse';`:

```js
    /** @type {{group: THREE.Group, fromRoof: boolean, plate: THREE.Mesh|null, dome: THREE.Mesh|null}[]} */
    this.exteriors = [];
    /** @type {THREE.Color|null} the current sky grade (Lighting.skyColor), for domes made later */
    this._skyGrade = null;
```

  - Replace the whole `_buildExterior(group, fromRoof = false) { … }` method with:

```js
  _buildExterior(group, fromRoof = false) {
    // Declared FIRST: the loader callbacks below close over it (a TDZ read that
    // only survived because TextureLoader is always async bit this once).
    // The seeded canvas is the first frame and the fallback; windows.jpg replaces it.
    const matC = cityTowerMaterial(cityWindowsTexture());
    const loader = new THREE.TextureLoader();
    loader.load('/assets/city/windows.jpg', (map) => {
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      // Scale the tiling to the tower's real height so window aspect stays
      // constant: a flat repeat(2,4) gave ~32x64 windows per box face — windows
      // about 15cm wide — which aliased into moire that bloom then amplified.
      map.repeat.set(2, 4);
      map.anisotropy = Math.min(8, this.stage.renderer.capabilities.getMaxAnisotropy?.() ?? 1);
      matC.emissiveMap = map;
      matC.needsUpdate = true;
    });

    /** @type {{group: THREE.Group, fromRoof: boolean, plate: THREE.Mesh|null, dome: THREE.Mesh|null}} */
    const ext = { group, fromRoof, plate: null, dome: null };
    this.exteriors.push(ext);
    // The flat skyline plate is the fallback when there is no HDRI; with one,
    // the dome replaces it (and setSkyTexture can swap between them live).
    loader.load('/assets/city/skyline.jpg', (map) => {
      map.colorSpace = THREE.SRGBColorSpace;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(90, 40), new THREE.MeshBasicMaterial({ map, fog: true }));
      plate.position.set(4, fromRoof ? 8 : 2, fromRoof ? 42 : 48);
      plate.lookAt(4, fromRoof ? 8 : 2, 0);
      plate.visible = !ext.dome?.visible;
      group.add(plate);
      ext.plate = plate;
    });
    const eq = this.equirectId ? this.assets?.peekEquirect(this.equirectId) ?? null : null;
    if (eq) this._showDome(ext, eq);

    const COUNT = 80;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.setAttribute('aWinOffset', new THREE.InstancedBufferAttribute(windowOffsets(COUNT, this.rng), 2));
    const mesh = new THREE.InstancedMesh(geo, matC, COUNT);
    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    let i = 0;
    while (i < COUNT) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(30, 90);
      const x = Math.cos(a) * r + 4;
      const z = fromRoof ? Math.sin(a) * r : Math.abs(Math.sin(a)) * r + 8;
      const hgt = this.rng.range(10, 55);
      quat.setFromEuler(new THREE.Euler(0, this.rng.range(0, Math.PI), 0));
      scale.set(this.rng.range(4, 10), hgt, this.rng.range(4, 10));
      m4.compose(new THREE.Vector3(x, hgt / 2 - (fromRoof ? 30 : 22), z), quat, scale);
      mesh.setMatrixAt(i++, m4);
    }
    group.add(mesh);
    for (let f = 0; f < 3; f++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(this.rng.range(1.5, 3), 8, 6),
        new THREE.MeshBasicMaterial({ color: PALETTE.fireGlow, transparent: true, opacity: 0.5 }));
      s.position.set(this.rng.range(-30, 40), this.rng.range(-18, -6), this.rng.range(25, 80));
      group.add(s);
      this.fireSprites.push(s);
    }
  }

  /**
   * The HDRI as the far skyline: a back-faced sphere around the exterior,
   * behind the instanced towers, unfogged (the towers fade into the fog and
   * read as silhouettes against it), drawn first and writing no depth — so AO
   * treats it as sky.
   * @param {{group: THREE.Group, fromRoof: boolean, plate: THREE.Mesh|null, dome: THREE.Mesh|null}} ext
   * @param {THREE.Texture} eq
   */
  _showDome(ext, eq) {
    if (!ext.dome) {
      const mat = new THREE.MeshBasicMaterial({ map: eq, side: THREE.BackSide, fog: false, depthWrite: false });
      if (this._skyGrade) mat.color.copy(this._skyGrade);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 48, 24), mat);
      dome.scale.x = -1;   // seen from inside, a sphere mirrors the panorama; flip it back
      // horizon a few degrees below eye level: this is floor 45
      dome.position.set(4, ext.fromRoof ? -12 : -8, ext.fromRoof ? 0 : 8);
      dome.renderOrder = -1;
      dome.name = 'sky_dome';
      ext.group.add(dome);
      ext.dome = dome;
    } else {
      const mat = /** @type {THREE.MeshBasicMaterial} */ (ext.dome.material);
      mat.map = eq;
      mat.needsUpdate = true;
    }
    ext.dome.visible = true;
    if (ext.plate) ext.plate.visible = false;
  }

  /**
   * Live HDRI switch (quality presets): swap the dome's panorama, or fall back
   * to the flat skyline plate.
   * @param {THREE.Texture|null} eq
   */
  setSkyTexture(eq) {
    for (const ext of this.exteriors) {
      if (eq) { this._showDome(ext, eq); continue; }
      if (ext.dome) ext.dome.visible = false;
      if (ext.plate) ext.plate.visible = true;
    }
  }

  /** @param {THREE.Color} color the preset's sky grade (Lighting.skyColor) */
  setSkyGrade(color) {
    this._skyGrade = color.clone();
    for (const ext of this.exteriors) {
      if (ext.dome) /** @type {THREE.MeshBasicMaterial} */ (ext.dome.material).color.copy(color);
    }
  }
```

- [ ] **Step 5: App wiring.** In `startRun()`, directly after `await this.lighting.ready;`, add:

```js
    // the exterior dome follows the preset's sky grade, fades included
    this.lighting.onSkyGrade = (c) => this.world.setSkyGrade(c);
    this.world.setSkyGrade(this.lighting.skyColor);
```

- [ ] **Step 6: Smoke test.** Add to `test/smoke/smoke.spec.mjs`:

```js
  test('the skyline is the HDRI dome, graded by the lighting preset', async ({ page }) => {
    await bootToRun(page);
    const r = await page.evaluate(async () => {
      const app = window.__ncld.app;
      const ext = app.world.exteriors.find((e) => !e.fromRoof);
      const before = ext.dome.material.color.getHex();
      app.lighting.apply('blackout_emergency', 0.2);
      await new Promise((res) => setTimeout(res, 2000));
      return { dome: ext.dome.visible, plate: ext.plate ? ext.plate.visible : false, before, after: ext.dome.material.color.getHex() };
    });
    expect(r.dome).toBe(true);
    expect(r.plate).toBe(false);
    expect(r.after).not.toBe(r.before);
  });
```

- [ ] **Step 7: Run everything**

Run: `node --test test/unit/shaderpatch.test.mjs test/unit/skyline.test.mjs && npm test && npm run lint && npm run test:e2e`
Expected: 5 new tests PASS, and everything is green.

- [ ] **Step 8: Look at it.** Serve the game, start a run, and switch the camera to `director` looking out through the glass.
  - The city panorama should sit behind the towers, the horizon slightly below eye level, and no seam should face the balcony.
  - If the brightest part of the panorama sits behind the wall rather than out of the window, rotate the dome by adding `dome.rotation.y = <radians>` in `_showDome`, and note the value in the comment.
  - Run `__ncld.debug.light('blackout_emergency')`: the city darkens.
  - Reload with `?noassets=1`: the flat skyline plate is back.

- [ ] **Step 9: Commit**

```bash
git add src/scene3d/materials/cityWindows.js src/scene3d/tower/zoneBuilder.js src/core/app.js test/unit/shaderpatch.test.mjs test/unit/skyline.test.mjs test/smoke/smoke.spec.mjs
git commit -F - <<'EOF'
feat(scene): HDRI sky dome behind the towers; emissive windows offset per tower

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 20: Rain streaks and rain on the glass

**Files:**
- Create: `src/scene3d/rain.js`, `src/scene3d/materials/rainGlass.js`
- Modify: `src/scene3d/tower/zoneBuilder.js`, `test/unit/envmath.test.mjs`, `test/unit/shaderpatch.test.mjs`

**Interfaces:**
- Consumes: `rainLayout`, `rainCount`, `RAIN_MAX` (Task 17)
- Produces:
  - `RainStreaks` with `new RainStreaks(vol, rng, { density })`, `.mesh`, `.setDensity(d)`, `.update(t)`
  - `applyRainOnGlass(material) → material`
  - `RAIN_GLASS_UNIFORMS = { uRainTime, uRain }` (shared)
  - `world.rains: RainStreaks[]`, `world.setRainDensity(d)`

- [ ] **Step 1: Write the failing tests**
  - Append to `test/unit/shaderpatch.test.mjs`:

```js
import { applyRainOnGlass, RAIN_GLASS_UNIFORMS } from '../../src/scene3d/materials/rainGlass.js';

test('the rain-on-glass patch lands in the r185 standard shaders and shares one set of uniforms', () => {
  const a = applyRainOnGlass(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.18 }));
  const b = applyRainOnGlass(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.18 }));
  const sa = shaderOf('standard');
  const sb = shaderOf('standard');
  a.onBeforeCompile(/** @type {any} */ (sa), /** @type {any} */ (null));
  b.onBeforeCompile(/** @type {any} */ (sb), /** @type {any} */ (null));
  assert.match(sa.vertexShader, /vRainP = \( modelMatrix \* vec4\( transformed, 1\.0 \) \)\.xyz;/);
  assert.match(sa.fragmentShader, /vec3 rainDrops\(/);
  assert.match(sa.fragmentShader, /float rainCover/);
  assert.match(sa.fragmentShader, /normal = normalize\( normal \+/);
  assert.equal(sa.uniforms.uRain, RAIN_GLASS_UNIFORMS.uRain);
  assert.equal(sb.uniforms.uRainTime, sa.uniforms.uRainTime, 'one uniform object drives every pane');
  assert.equal(a.customProgramCacheKey(), 'rain-on-glass');
});
```

  - Append to `test/unit/envmath.test.mjs`:

```js
test('RainStreaks: one instanced draw, count from density, bounded by its volume', async () => {
  const { RainStreaks } = await import('../../src/scene3d/rain.js');
  const vol = { x: /** @type {[number,number]} */ ([-12, 12]), y: /** @type {[number,number]} */ ([0, 14]), z: /** @type {[number,number]} */ ([-10, 10]) };
  const rain = new RainStreaks(vol, seq([0.1, 0.5, 0.9]), { density: 1 });
  assert.equal(rain.mesh.geometry.isInstancedBufferGeometry, true);
  assert.equal(rain.mesh.geometry.instanceCount, RAIN_BASE);
  assert.equal(rain.mesh.geometry.getAttribute('offset').count, RAIN_MAX);
  rain.setDensity(0.5);
  assert.equal(rain.mesh.geometry.instanceCount, RAIN_BASE / 2);
  rain.setDensity(0);
  assert.equal(rain.mesh.visible, false);
  const THREE = await import('three');
  // the shader wraps every drop inside the volume, so a far corner must be inside the bound
  assert.ok(rain.mesh.geometry.boundingSphere.containsPoint(new THREE.Vector3(12, 14, 10)));
  assert.ok(rain.mesh.geometry.boundingSphere.containsPoint(new THREE.Vector3(-12, 0, -10)));
});

test('the tower builder no longer uses Math.random (rain was the last one)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../src/scene3d/tower/zoneBuilder.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Math\.random/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/unit/shaderpatch.test.mjs test/unit/envmath.test.mjs`
Expected: FAIL, with `Cannot find module …/rainGlass.js` and `…/rain.js`.

- [ ] **Step 3: Create** `src/scene3d/rain.js`

```js
// @ts-check
// Rain as instanced, velocity-aligned streaks. Replaces 500 THREE.Points that
// the CPU moved every frame (a JS loop over every drop, then a full attribute
// re-upload) and that rendered as square dots at any distance. Now: one
// instanced draw, positions wrapped inside the volume by the vertex shader from
// a single time uniform — zero per-frame CPU work — and each drop is a thin
// quad stretched along its fall direction and turned to face the camera, so
// rain reads as rain.
import * as THREE from 'three';
import { rainLayout, rainCount, RAIN_MAX } from './envMath.js';

const VERT = /* glsl */ `
  attribute vec3 offset;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uLength;
  uniform float uWidth;
  uniform vec3 uWind;
  uniform vec3 uVolMin;
  uniform vec3 uVolSize;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    // fall and drift, wrapped inside the volume
    vec3 p = uVolMin + mod(offset - uVolMin + vec3(uWind.x, -uSpeed, uWind.z) * uTime, uVolSize);
    vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
    vec3 vel = normalize(vec3(uWind.x, -uSpeed, uWind.z));
    vec3 toCam = normalize(cameraPosition - wp);
    // long along the velocity, thin across it, facing the camera
    vec3 side = normalize(cross(vel, toCam));
    wp += side * position.x * uWidth + vel * position.y * uLength;
    vUv = uv;
    float d = distance(cameraPosition, wp);
    // a streak inside arm's reach is a smear across the lens, not rain; far ones thin into the fog
    vFade = smoothstep(0.6, 2.5, d) * (1.0 - smoothstep(25.0, 45.0, d));
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;   // soft edges
    float along = smoothstep(0.0, 0.35, vUv.y);    // tapered tail
    gl_FragColor = vec4(uColor, uOpacity * across * along * vFade);
  }`;

/** Time wraps hourly: fp32 keeps millimetre precision well past that, and a once-an-hour jump is invisible in a storm. */
const TIME_WRAP = 3600;

export class RainStreaks {
  /**
   * @param {{x:[number,number], y:[number,number], z:[number,number]}} vol floor-local volume
   * @param {{next: () => number}} rng
   * @param {{density?: number}} [o]
   */
  constructor(vol, rng, { density = 1 } = {}) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(quad.getIndex());
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(rainLayout(RAIN_MAX, vol, rng), 3));
    const min = new THREE.Vector3(vol.x[0], vol.y[0], vol.z[0]);
    const size = new THREE.Vector3(vol.x[1] - vol.x[0], vol.y[1] - vol.y[0], vol.z[1] - vol.z[0]);
    // the shader wraps every drop inside the volume, so the volume IS the bound
    geo.boundingBox = new THREE.Box3(min.clone(), min.clone().add(size));
    geo.boundingSphere = new THREE.Sphere(min.clone().addScaledVector(size, 0.5), size.length() / 2 + 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: 9 },            // m/s — heavy rain
        uLength: { value: 0.55 },
        uWidth: { value: 0.012 },
        uWind: { value: new THREE.Vector3(0.6, 0, 0.25) },
        uVolMin: { value: min },
        uVolSize: { value: size },
        uColor: { value: new THREE.Color(0x8ab8d0) },
        uOpacity: { value: 0.35 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'rain';
    this.setDensity(density);
  }

  /** @param {number} density the quality preset's rain density (0 = dry) */
  setDensity(density) {
    const n = rainCount(density);
    /** @type {THREE.InstancedBufferGeometry} */ (this.mesh.geometry).instanceCount = n;
    this.mesh.visible = n > 0;
  }

  /** @param {number} t seconds */
  update(t) {
    this.material.uniforms.uTime.value = t % TIME_WRAP;
  }
}
```

- [ ] **Step 4: Create** `src/scene3d/materials/rainGlass.js`

```js
// @ts-check
// Rain on the curtain wall. An onBeforeCompile patch for the glass panes'
// MeshStandardMaterial: a procedural droplet sheet (two layers, some drops
// hanging, some sliding) in the pane's own plane, which
//   - bends the normal the reflections are looked up with — each droplet is a
//     little lens throwing the HDRI city and the room's neon back at a different
//     angle (the "refraction offset": a forward renderer has no screen texture to
//     refract without a transmission pass, and this reads the same at glass scale)
//   - raises the pane's opacity under each drop, so droplets catch light
//     instead of vanishing into the 18% glass.
// All panes share ONE pair of uniforms, so the world updates rain with two writes.
import * as THREE from 'three';

export const RAIN_GLASS_UNIFORMS = {
  uRainTime: { value: 0 },
  /** 0 = dry glass, 1 = raining (World3D.setRainDensity) */
  uRain: { value: 1 },
};

const VERT_PARS = /* glsl */ 'varying vec3 vRainP;';
const VERT_MAIN = /* glsl */ 'vRainP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;';

const FRAG_PARS = /* glsl */ `
uniform float uRainTime;
uniform float uRain;
varying vec3 vRainP;
float rainHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
// One droplet layer on a CELL-metre grid. xy = the drop's slope (its lens
// normal), z = coverage 0..1. Each cell picks its own speed, so the sheet never
// slides as one block.
vec3 rainDrops( vec2 p, float cell, float t ) {
  vec2 g = p / cell;
  vec2 id = floor( g );
  float h = rainHash( id );
  float slide = step( 0.6, h ) * fract( t * ( 0.15 + h * 0.35 ) + h );
  vec2 c = vec2( 0.25 + 0.5 * rainHash( id + 7.1 ), 0.8 - slide * 0.6 );
  vec2 d = ( fract( g ) - c ) / ( 0.12 + 0.18 * rainHash( id + 3.7 ) );
  float m = 1.0 - dot( d, d );
  return m > 0.0 ? vec3( d * m, m ) : vec3( 0.0 );
}`;

const FRAG_COLOR = /* glsl */ `
// the pane is vertical and runs along X or Z, so x+z is "along the pane"
vec2 rainPlane = vec2( vRainP.x + vRainP.z, vRainP.y );
vec3 rainD = rainDrops( rainPlane, 0.07, uRainTime ) + 0.6 * rainDrops( rainPlane + 13.0, 0.035, uRainTime * 1.3 );
float rainCover = clamp( rainD.z, 0.0, 1.0 ) * uRain;
diffuseColor.a = mix( diffuseColor.a, min( 1.0, diffuseColor.a + 0.35 ), rainCover );`;

const FRAG_NORMAL = /* glsl */ `
{
  vec3 rainWN = inverseTransformDirection( normal, viewMatrix );
  vec3 rainH = normalize( cross( vec3( 0.0, 1.0, 0.0 ), rainWN ) + vec3( 1e-5 ) );
  vec3 rainBend = rainH * rainD.x + vec3( 0.0, 1.0, 0.0 ) * rainD.y;
  normal = normalize( normal + ( viewMatrix * vec4( rainBend, 0.0 ) ).xyz * 0.9 * uRain );
}`;

/**
 * @template {THREE.MeshStandardMaterial} M
 * @param {M} material a (transparent) glass material
 * @returns {M}
 */
export function applyRainOnGlass(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRainTime = RAIN_GLASS_UNIFORMS.uRainTime;
    shader.uniforms.uRain = RAIN_GLASS_UNIFORMS.uRain;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`);
  };
  material.customProgramCacheKey = () => 'rain-on-glass';
  return material;
}
```

- [ ] **Step 5: `src/scene3d/tower/zoneBuilder.js`**
  - Add these imports:

```js
import { RainStreaks } from '../rain.js';
import { applyRainOnGlass, RAIN_GLASS_UNIFORMS } from '../materials/rainGlass.js';
```

  - Replace `const glassMat = () => new THREE.MeshStandardMaterial({ … });` with:

```js
const glassMat = () => applyRainOnGlass(new THREE.MeshStandardMaterial({
  color: PALETTE.glass, transparent: true, opacity: 0.18,
  roughness: 0.08, metalness: 0.2, side: THREE.DoubleSide,
}));
```

  - Add `/** @type {RainStreaks[]} */ this.rains = [];` to the constructor fields.
  - Replace the whole `_buildRain(group, vol) { … }` method with:

```js
  _buildRain(group, vol) {
    const rain = new RainStreaks(vol, this.rng);
    group.add(rain.mesh);
    // cached per floor: update() used to getObjectByName() the whole floor every frame to find it
    group.userData.rain = rain;
    this.rains.push(rain);
  }

  /**
   * The quality preset's rain density. 0 means dry: no streaks, and no
   * droplets on the glass.
   * @param {number} density
   */
  setRainDensity(density) {
    for (const r of this.rains) r.setDensity(density);
    RAIN_GLASS_UNIFORMS.uRain.value = density > 0 ? 1 : 0;
  }
```

  - In `update(t)`, replace the whole `// rain fall` block (from `const rain = group.userData.rain;` to its closing `}`) with:

```js
    // Rain animates on the GPU from one uniform per volume; the droplets on the
    // glass share another. No per-drop CPU work.
    const rain = group.userData.rain;
    if (rain) rain.update(t);
    RAIN_GLASS_UNIFORMS.uRainTime.value = t % 3600;
```

- [ ] **Step 6: Run everything**

Run: `node --test test/unit/shaderpatch.test.mjs test/unit/envmath.test.mjs && npm test && npm run lint && npm run test:e2e`
Expected: all green, and there are no shader compile errors in the e2e console (they would show up as console errors).

- [ ] **Step 7: Look at it.** In the penthouse, face the curtain wall from about 2 m away.
  - Streaks should fall outside, thin and velocity-stretched.
  - Droplets should sit on the panes, some sliding, catching the city in reflections.
  - Run `__ncld.app.world.setRainDensity(0)`: the streaks go and the glass is dry.
  - Run `__ncld.app.world.setRainDensity(1)` to restore it.

- [ ] **Step 8: Commit**

```bash
git add src/scene3d/rain.js src/scene3d/materials/rainGlass.js src/scene3d/tower/zoneBuilder.js test/unit/shaderpatch.test.mjs test/unit/envmath.test.mjs
git commit -F - <<'EOF'
feat(scene): instanced velocity-aligned rain streaks + rain on the curtain-wall glass

Rain was 500 Points moved by a CPU loop and re-uploaded every frame; it
is now one instanced draw animated entirely in the vertex shader. The
glass panes get a procedural droplet sheet that bends the reflection
normal and raises opacity under each drop.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 21: beta.1 release bookkeeping

**Files:**
- Modify: `package.json`, `CHANGELOG.md`, `README.md`, `AGENTS.md`, `docs/systems/scene-audio-ui.md`, `docs/config/lighting.md`, `docs/config/README.md`, `docs/screenshots/*.jpg`

- [ ] **Step 1: Version.** Set `"version"` to `"0.7.0-beta.1"`.

- [ ] **Step 2: CHANGELOG.** Add above alpha.2:

```markdown
## [0.7.0-beta.1] — YYYY-MM-DD — The city outside

The world beyond the glass. Real image-based lighting, a real skyline, and
rain that reads as rain — each with the procedural version as its fallback.

### Added
- **HDRI image-based lighting.** Poly Haven's `shanghai_bund` night city
  (2K) replaces the gradient sky inside the PMREM capture; the neon sign cards
  and the warm floor bounce are still composited in as local accents. Every
  lighting preset now carries an `ibl` block — reflection strength, a rotation,
  and a sky tint × exposure (a blackout darkens the city).
- **Environment crossfade.** A preset change dips `environmentIntensity` to 0,
  swaps the prefiltered map at the bottom, and brings it back over 0.6 s, instead
  of hard-cutting every reflection in the room in one frame.
- **Skyline dome.** The flat skyline billboard is replaced by the HDRI rendered
  on a sphere behind the instanced towers, graded by the same preset. The
  billboard remains the fallback.
- **Emissive city windows** with a per-tower offset into the window texture, so
  the towers no longer repeat each other's windows.
- **Rain streaks** — one instanced, velocity-aligned, camera-facing draw
  animated in the vertex shader (it was 500 points moved by a CPU loop every
  frame) — and **rain on the glass**: a droplet sheet on the curtain-wall panes
  that bends reflections and catches the light.
- `render.hdri.id` in `config/render.yaml`.
```

- [ ] **Step 3: Screenshots.** Run `node tools/screenshots.mjs`. The exterior and lounge shots should now show the HDRI city and the rain.

- [ ] **Step 4: Docs.**
  - README Features, in the Procedural 3D bullet: change `a procedural city backdrop, rain,` to `an HDRI night-city skyline and image-based lighting graded per lighting preset, instanced rain with droplets on the glass,`. Update the test counts.
  - AGENTS.md: version `**0.7.0-beta.1**`, roadmap `(at beta.1)`.
  - `docs/config/lighting.md`: document the `ibl` block (four keys, units, what each drives, the blackout example).
  - `docs/config/README.md`: mention `render.hdri.id` in the render group line.
  - `docs/systems/scene-audio-ui.md`: add a `### Environment & exterior` subsection covering:
    - `EnvBuilder` (HDRI vs procedural sky, sign cards, `setHDRI`);
    - `Lighting` (`ibl`, the dip-and-swap, `setHDRI`, `skyColor`/`onSkyGrade`);
    - the dome (`_showDome`, `setSkyTexture`, `setSkyGrade`, radius 180, unfogged, no depth write);
    - the towers (`cityTowerMaterial`, `aWinOffset`);
    - rain (`RainStreaks`, `setRainDensity`, `RAIN_GLASS_UNIFORMS`).

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run lint && npm run test:e2e`

```bash
git add package.json CHANGELOG.md README.md AGENTS.md docs/systems/scene-audio-ui.md docs/config/lighting.md docs/config/README.md docs/screenshots
git commit -F - <<'EOF'
docs: v0.7.0-beta.1 — HDRI lighting, skyline dome, rain

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---
# Stage beta.2: post stack, quality presets, adaptive resolution, settings

### Task 22: Quality presets, render config and `replaceConfig`

**Files:**
- Create: `src/scene3d/quality.js`, `test/unit/quality.test.mjs`, `test/unit/render-config.test.mjs`
- Modify: `data/configDefaults.js`, `data/configSchema.js`, `config/render.yaml`, `src/core/config.js`

**Interfaces:**
- Produces:
  - `QUALITY_LEVELS`, `DEFAULT_QUALITY = 'high'`, `QUALITY_PRESETS` (deep-frozen)
  - `resolveQuality(preset, overrides = {}) → QualitySettings`
  - `renderSettings(renderCfg = {}) → QualitySettings`, which reads `quality`, `overrides` and the pre-0.7 keys
  - `replaceConfig(group, obj) → string[]`
  - `saveConfigFile(group, obj, { replace? })`
  - Config keys `render.quality`, `render.overrides.*`, `render.targetFrameMs`, `render.ao.blurRadius`, `render.ao.blurDepth`, `render.aberration`, `render.lut.{id,intensity}`
  - `QualitySettings = { pixelRatioCap, renderScale, msaa: 0|2|4, smaa, ao: {enabled, samples}, bloom, lut, shadows: 'off'|'hard'|'soft', shadowMapSize, rain, anisotropy, hdri: 'off'|'1k'|'2k', adaptive }`

- [ ] **Step 1: Write the failing tests**
  - Create `test/unit/quality.test.mjs`:

```js
// @ts-check
// src/scene3d/quality.js — the four graphics presets and the override rules.
// One pure function decides what "medium" means, so the Settings panel, the
// live RenderQuality switch and the e2e suite can never disagree about it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUALITY_LEVELS, QUALITY_PRESETS, DEFAULT_QUALITY, resolveQuality, renderSettings } from '../../src/scene3d/quality.js';

const KEYS = ['adaptive', 'anisotropy', 'ao', 'bloom', 'hdri', 'lut', 'msaa', 'pixelRatioCap', 'rain', 'renderScale', 'shadowMapSize', 'shadows', 'smaa'];

test('every preset resolves to a full, well-typed settings object', () => {
  assert.deepEqual(QUALITY_LEVELS, ['low', 'medium', 'high', 'ultra']);
  for (const level of QUALITY_LEVELS) {
    const q = resolveQuality(level);
    assert.deepEqual(Object.keys(q).sort(), KEYS, level);
    assert.ok([0, 2, 4].includes(q.msaa), `${level}.msaa`);
    assert.ok(['off', 'hard', 'soft'].includes(q.shadows));
    assert.ok([512, 1024, 2048, 4096].includes(q.shadowMapSize));
    assert.ok(['off', '1k', '2k'].includes(q.hdri));
    assert.ok([1, 2, 4, 8, 16].includes(q.anisotropy));
    assert.ok(q.renderScale >= 0.5 && q.renderScale <= 1);
    assert.equal(typeof q.ao.enabled, 'boolean');
    assert.ok(q.ao.samples >= 4 && q.ao.samples <= 32);
  }
});

test('cost never goes down from low to ultra', () => {
  const qs = QUALITY_LEVELS.map((l) => resolveQuality(l));
  const rank = { off: 0, hard: 1, soft: 2, '1k': 1, '2k': 2 };
  for (let i = 1; i < qs.length; i++) {
    const [a, b] = [qs[i - 1], qs[i]];
    for (const k of ['msaa', 'shadowMapSize', 'anisotropy', 'rain', 'pixelRatioCap', 'renderScale']) assert.ok(b[k] >= a[k], `${QUALITY_LEVELS[i]}.${k}`);
    assert.ok(b.ao.samples >= a.ao.samples);
    assert.ok(rank[b.shadows] >= rank[a.shadows]);
    assert.ok(rank[b.hdri] >= rank[a.hdri]);
  }
});

test('high — the default — is the pre-0.7 stack', () => {
  assert.equal(DEFAULT_QUALITY, 'high');
  const q = resolveQuality('high');
  assert.equal(q.pixelRatioCap, 2);
  assert.equal(q.renderScale, 1);
  assert.equal(q.msaa, 4);
  assert.equal(q.ao.samples, 12);
  assert.equal(q.shadows, 'soft');
  assert.equal(q.shadowMapSize, 2048);
});

test('overrides win key by key; ao merges instead of replacing', () => {
  const q = resolveQuality('low', { shadows: 'soft', ao: { enabled: true } });
  assert.equal(q.shadows, 'soft');
  assert.equal(q.ao.enabled, true);
  assert.equal(q.ao.samples, QUALITY_PRESETS.low.ao.samples, 'the untouched ao key survives');
  assert.equal(q.msaa, QUALITY_PRESETS.low.msaa, 'everything else is the preset');
});

test('unknown, null and undefined overrides are ignored; an unknown preset is high', () => {
  const q = resolveQuality('medium', { shadows: null, msaa: undefined, turbo: true });
  assert.equal(q.shadows, QUALITY_PRESETS.medium.shadows);
  assert.equal(q.msaa, QUALITY_PRESETS.medium.msaa);
  assert.ok(!('turbo' in q));
  assert.deepEqual(resolveQuality('potato'), resolveQuality('high'));
});

test('resolving never mutates the presets, which are frozen', () => {
  const q = resolveQuality('ultra', { ao: { samples: 4 } });
  q.ao.samples = 99;
  assert.equal(QUALITY_PRESETS.ultra.ao.samples, 16);
  assert.ok(Object.isFrozen(QUALITY_PRESETS.ultra.ao));
});

test('renderSettings: quality + overrides, and pre-0.7 keys honoured as overrides', () => {
  assert.equal(renderSettings({}).shadows, 'soft');
  assert.equal(renderSettings({ quality: 'low' }).shadows, 'off');
  const legacy = renderSettings({ quality: 'high', shadows: 'hard', shadowMapSize: 1024, ao: { enabled: false, samples: 6, radius: 0.5 } });
  assert.equal(legacy.shadows, 'hard');
  assert.equal(legacy.shadowMapSize, 1024);
  assert.deepEqual(legacy.ao, { enabled: false, samples: 6 });
  assert.equal(renderSettings({ quality: 'high', shadows: 'hard', overrides: { shadows: 'off' } }).shadows, 'off', 'explicit overrides beat legacy keys');
});
```

  - Create `test/unit/render-config.test.mjs`:

```js
// @ts-check
// The render config group after v0.7: a preset + overrides. Two contracts:
// every preset key can be overridden (and every preset value is legal where
// Settings writes it), and replaceConfig can REMOVE keys — which applyConfig's
// merge cannot, and which picking a preset (clearing overrides) depends on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_DEFAULTS } from '../../data/configDefaults.js';
import { CONFIG_SCHEMA, validateConfig } from '../../data/configSchema.js';
import { QUALITY_PRESETS } from '../../src/scene3d/quality.js';
import { cfg, applyConfig, replaceConfig, _setConfigStore } from '../../src/core/config.js';

test('every preset key is overridable, and every preset value is a legal override', () => {
  assert.deepEqual(Object.keys(CONFIG_SCHEMA.render.overrides).sort(), Object.keys(QUALITY_PRESETS.high).sort());
  for (const [level, q] of Object.entries(QUALITY_PRESETS)) {
    assert.deepEqual(validateConfig('render', { quality: level, overrides: structuredClone(q) }), [], level);
  }
});

test('the render defaults are the high preset with no overrides', () => {
  assert.equal(CONFIG_DEFAULTS.render.quality, 'high');
  assert.deepEqual(CONFIG_DEFAULTS.render.overrides, {});
  assert.deepEqual(validateConfig('render', CONFIG_DEFAULTS.render), []);
});

test('replaceConfig swaps the whole group — keys the new object omits are gone', () => {
  _setConfigStore(structuredClone(CONFIG_DEFAULTS));
  applyConfig('render', { overrides: { shadows: 'off' } });
  applyConfig('render', { overrides: {} });
  assert.equal(cfg('render.overrides.shadows'), 'off', 'a merge cannot clear a key — the reason replaceConfig exists');
  assert.deepEqual(replaceConfig('render', { quality: 'low', overrides: {} }), []);
  assert.equal(cfg('render.overrides.shadows'), undefined);
  assert.equal(cfg('render.quality'), 'low');
  assert.equal(cfg('render.bloom.strength'), CONFIG_DEFAULTS.render.bloom.strength, 'omitted keys fall back to the defaults');
  assert.ok(replaceConfig('render', { quality: 'potato' }).length > 0, 'invalid input is rejected');
  assert.equal(cfg('render.quality'), 'low', 'and leaves the store untouched');
  _setConfigStore(structuredClone(CONFIG_DEFAULTS));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/unit/quality.test.mjs test/unit/render-config.test.mjs`
Expected: FAIL, `Cannot find module …/quality.js`

- [ ] **Step 3: Implement** `src/scene3d/quality.js`

```js
// @ts-check
// Graphics quality presets. PURE — no three.js, no DOM — so every preset and
// the override rules are unit-tested, and the Settings panel, RenderQuality and
// the e2e suite agree on what "medium" means.
//
// A preset is a FULL settings object. `render.overrides` (the Settings panel's
// individual rows) replaces single keys on top of it. resolveQuality() is the
// only place the two meet.

/** @typedef {'low'|'medium'|'high'|'ultra'} QualityLevel */
/**
 * @typedef {object} QualitySettings
 * @property {number} pixelRatioCap  devicePixelRatio is clamped to this
 * @property {number} renderScale  fraction of that resolution actually drawn (adaptive moves it)
 * @property {0|2|4} msaa  samples on the HDR target (baked at creation: applies on reload)
 * @property {boolean} smaa  post-process AA after the grade
 * @property {{enabled:boolean, samples:number}} ao
 * @property {boolean} bloom
 * @property {boolean} lut  the neon-noir colour grade
 * @property {'off'|'hard'|'soft'} shadows
 * @property {512|1024|2048|4096} shadowMapSize
 * @property {number} rain  rain density (0 = dry)
 * @property {1|2|4|8|16} anisotropy
 * @property {'off'|'1k'|'2k'} hdri  HDRI resolution for IBL + the sky dome ('off' = procedural sky)
 * @property {boolean} adaptive  hold the frame-time target by moving renderScale
 */

export const QUALITY_LEVELS = /** @type {QualityLevel[]} */ (['low', 'medium', 'high', 'ultra']);
export const DEFAULT_QUALITY = 'high';

/** @type {Readonly<Record<QualityLevel, Readonly<QualitySettings>>>} */
export const QUALITY_PRESETS = deepFreeze({
  // integrated GPUs and old laptops: no shadows, no AO, procedural sky, 80% resolution
  low: { pixelRatioCap: 1, renderScale: 0.8, msaa: 0, smaa: false, ao: { enabled: false, samples: 8 }, bloom: true, lut: false, shadows: 'off', shadowMapSize: 1024, rain: 0.35, anisotropy: 2, hdri: 'off', adaptive: true },
  // the mid-range target: 1K HDRI, hard shadows, 2x MSAA + SMAA, adaptive resolution as the safety net
  medium: { pixelRatioCap: 1.25, renderScale: 1, msaa: 2, smaa: true, ao: { enabled: true, samples: 8 }, bloom: true, lut: true, shadows: 'hard', shadowMapSize: 1024, rain: 0.6, anisotropy: 4, hdri: '1k', adaptive: true },
  // the default: exactly the pre-0.7 stack (DPR ≤ 2, MSAA 4, AO 12, soft 2048) plus SMAA, the grade and the 2K HDRI
  high: { pixelRatioCap: 2, renderScale: 1, msaa: 4, smaa: true, ao: { enabled: true, samples: 12 }, bloom: true, lut: true, shadows: 'soft', shadowMapSize: 2048, rain: 1, anisotropy: 8, hdri: '2k', adaptive: false },
  ultra: { pixelRatioCap: 2, renderScale: 1, msaa: 4, smaa: true, ao: { enabled: true, samples: 16 }, bloom: true, lut: true, shadows: 'soft', shadowMapSize: 4096, rain: 1.4, anisotropy: 16, hdri: '2k', adaptive: false },
});

/**
 * @param {string} preset a QualityLevel (anything else resolves as DEFAULT_QUALITY)
 * @param {Partial<Record<keyof QualitySettings, any>>} [overrides] keys that win over the preset;
 *   null/undefined values and unknown keys are ignored; `ao` merges key by key
 * @returns {QualitySettings} a fresh, mutable object
 */
export function resolveQuality(preset, overrides = {}) {
  const base = QUALITY_PRESETS[/** @type {QualityLevel} */ (preset)] ?? QUALITY_PRESETS[DEFAULT_QUALITY];
  const out = { ...base, ao: { ...base.ao } };
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (v === undefined || v === null || !(k in out)) continue;
    if (k === 'ao') {
      if (typeof v !== 'object') continue;
      for (const [ak, av] of Object.entries(v)) if (av !== undefined && av !== null && ak in out.ao) out.ao[ak] = av;
      continue;
    }
    out[k] = v;
  }
  return /** @type {QualitySettings} */ (out);
}

/**
 * The settings in effect for a `render` config group. Pre-0.7 configs set
 * `shadows`, `shadowMapSize`, `ao.enabled` and `ao.samples` at the top level;
 * those still count, as overrides — below an explicit `overrides` entry.
 * @param {any} [render] cfg('render')
 */
export function renderSettings(render = {}) {
  /** @type {Record<string, any>} */
  const legacy = {};
  if (render.shadows !== undefined) legacy.shadows = render.shadows;
  if (render.shadowMapSize !== undefined) legacy.shadowMapSize = render.shadowMapSize;
  /** @type {Record<string, any>} */
  const legacyAo = {};
  if (render.ao?.enabled !== undefined) legacyAo.enabled = render.ao.enabled;
  if (render.ao?.samples !== undefined) legacyAo.samples = render.ao.samples;
  const ov = render.overrides ?? {};
  return resolveQuality(render.quality ?? DEFAULT_QUALITY, { ...legacy, ...ov, ao: { ...legacyAo, ...(ov.ao ?? {}) } });
}

/** @template T @param {T} o @returns {T} */
function deepFreeze(o) {
  for (const v of Object.values(/** @type {any} */ (o))) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}
```

- [ ] **Step 4: `src/core/config.js`**
  - Add after `applyConfig`:

```js
/**
 * Replace a whole group: validate, merge over a FRESH copy of the defaults
 * (exactly what loadConfig does with a file), and notify. applyConfig merges
 * over the live store, so it can never REMOVE a key — and picking a graphics
 * preset has to clear the overrides beneath it.
 * @param {string} group @param {any} obj @returns {string[]} validation errors (store untouched if any)
 */
export function replaceConfig(group, obj) {
  const errs = validateConfig(group, obj);
  if (errs.length) return errs;
  _store[group] = merge(structuredClone(CONFIG_DEFAULTS[group] ?? {}), obj);
  emit('config.changed', { group });
  return [];
}
```

  - Change `saveConfigFile`: its JSDoc gains `@param {{replace?: boolean}} [opts] replace: swap the group wholesale (replaceConfig) instead of merging`. Its signature becomes `export async function saveConfigFile(group, obj, { replace = false } = {}) {`, and its last line before the return, `applyConfig(group, obj);`, becomes:

```js
  if (replace) replaceConfig(group, obj);
  else applyConfig(group, obj);
```

- [ ] **Step 5: Defaults, schema, YAML**
  - `data/configDefaults.js`: replace the whole `render: { … },` block with:

```js
  render: {
    // Graphics quality preset (src/scene3d/quality.js): resolution cap + scale,
    // MSAA/SMAA, AO, bloom, the LUT grade, shadows, rain, anisotropy, HDRI
    // resolution, adaptive resolution. `overrides` holds single keys that win
    // over the preset (the Settings panel's individual rows write these).
    quality: 'high',             // 'low' | 'medium' | 'high' | 'ultra'
    overrides: {},
    targetFrameMs: 16.7,         // adaptive resolution holds this (60 fps)
    ao: {
      radius: 0.45,              // world-space sample radius in metres
      intensity: 0.9,            // 0 = no darkening, 1 = full occlusion in creases
      bias: 0.025,               // depth slack, in metres; too low = self-occlusion acne
      blurRadius: 4,             // bilateral blur taps each side (src/scene3d/aoBlur.js)
      blurDepth: 12,             // edge sharpness: higher keeps AO from bleeding across silhouettes
    },
    bloom: {
      strength: 0.42,
      radius: 0.40,
      threshold: 1.55,           // LINEAR HDR, pre-tonemap. Above lit skin/hair, below the neon core.
    },
    grain: { amount: 0.055, vignette: 0.42 },
    aberration: 0.0022,          // chromatic aberration at the frame corners (final pass)
    lut: { id: 'neon_noir', intensity: 0.85 },   // assets/manifest.json lut entry; 0 = ungraded
    hdri: { id: 'shanghai_bund' },   // assets/manifest.json hdri entries are `${id}_${1k|2k}`
    fov: 55,                     // vertical field of view, degrees
  },
```

  - `data/configSchema.js`: replace the whole `render: { … },` block with:

```js
  render: {
    quality: { type: 'string', enum: ['low', 'medium', 'high', 'ultra'] },
    overrides: {
      pixelRatioCap: num(0.5, 3), renderScale: num(0.5, 1),
      msaa: { type: 'number', enum: [0, 2, 4] }, smaa: { type: 'boolean' },
      ao: { enabled: { type: 'boolean' }, samples: num(4, 32) },
      bloom: { type: 'boolean' }, lut: { type: 'boolean' },
      shadows: { type: 'string', enum: ['off', 'hard', 'soft'] },
      shadowMapSize: { type: 'number', enum: [512, 1024, 2048, 4096] },
      rain: num(0, 2), anisotropy: { type: 'number', enum: [1, 2, 4, 8, 16] },
      hdri: { type: 'string', enum: ['off', '1k', '2k'] }, adaptive: { type: 'boolean' },
    },
    targetFrameMs: num(4, 100),
    // pre-0.7 top-level keys, still read as overrides (src/scene3d/quality.js renderSettings)
    shadows: { type: 'string', enum: ['off', 'hard', 'soft'] },
    shadowMapSize: { type: 'number', enum: [512, 1024, 2048, 4096] },
    ao: {
      enabled: { type: 'boolean' }, radius: num(0.05, 3), intensity: num(0, 2),
      bias: num(0.001, 0.5), samples: num(4, 32), blurRadius: num(0, 8), blurDepth: num(0, 100),
    },
    bloom: { strength: num(0, 3), radius: num(0, 2), threshold: num(0, 8) },
    grain: { amount: num(0, 0.4), vignette: num(0, 1.5) },
    aberration: num(0, 0.02),
    lut: { id: { type: 'string' }, intensity: num(0, 1) },
    hdri: { id: { type: 'string' } },
    fov: num(30, 110),
  },
```

  - `config/render.yaml`: replace the file with:

```yaml
# Render config — the graphics quality preset, its overrides, and the look.
# Loaded over data/configDefaults.js. The in-game Settings screen writes this
# whole file (src/ui/settingsPanel.js), so editing here changes the defaults a
# new player starts from. Reference: docs/config/render.md.

# low | medium | high | ultra — a full set of resolution/AA/AO/shadow/rain/
# HDRI settings (src/scene3d/quality.js). Applies live from Settings.
quality: high

# Single keys that win over the preset. Settings' individual rows write these;
# picking a preset clears them. Keys: pixelRatioCap, renderScale, msaa (0|2|4,
# applies on reload), smaa, ao {enabled, samples}, bloom, lut, shadows
# (off|hard|soft), shadowMapSize, rain, anisotropy, hdri (off|1k|2k), adaptive.
overrides: {}

# Adaptive resolution (when the preset or an override turns it on) steps the
# render scale between 0.6 and 1.0 to hold this frame time. 16.7 = 60 fps.
targetFrameMs: 16.7

# Screen-space ambient occlusion (src/scene3d/aoPass.js) + its depth-aware blur
# (src/scene3d/aoBlur.js). On/off and the sample count come from the preset.
# Measured cost at 1912x961: about 1.5ms a frame, +0.3ms for the blur.
ao:
  radius: 0.45      # world-space sample radius, metres
  intensity: 0.9    # 0 = no darkening, 1 = full occlusion in creases
  bias: 0.025       # depth slack, metres — too low and flat surfaces self-occlude
  blurRadius: 4     # blur taps each side; 0 = unblurred
  blurDepth: 12     # higher = sharper at depth edges (no AO halo across silhouettes)

bloom:
  strength: 0.42
  radius: 0.40
  # LINEAR HDR, applied BEFORE tone-mapping — so this is not a 0..1 brightness.
  # 1.55 sits above lit skin and hair and below the neon core (2.4), so only
  # things that are actually emissive glow.
  threshold: 1.55

grain:
  amount: 0.055     # film grain, applied after tone-mapping in display colour
  vignette: 0.42

# Chromatic aberration at the frame corners (zero at the centre).
aberration: 0.0022

# The colour grade (LUTPass, after tone-mapping). `id` is an assets/manifest.json
# lut entry; intensity 0 = ungraded, 1 = the full grade.
lut:
  id: neon_noir
  intensity: 0.85

# The HDRI behind image-based lighting and the exterior sky dome. The quality
# preset picks the resolution (assets/manifest.json has `${id}_1k` and `${id}_2k`).
hdri:
  id: shanghai_bund

# Vertical field of view, degrees. Applies on reload (the camera is built once).
fov: 55
```

- [ ] **Step 6: Run everything**

Run: `node --test test/unit/quality.test.mjs test/unit/render-config.test.mjs && npm test && npm run lint`
Expected: 10 new tests PASS. `config.test.mjs` stays green (defaults validate). `Config lint passed.`

Consumers still read `cfg('render.shadows', 'soft')`, `cfg('render.shadowMapSize', 2048)` and `render.ao.enabled`. With those keys gone from the defaults, the fallbacks give exactly the old behaviour until Task 25 switches them to `renderSettings()`.

- [ ] **Step 7: Commit**

```bash
git add src/scene3d/quality.js src/core/config.js data/configDefaults.js data/configSchema.js config/render.yaml test/unit/quality.test.mjs test/unit/render-config.test.mjs
git commit -F - <<'EOF'
feat(render): quality presets low/medium/high/ultra + overrides; replaceConfig

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 23: Adaptive resolution controller

**Files:**
- Create: `src/scene3d/adaptiveRes.js`, `test/unit/adaptive.test.mjs`
- Modify: `src/core/loop.js`, `test/unit/loop.test.mjs`

**Interfaces:**
- Produces:
  - `new AdaptiveResolution({ targetMs=16.7, min=0.6, max=1.0, step=0.1, sustainMs=2000, overRatio=1.15, underRatio=1.05, backoffMs=10000, maxBackoffMs=120000, scale=1 })`
  - `.tick(avgMs, dtMs) → number|null` (the new scale when it changes)
  - `.reset(scale?)`, `.scale`
  - `loop.frameStats() → { avgMs, count }`, `loop.resetFrameStats()`

- [ ] **Step 1: Write the failing tests**
  - Create `test/unit/adaptive.test.mjs`:

```js
// @ts-check
// src/scene3d/adaptiveRes.js — hold a frame-time target by moving the render
// scale in 0.1 steps within [0.6, 1.0]. The hard part is not stepping, it is
// NOT flapping: a vsync-capped frame time looks like headroom whether or not
// there is any, so every step up is a probe — and a probe that tips the frame
// over must make the next probe wait longer, or the scale oscillates forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveResolution } from '../../src/scene3d/adaptiveRes.js';

const DT = 16.7;
/** run for `ms` at a fixed average; collect the scale changes */
function run(ctl, avgMs, ms) {
  const changes = [];
  for (let t = 0; t < ms; t += DT) { const s = ctl.tick(avgMs, DT); if (s !== null) changes.push(s); }
  return changes;
}

test('steps down under SUSTAINED load, one 0.1 step per 2 s', () => {
  const ctl = new AdaptiveResolution({ scale: 1 });
  assert.deepEqual(run(ctl, 25, 1900), [], 'not before 2 s');
  assert.deepEqual(run(ctl, 25, 200), [0.9]);
  assert.deepEqual(run(ctl, 25, 2100), [0.8]);
});

test('a spike shorter than 2 s changes nothing', () => {
  const ctl = new AdaptiveResolution({ scale: 1 });
  assert.deepEqual(run(ctl, 30, 1500), []);
  assert.deepEqual(run(ctl, 14, 3000), []);
  assert.equal(ctl.scale, 1);
});

test('steps up with sustained headroom, never past the max', () => {
  const ctl = new AdaptiveResolution({ scale: 0.7 });
  assert.deepEqual(run(ctl, 10, 2100), [0.8]);
  const ctl2 = new AdaptiveResolution({ scale: 1 });
  assert.deepEqual(run(ctl2, 5, 20000), [], 'already at 1.0');
});

test('never below the floor', () => {
  const ctl = new AdaptiveResolution({ scale: 0.7 });
  assert.deepEqual(run(ctl, 60, 20000), [0.6]);
  assert.equal(ctl.scale, 0.6);
});

test('the dead band between target×1.05 and target×1.15 holds still', () => {
  const ctl = new AdaptiveResolution({ scale: 0.8 });
  assert.deepEqual(run(ctl, 18.5, 60000), []);
});

test('does not flap: a failed probe backs off exponentially', () => {
  // frame cost ∝ pixels ∝ scale²: 0.8 fits the budget, 0.9 does not
  const cost = (s) => 24 * s * s;
  const ctl = new AdaptiveResolution({ scale: 0.8 });
  const ups = [];
  let changes = 0;
  let at08 = 0;
  const TOTAL = 120000;
  for (let t = 0; t < TOTAL; t += DT) {
    const s = ctl.tick(cost(ctl.scale), DT);
    if (s !== null) { changes++; if (s > 0.85) ups.push(t); }
    if (Math.abs(ctl.scale - 0.8) < 1e-9) at08 += DT;
  }
  assert.ok(changes <= 6, `${changes} scale changes in 2 minutes is flapping`);
  assert.ok(at08 / TOTAL > 0.9, 'it settles at the scale that fits');
  for (let i = 2; i < ups.length; i++) {
    assert.ok(ups[i] - ups[i - 1] > ups[i - 1] - ups[i - 2], 'each probe waits longer than the last');
  }
});

test('reset() adopts a new scale and forgets its timers', () => {
  const ctl = new AdaptiveResolution({ scale: 1 });
  run(ctl, 25, 1900);
  ctl.reset(0.8);
  assert.equal(ctl.scale, 0.8);
  assert.deepEqual(run(ctl, 25, 1900), [], 'the 1.9 s of overload before reset does not count');
});
```

  - Append to `test/unit/loop.test.mjs`:

```js
test('frameStats averages the rolling frame-time window; resetFrameStats empties it', () => {
  const h = harness();
  h.loop.start();
  for (let i = 0; i < 10; i++) h.frame(20);
  assert.deepEqual(h.loop.frameStats(), { avgMs: 20, count: 10 });
  h.loop.resetFrameStats();
  assert.deepEqual(h.loop.frameStats(), { avgMs: 0, count: 0 });
  h.frame(10);
  assert.deepEqual(h.loop.frameStats(), { avgMs: 10, count: 1 });
  assert.equal(h.loop.fps(), 100, 'fps() reads the same window');
  h.loop.stop();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/unit/adaptive.test.mjs test/unit/loop.test.mjs`
Expected: FAIL. `adaptiveRes.js` does not exist, and `frameStats` is not a function.

- [ ] **Step 3: Implement** `src/scene3d/adaptiveRes.js`

```js
// @ts-check
// Adaptive resolution. PURE — fed the loop's mean frame time, returns a new
// render scale when one is warranted (src/scene3d/renderQuality.js applies it).
//
//   over   mean > target × overRatio for sustainMs  → step DOWN
//   under  mean ≤ target × underRatio for sustainMs → step UP (a probe)
//   between the two ratios: hold (the dead band)
//
// Why probes and back-off: a vsync-capped frame reads ~16.7 ms whether the GPU
// is idle or nearly saturated, so "under" is a guess. A step up that tips the
// frame over is reverted, and the next probe waits twice as long (up to
// maxBackoffMs). Without that, a machine that fits 0.8 but not 0.9 flips
// between them every four seconds, forever.

const EPS = 1e-6;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** scales live on a 0.01 grid, so 0.1 + 0.2 never drifts into 0.30000000000000004 */
const snap = (v) => Math.round(v * 100) / 100;

export class AdaptiveResolution {
  /**
   * @param {{targetMs?:number, min?:number, max?:number, step?:number, sustainMs?:number,
   *   overRatio?:number, underRatio?:number, backoffMs?:number, maxBackoffMs?:number, scale?:number}} [o]
   */
  constructor(o = {}) {
    this.targetMs = o.targetMs ?? 16.7;
    this.min = o.min ?? 0.6;
    this.max = o.max ?? 1.0;
    this.step = o.step ?? 0.1;
    this.sustainMs = o.sustainMs ?? 2000;
    this.overRatio = o.overRatio ?? 1.15;
    this.underRatio = o.underRatio ?? 1.05;
    this.baseBackoffMs = o.backoffMs ?? 10000;
    this.maxBackoffMs = o.maxBackoffMs ?? 120000;
    this.reset(o.scale ?? 1);
  }

  /** @param {number} [scale] */
  reset(scale = this.scale) {
    this.scale = snap(clamp(scale, this.min, this.max));
    this.now = 0;
    this.overMs = 0;
    this.underMs = 0;
    this.backoffMs = this.baseBackoffMs;
    this.probeAt = 0;
    this.lastUpAt = -Infinity;
  }

  /**
   * @param {number} avgMs mean frame time over the loop's window
   * @param {number} dtMs wall time of this frame
   * @returns {number|null} the new scale, or null for no change
   */
  tick(avgMs, dtMs) {
    this.now += dtMs;
    if (avgMs > this.targetMs * this.overRatio) { this.overMs += dtMs; this.underMs = 0; }
    else if (avgMs <= this.targetMs * this.underRatio) { this.underMs += dtMs; this.overMs = 0; }
    else { this.overMs = 0; this.underMs = 0; }

    if (this.overMs >= this.sustainMs && this.scale > this.min + EPS) {
      // an up-probe that this overload followed: the headroom was not real
      if (this.now - this.lastUpAt <= this.sustainMs * 2) this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
      this.probeAt = this.now + this.backoffMs;
      return this._set(this.scale - this.step);
    }
    if (this.underMs >= this.sustainMs && this.scale < this.max - EPS && this.now >= this.probeAt) {
      this.lastUpAt = this.now;
      return this._set(this.scale + this.step);
    }
    return null;
  }

  /** @param {number} s */
  _set(s) {
    this.scale = snap(clamp(s, this.min, this.max));
    this.overMs = 0;
    this.underMs = 0;
    return this.scale;
  }
}
```

- [ ] **Step 4: `src/core/loop.js`**: add after `fps()`:

```js
  /** Mean frame time over the rolling window, and how many frames it holds. */
  frameStats() {
    const n = this._fpsSamples.length;
    if (!n) return { avgMs: 0, count: 0 };
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this._fpsSamples[i];
    return { avgMs: sum / n, count: n };
  }

  /** Forget the window — after a resolution change the old frames describe a different load. */
  resetFrameStats() {
    this._fpsSamples.length = 0;
  }
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/unit/adaptive.test.mjs test/unit/loop.test.mjs`
Expected: 7 adaptive tests PASS, and the loop tests PASS including the new one.

- [ ] **Step 6: Commit**

```bash
git add src/scene3d/adaptiveRes.js src/core/loop.js test/unit/adaptive.test.mjs test/unit/loop.test.mjs
git commit -F - <<'EOF'
feat(render): adaptive-resolution controller with hysteresis and probe back-off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 24: AO as a term, plus a depth-aware bilateral blur

**Files:**
- Create: `src/scene3d/postMath.js`, `src/scene3d/aoBlur.js`, `test/unit/postmath.test.mjs`
- Modify: `src/scene3d/aoPass.js` (rewrite: extends `Pass`, writes the AO term to its own target)

**Interfaces:**
- Produces:
  - `gaussianWeights(radius, sigma?) → Float32Array`
  - `AOPass(camera, {radius, intensity, bias, samples})`, with:
    - `.needsSwap === false`, `.aoTarget`
    - `.setSamples(n)`, `.setOptions({radius, intensity, bias})`
    - `.setSize(w, h)`, `.dispose()`
  - `AOBlurPass(aoPass, {blurRadius, blurDepth})`, with:
    - `.hMat`, `.vMat` (the latter has the `COMPOSITE` define), `.blurTarget`
    - `.setOptions({blurDepth})`, `.setSize(w, h)`, `.dispose()`
- Consumes: `Pass`, `FullScreenQuad` from `three/addons/postprocessing/Pass.js` (a Node shim since Task 2)

- [ ] **Step 1: Write the failing test** `test/unit/postmath.test.mjs`

```js
// @ts-check
// The AO pair. AOPass now writes only the occlusion TERM (no swap), and
// AOBlurPass blurs it with depth-aware weights and composites it. A raw 8–16
// tap SSAO term is visibly noisy — the per-pixel kernel rotation that kills
// banding trades it for grain — and blurring the finished image would blur the
// scene too. The blur weights must sum to 1, or AO brightens or darkens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { gaussianWeights } from '../../src/scene3d/postMath.js';
import { AOPass } from '../../src/scene3d/aoPass.js';
import { AOBlurPass } from '../../src/scene3d/aoBlur.js';

const sum = (w) => w[0] + 2 * [...w].slice(1).reduce((a, b) => a + b, 0);

test('gaussianWeights: normalised over both sides, and falling off from the centre', () => {
  for (const r of [1, 2, 4, 8]) {
    const w = gaussianWeights(r);
    assert.equal(w.length, r + 1);
    assert.ok(Math.abs(sum(w) - 1) < 1e-6, `radius ${r} sums to ${sum(w)}`);
    for (let i = 1; i < w.length; i++) assert.ok(w[i] < w[i - 1]);
  }
  assert.deepEqual([...gaussianWeights(0)], [1]);
});

test('AOPass writes the term to its own target and leaves the colour buffers alone', () => {
  const ao = new AOPass(new THREE.PerspectiveCamera(55, 1, 0.05, 400), { samples: 12, radius: 0.5 });
  assert.equal(ao.needsSwap, false);
  assert.equal(ao.material.defines.KERNEL_SIZE, 12);
  assert.equal(ao.uniforms.radius.value, 0.5);
  ao.setSize(640, 360);
  assert.equal(ao.aoTarget.width, 640);
  assert.deepEqual(ao.uniforms.resolution.value.toArray(), [640, 360]);
});

test('AOPass.setSamples recompiles in place — no new pass', () => {
  const ao = new AOPass(new THREE.PerspectiveCamera(), { samples: 12 });
  const v = ao.material.version;
  ao.setSamples(16);
  assert.equal(ao.material.defines.KERNEL_SIZE, 16);
  assert.equal(ao.uniforms.kernel.value.length, 16);
  assert.ok(ao.material.version > v, 'needsUpdate set');
  ao.setSamples(100);
  assert.equal(ao.material.defines.KERNEL_SIZE, 32, 'clamped');
});

test('AOBlurPass: separable, depth-aware, and the vertical pass composites', () => {
  const ao = new AOPass(new THREE.PerspectiveCamera());
  const blur = new AOBlurPass(ao, { blurRadius: 4, blurDepth: 20 });
  assert.equal(blur.needsSwap, true);
  assert.equal(blur.hMat.defines.BLUR_RADIUS, 4);
  assert.ok(!('COMPOSITE' in blur.hMat.defines));
  assert.ok('COMPOSITE' in blur.vMat.defines);
  assert.ok(Math.abs(sum(blur.hMat.uniforms.weights.value) - 1) < 1e-6);
  assert.equal(blur.vMat.uniforms.depthFalloff.value, 20);
  blur.setSize(800, 400);
  assert.deepEqual(blur.hMat.uniforms.texel.value.toArray(), [1 / 800, 1 / 400]);
  assert.equal(blur.blurTarget.width, 800);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/postmath.test.mjs`
Expected: FAIL, `Cannot find module …/postMath.js`

- [ ] **Step 3: Create** `src/scene3d/postMath.js`

```js
// @ts-check
// Pure post-processing math (no three.js), unit-tested.

/**
 * Normalised one-sided Gaussian weights for a separable blur with `radius`
 * taps each side. w[0] is the centre tap and w[i] applies to BOTH ±i, so
 * w[0] + 2·Σ w[1..r] = 1 — the blur can never brighten or darken what it blurs.
 * @param {number} radius
 * @param {number} [sigma]
 * @returns {Float32Array} radius + 1 weights
 */
export function gaussianWeights(radius, sigma = Math.max(1, radius / 2)) {
  const w = new Float32Array(radius + 1);
  let total = 0;
  for (let i = 0; i <= radius; i++) {
    w[i] = Math.exp(-(i * i) / (2 * sigma * sigma));
    total += i === 0 ? w[i] : 2 * w[i];
  }
  for (let i = 0; i <= radius; i++) w[i] /= total;
  return w;
}
```

- [ ] **Step 4: Rewrite** `src/scene3d/aoPass.js`
  - Keep the header comment block verbatim (lines 2–28: WHY IT MATTERS, WHY NOT, THE APPROACH, and the placement note). Insert this paragraph before `// Placed BEFORE bloom deliberately:`:

```js
// TWO PASSES SINCE v0.7
// This pass writes only the occlusion TERM, into its own target (no swap);
// AOBlurPass (aoBlur.js) blurs that term with a depth-aware bilateral filter
// and multiplies it into the colour buffer. At 8–16 taps a raw SSAO term is
// visibly noisy — the per-pixel kernel rotation that kills banding trades it
// for grain — and blurring the finished image would blur the scene with it.
//
```

  - Replace everything from `import * as THREE from 'three';` to the end of the file with:

```js
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Sample kernel is generated once, in a hemisphere, weighted toward the centre. */
function makeKernel(count) {
  const k = [];
  // deterministic — a fixed kernel keeps AO stable frame to frame, and this file
  // must not consume the game's seeded RNG stream
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand());
    v.normalize();
    // cluster samples near the origin: close occluders matter far more than far ones
    const scale = 0.1 + 0.9 * ((i / count) ** 2);
    v.multiplyScalar(scale);
    k.push(v);
  }
  return k;
}

/** KERNEL_SIZE is a #define; outside 4..32 it is either useless or ruinous */
const clampSamples = (n) => Math.max(4, Math.min(32, Math.round(n)));

const AOShader = {
  name: 'DepthAOShader',
  uniforms: {
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2(1920, 1080) },
    cameraNear: { value: 0.05 },
    cameraFar: { value: 400 },
    camProjection: { value: new THREE.Matrix4() },
    camProjectionInverse: { value: new THREE.Matrix4() },
    kernel: { value: [] },
    radius: { value: 0.45 },
    aoIntensity: { value: 0.9 },
    bias: { value: 0.025 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform highp sampler2D tDepth;
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    // NOT named projectionMatrix. WebGLRenderer.setProgram() writes the RENDERING
    // camera's projection into a uniform of that exact name for every material it
    // draws — and the renderer for a post pass is the fullscreen quad's
    // OrthographicCamera(-1,1,1,-1,0,1). Our carefully-set perspective matrix was
    // overwritten one line before the draw, so every sample reprojected through an
    // orthographic frustum and the occlusion term was noise. Same trap applies to
    // modelViewMatrix, modelMatrix, normalMatrix, viewMatrix and cameraPosition.
    uniform mat4 camProjection;
    uniform mat4 camProjectionInverse;
    uniform vec3 kernel[KERNEL_SIZE];
    uniform float radius;
    uniform float aoIntensity;
    uniform float bias;
    varying vec2 vUv;

    // Reconstruct VIEW-space position from the depth buffer. Note this is a
    // perspective projection, so the stored depth is non-linear — unprojecting
    // through the inverse projection matrix and dividing by w is the only way to
    // get this right. Linearising to a distance and scaling a ray is the common
    // shortcut and it skews everything off the optical axis.
    vec3 viewPos(vec2 uv, float depth) {
      vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 view = camProjectionInverse * ndc;
      return view.xyz / view.w;
    }

    void main() {
      float depth = texture2D(tDepth, vUv).x;

      // The far plane is sky/background (and the sky dome, which writes no
      // depth). Occluding it produces a dark halo around every silhouette,
      // which is the classic SSAO tell.
      if (depth >= 1.0 - 1e-6) { gl_FragColor = vec4(1.0); return; }

      vec3 p = viewPos(vUv, depth);
      // Normal from screen-space derivatives of the reconstructed position. Free,
      // and exact on flat surfaces; it degrades only across depth discontinuities,
      // where the range check below already suppresses the result.
      vec3 n = normalize(cross(dFdx(p), dFdy(p)));

      // Per-pixel rotation of the kernel. Without it the fixed kernel prints its
      // own pattern into every surface as visible banding (the blur pass then
      // removes the grain this rotation leaves behind).
      float a = fract(sin(dot(vUv * resolution, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
      vec3 rv = vec3(cos(a), sin(a), 0.0);
      vec3 t = normalize(rv - n * dot(rv, n));
      mat3 tbn = mat3(t, cross(n, t), n);

      float occ = 0.0;
      for (int i = 0; i < KERNEL_SIZE; i++) {
        vec3 s = p + (tbn * kernel[i]) * radius;
        vec4 clip = camProjection * vec4(s, 1.0);
        vec3 sUv = clip.xyz / clip.w * 0.5 + 0.5;
        if (sUv.x < 0.0 || sUv.x > 1.0 || sUv.y < 0.0 || sUv.y > 1.0) continue;

        float sceneDepth = texture2D(tDepth, sUv.xy).x;
        float sceneZ = viewPos(sUv.xy, sceneDepth).z;
        // view space is right-handed with -Z forward, so a LARGER z is nearer
        if (sceneZ >= s.z + bias) {
          // Range check: an occluder much closer to the camera than the sample
          // belongs to a different surface and must not darken this one.
          occ += smoothstep(0.0, 1.0, radius / max(1e-4, abs(p.z - sceneZ)));
        }
      }
      float ao = clamp(1.0 - (occ / float(KERNEL_SIZE)) * aoIntensity, 0.0, 1.0);
      gl_FragColor = vec4(ao, ao, ao, 1.0);
    }`,
};

export class AOPass extends Pass {
  /**
   * @param {THREE.Camera} camera
   * @param {{radius?:number, intensity?:number, bias?:number, samples?:number}} [opts]
   */
  constructor(camera, opts = {}) {
    super();
    this.camera = camera;
    // writes its own target and leaves the colour ping-pong alone
    this.needsSwap = false;
    const samples = clampSamples(opts.samples ?? 12);
    this.material = new THREE.ShaderMaterial({
      name: AOShader.name,
      defines: { KERNEL_SIZE: samples },
      uniforms: THREE.UniformsUtils.clone(AOShader.uniforms),
      vertexShader: AOShader.vertexShader,
      fragmentShader: AOShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.uniforms = this.material.uniforms;
    this.uniforms.kernel.value = makeKernel(samples);
    this.setOptions(opts);
    /** the occlusion term (R), read by AOBlurPass */
    this.aoTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.quad = new FullScreenQuad(this.material);
  }

  /** Look parameters, live. @param {{radius?:number, intensity?:number, bias?:number}} [o] */
  setOptions(o = {}) {
    this.uniforms.radius.value = o.radius ?? 0.45;
    this.uniforms.aoIntensity.value = o.intensity ?? 0.9;
    this.uniforms.bias.value = o.bias ?? 0.025;
  }

  /**
   * KERNEL_SIZE is a #define, so a new sample count recompiles the program —
   * once, in place — rather than rebuilding the pass.
   * @param {number} n
   */
  setSamples(n) {
    const s = clampSamples(n);
    if (s === this.material.defines.KERNEL_SIZE) return;
    this.material.defines.KERNEL_SIZE = s;
    this.uniforms.kernel.value = makeKernel(s);
    this.material.needsUpdate = true;
  }

  /**
   * Camera matrices change every frame (FOV, aspect); refresh before the draw.
   *
   * tDepth is bound from `readBuffer` HERE rather than once in the constructor,
   * and that is not a style choice. EffectComposer keeps two ping-pong targets:
   * `renderTarget1` is the one you hand it, and `renderTarget2` is a CLONE — with
   * its own DepthTexture instance. RenderPass draws into `readBuffer`, which
   * starts life as the clone, so a uniform wired to the target we constructed
   * sampled a depth attachment nothing had ever written. Measured: depth read as
   * 0 across 100% of the frame, every pixel resolved to the near plane, and the
   * AO term crushed mean scene luma from 17.8 to 1.5 — a black screen, not an
   * effect. Binding whatever buffer RenderPass actually filled is correct no
   * matter which way the ping-pong happens to be pointing.
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.WebGLRenderTarget} writeBuffer
   * @param {THREE.WebGLRenderTarget} readBuffer
   */
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    const cam = /** @type {THREE.PerspectiveCamera} */ (this.camera);
    this.uniforms.cameraNear.value = cam.near;
    this.uniforms.cameraFar.value = cam.far;
    this.uniforms.camProjection.value.copy(cam.projectionMatrix);
    this.uniforms.camProjectionInverse.value.copy(cam.projectionMatrixInverse);
    renderer.setRenderTarget(this.aoTarget);
    this.quad.render(renderer);
  }

  /** @param {number} w @param {number} h drawing-buffer pixels (EffectComposer passes these) */
  setSize(w, h) {
    this.uniforms.resolution.value.set(w, h);
    this.aoTarget.setSize(w, h);
  }

  dispose() {
    this.aoTarget.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
```

- [ ] **Step 5: Create** `src/scene3d/aoBlur.js`

```js
// @ts-check
// Depth-aware bilateral blur of the AO term, then the composite.
//
// Two full-screen draws: a horizontal blur of AOPass's term into our own
// target, then a vertical blur that also multiplies the result into the colour
// buffer. Each tap's Gaussian weight is scaled down by the RELATIVE view-depth
// difference to the centre pixel, so occlusion does not bleed across a
// silhouette (a chair leg's contact shadow must not smear onto the wall behind
// it). Relative, not absolute: a 2 cm step means the same at 1 m and at 20 m.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { gaussianWeights } from './postMath.js';

/** blurRadius above this costs more than the noise it removes */
const MAX_RADIUS = 8;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = /* glsl */ `
  #include <packing>
  uniform sampler2D tAO;
  uniform sampler2D tDiffuse;
  uniform highp sampler2D tDepth;
  uniform vec2 texel;
  uniform vec2 direction;
  uniform float weights[BLUR_RADIUS + 1];
  uniform float depthFalloff;
  uniform float cameraNear;
  uniform float cameraFar;
  varying vec2 vUv;

  float viewZ(vec2 uv) {
    return perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
  }

  void main() {
    float z0 = viewZ(vUv);
    float sum = texture2D(tAO, vUv).r * weights[0];
    float wsum = weights[0];
    for (int i = 1; i <= BLUR_RADIUS; i++) {
      vec2 o = direction * texel * float(i);
      for (int s = -1; s <= 1; s += 2) {
        vec2 uv = vUv + o * float(s);
        float dz = abs(viewZ(uv) - z0) / max(abs(z0), 0.1);
        float w = weights[i] * exp(-dz * depthFalloff);
        sum += texture2D(tAO, uv).r * w;
        wsum += w;
      }
    }
    float ao = sum / max(wsum, 1e-4);
  #ifdef COMPOSITE
    vec4 col = texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(col.rgb * ao, col.a);
  #else
    gl_FragColor = vec4(ao, ao, ao, 1.0);
  #endif
  }`;

export class AOBlurPass extends Pass {
  /**
   * @param {import('./aoPass.js').AOPass} aoPass
   * @param {{blurRadius?:number, blurDepth?:number}} [opts]
   */
  constructor(aoPass, opts = {}) {
    super();
    this.ao = aoPass;
    this.needsSwap = true;
    const radius = Math.max(0, Math.min(MAX_RADIUS, Math.round(opts.blurRadius ?? 4)));
    /** @param {boolean} composite @param {THREE.Vector2} direction */
    const make = (composite, direction) => new THREE.ShaderMaterial({
      defines: composite ? { BLUR_RADIUS: radius, COMPOSITE: 1 } : { BLUR_RADIUS: radius },
      uniforms: {
        tAO: { value: null },
        tDiffuse: { value: null },
        tDepth: { value: null },
        texel: { value: new THREE.Vector2(1, 1) },
        direction: { value: direction },
        weights: { value: Array.from(gaussianWeights(radius)) },
        depthFalloff: { value: opts.blurDepth ?? 12 },
        cameraNear: { value: 0.05 },
        cameraFar: { value: 400 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.hMat = make(false, new THREE.Vector2(1, 0));
    this.vMat = make(true, new THREE.Vector2(0, 1));
    this.hQuad = new FullScreenQuad(this.hMat);
    this.vQuad = new FullScreenQuad(this.vMat);
    this.blurTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  }

  /** @param {{blurDepth?:number}} [o] */
  setOptions({ blurDepth } = {}) {
    for (const m of [this.hMat, this.vMat]) m.uniforms.depthFalloff.value = blurDepth ?? 12;
  }

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.WebGLRenderTarget} writeBuffer
   * @param {THREE.WebGLRenderTarget} readBuffer the scene colour (AOPass did not swap)
   */
  render(renderer, writeBuffer, readBuffer) {
    const cam = /** @type {THREE.PerspectiveCamera} */ (this.ao.camera);
    for (const m of [this.hMat, this.vMat]) {
      m.uniforms.tDepth.value = readBuffer.depthTexture;
      m.uniforms.cameraNear.value = cam.near;
      m.uniforms.cameraFar.value = cam.far;
    }
    this.hMat.uniforms.tAO.value = this.ao.aoTarget.texture;
    renderer.setRenderTarget(this.blurTarget);
    this.hQuad.render(renderer);
    this.vMat.uniforms.tAO.value = this.blurTarget.texture;
    this.vMat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.vQuad.render(renderer);
  }

  /** @param {number} w @param {number} h */
  setSize(w, h) {
    this.blurTarget.setSize(w, h);
    for (const m of [this.hMat, this.vMat]) m.uniforms.texel.value.set(1 / w, 1 / h);
  }

  dispose() {
    this.blurTarget.dispose();
    this.hMat.dispose();
    this.vMat.dispose();
    this.hQuad.dispose();
    this.vQuad.dispose();
  }
}
```

- [ ] **Step 6: Keep PostFX working until Task 25.** `postfx.js` still adds `this.ao` alone. With the rewrite, AOPass no longer composites, so add the blur right after it. In `src/scene3d/postfx.js`:
  - Add `import { AOBlurPass } from './aoBlur.js';`.
  - Replace `if (this.ao) this.composer.addPass(this.ao);` with:

```js
    if (this.ao) {
      this.aoBlur = new AOBlurPass(this.ao, aoCfg);
      this.composer.addPass(this.ao);
      this.composer.addPass(this.aoBlur);
    }
```

  - In `applySize`, delete the line `this.ao?.setSize(w, h);`. `composer.setSize` already hands every pass its drawing-buffer size. This line then overwrote AO's resolution with CSS pixels, which is half the real resolution at DPR 2.

- [ ] **Step 7: Run everything**

Run: `node --test test/unit/postmath.test.mjs && npm test && npm run lint && npm run test:e2e`
Expected: 4 postmath tests PASS. The e2e suite is green with no shader errors (a GLSL error in either pass is a console error).

- [ ] **Step 8: Commit**

```bash
git add src/scene3d/postMath.js src/scene3d/aoPass.js src/scene3d/aoBlur.js src/scene3d/postfx.js test/unit/postmath.test.mjs
git commit -F - <<'EOF'
feat(post): AO writes a term; depth-aware bilateral blur composites it

Also fixes the AO resolution uniform being overwritten with CSS pixels
after the composer set it in drawing-buffer pixels (half-res kernel
rotation at DPR 2).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 25: The post stack, live pass switches, resolution and shadow quality

**Files:**
- Modify: `src/scene3d/postfx.js` (rewrite), `src/scene3d/stage.js` (rewrite), `src/scene3d/lighting.js` (shadow quality)

**Interfaces:**
- Consumes: `renderSettings` (Task 22); `AOPass`, `AOBlurPass` (Task 24); `LUTPass`, `SMAAPass` (Task 2)
- Produces:
  - `PostFX`, with:
    - `.msaa` (fixed for the session)
    - `.ao`, `.aoBlur`, `.bloom`, `.output`, `.lut`, `.smaa`, `.final`
    - `.configure(settings)`, `.applyLook()`, `.setLUT(texture3D|null)`, `.render(dtMs)`
  - `Stage`, with `.pixelRatioCap`, `.renderScale`, `.pixelRatio()`, `.setResolution(cap, scale)`, `.setShadowsEnabled(on)`
  - `Lighting.setShadowQuality(mode, size)`

- [ ] **Step 1: Rewrite** `src/scene3d/postfx.js`

```js
// @ts-check
// Post-processing. The pass order, and why each pass sits where it does:
//
//   RenderPass   linear HDR into a half-float target (MSAA 4x/2x/off by preset)
//   AOPass       the occlusion TERM, from the depth RenderPass left behind
//   AOBlurPass   depth-aware bilateral blur of that term, multiplied in
//   Bloom        still linear HDR, BEFORE tone-mapping — threshold 1.55 means "emissive"
//   OutputPass   ACES tone-map + sRGB; everything after this is display-referred
//   LUTPass      the neon-noir grade; a .cube is authored on display colour
//   SMAA         after the grade, so it anti-aliases what the player actually sees —
//                including post-process and alpha edges MSAA never touches
//   Final        grain + vignette + chromatic aberration: film artefacts, last
//
// Every pass but RenderPass/OutputPass can be switched live by the quality
// preset (configure()); only the MSAA sample count is fixed for the session,
// because a render target's sample count is baked in when it is created.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { AOPass } from './aoPass.js';
import { AOBlurPass } from './aoBlur.js';
import { cfg } from '../core/config.js';
import { renderSettings } from './quality.js';

// Runs AFTER OutputPass, i.e. on tone-mapped display-referred colour. It used to
// run before it, adding a flat +/-0.0225 to *linear HDR*: in shadow regions
// (linear ~0.01) the grain buried the image, and in highlights it was invisible.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    seed: { value: 0 },
    resolution: { value: new THREE.Vector2(1920, 1080) },
    grainAmount: { value: 0.055 },
    grainShadowBias: { value: 0.65 },   // film grains more in the mids/darks
    vignetteStrength: { value: 0.42 },
    aberration: { value: 0.0022 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float seed;
    uniform vec2 resolution;
    uniform float grainAmount;
    uniform float grainShadowBias;
    uniform float vignetteStrength;
    uniform float aberration;
    varying vec2 vUv;

    // All-fract arithmetic, so it keeps its precision. The old
    // sin(dot(p,..) + time*43.7) hash degenerated into visible banding once the
    // time accumulator grew: it ran up to 1000, and at those magnitudes fp32 has
    // no mantissa left for the fractional part the hash depends on.
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 d = vUv - 0.5;
      // chromatic aberration: radial, zero at the centre where the player looks
      vec2 off = d * dot(d, d) * aberration * 4.0;
      vec4 col = texture2D(tDiffuse, vUv);
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float n = hash(vUv * resolution + seed) - 0.5;
      // scale grain by (1 - luma) so highlights stay clean, like real film
      float luma = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      col.rgb += n * grainAmount * mix(1.0, 1.0 - luma, grainShadowBias);
      col.rgb *= 1.0 - vignetteStrength * dot(d, d) * 2.2;
      gl_FragColor = col;
    }`,
};

export class PostFX {
  /** @param {import('./stage.js').Stage} stage */
  constructor(stage) {
    this.stage = stage;
    const { renderer, scene, camera } = stage;
    const q = renderSettings(cfg('render', {}));
    /** fixed for the session — Settings says "applies on reload" */
    this.msaa = q.msaa;

    // MSAA. `antialias` on the renderer is inert once everything goes through
    // EffectComposer: the composer renders into its own target. Supplying the
    // target explicitly — with samples — is what antialiases the scene.
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // A DEPTH attachment on the composer target. RenderPass fills it as a side
    // effect of drawing the scene, which is what lets the AO pass run without a
    // second geometry submission. Float depth, not the default UnsignedShort:
    // the camera spans 0.05..400m, and at 16 bits the far half of that range
    // quantises hard enough that AO banded on anything past the near furniture.
    const depthTexture = new THREE.DepthTexture(size.width, size.height);
    depthTexture.type = THREE.FloatType;
    depthTexture.format = THREE.DepthFormat;
    const target = new THREE.WebGLRenderTarget(size.width, size.height, {
      type: THREE.HalfFloatType,
      samples: this.msaa,
      depthTexture,
    });
    this.depthTexture = depthTexture;
    this.composer = new EffectComposer(renderer, target);

    const aoCfg = cfg('render.ao', {});
    this.renderPass = new RenderPass(scene, camera);
    this.ao = new AOPass(camera, { ...aoCfg, samples: q.ao.samples });
    this.aoBlur = new AOBlurPass(this.ao, aoCfg);
    // Threshold is in LINEAR HDR (bloom runs before OutputPass tone-maps). 1.55
    // sits above lit skin/hair and below the neon core (2.4), so only things that
    // are actually emissive glow. Values are (re)read in applyLook().
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.40, 1.55);
    this.output = new OutputPass();
    this.lut = new LUTPass({ intensity: 0.85 });
    this.lut.enabled = false;   // until setLUT() hands it a table
    this.smaa = new SMAAPass(size.width, size.height);
    this.final = new ShaderPass(FinalShader);
    for (const p of [this.renderPass, this.ao, this.aoBlur, this.bloom, this.output, this.lut, this.smaa, this.final]) {
      this.composer.addPass(p);
    }
    /** @type {THREE.Data3DTexture|null} */
    this._lutTexture = null;

    const applySize = (w, h) => {
      const pr = renderer.getPixelRatio();
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);   // hands every pass its drawing-buffer size
      this.final.uniforms.resolution.value.set(w * pr, h * pr);
    };
    stage.resizeHooks.push(applySize);
    applySize(window.innerWidth, window.innerHeight);

    this.applyLook();
    this.configure(q);
  }

  /**
   * Switch passes for a quality settings object. Live: nothing here rebuilds a
   * render target (the AO sample count recompiles one program).
   * @param {import('./quality.js').QualitySettings} q
   */
  configure(q) {
    this.settings = q;
    this.ao.enabled = q.ao.enabled;
    this.aoBlur.enabled = q.ao.enabled;
    this.ao.setSamples(q.ao.samples);
    this.bloom.enabled = q.bloom;
    this.lut.enabled = q.lut && !!this._lutTexture;
    this.smaa.enabled = q.smaa;
  }

  /** Re-read the look parameters (bloom, grain, aberration, LUT strength, AO shape) from config. */
  applyLook() {
    const b = cfg('render.bloom', {});
    this.bloom.strength = b.strength ?? 0.42;
    this.bloom.radius = b.radius ?? 0.40;
    this.bloom.threshold = b.threshold ?? 1.55;
    const g = cfg('render.grain', {});
    const u = this.final.uniforms;
    u.grainAmount.value = g.amount ?? 0.055;
    u.vignetteStrength.value = g.vignette ?? 0.42;
    u.aberration.value = cfg('render.aberration', 0.0022);
    this.lut.intensity = cfg('render.lut.intensity', 0.85);
    const ao = cfg('render.ao', {});
    this.ao.setOptions(ao);
    this.aoBlur.setOptions(ao);
  }

  /**
   * The grade's 3D table, once the asset facade has loaded it (null = no
   * grade: the pass stays off, which is the procedural fallback).
   * @param {THREE.Data3DTexture|null} texture3D
   */
  setLUT(texture3D) {
    this._lutTexture = texture3D ?? null;
    this.lut.lut = this._lutTexture;
    this.lut.enabled = !!(this.settings?.lut && this._lutTexture);
  }

  /** @param {number} dtMs */
  render(dtMs) {
    // one reset per FRAME (Stage turned autoReset off), so renderer.info counts every pass
    this.stage.renderer.info.reset();
    // bounded, drift-free animation seed — never grows into fp32's dead zone
    this._t = ((this._t || 0) + dtMs * 0.06) % 1024;
    this.final.uniforms.seed.value = this._t;
    this.composer.render();
  }
}
```

- [ ] **Step 2: Rewrite** `src/scene3d/stage.js`

```js
// @ts-check
// Renderer + root scene + main camera + resize plumbing.
import * as THREE from 'three';
import { cfg } from '../core/config.js';
import { renderSettings } from './quality.js';

// _buildExterior runs twice (penthouse + rooftop) with its own TextureLoader
// each time, and three's loader cache is OFF by default — so the skyline and
// window textures were fetched, decoded and uploaded to the GPU twice.
THREE.Cache.enabled = true;

export class Stage {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    // antialias OFF: every frame goes through EffectComposer's own targets, so
    // the default framebuffer's MSAA only ever smoothed the final full-screen
    // quad. The real AA is MSAA on the composer target plus SMAA (postfx.js).
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // EffectComposer issues ~10 draws of its own a frame; with autoReset on,
    // renderer.info described only the last full-screen quad. PostFX.render()
    // resets it once per frame, so the F3 overlay counts the whole frame.
    this.renderer.info.autoReset = false;

    const q = renderSettings(cfg('render', {}));
    // r185 folded PCFSoftShadowMap into PCFShadowMap (it warns, then swaps), so
    // "soft" vs "hard" is now the light's shadow.radius — Lighting.setShadowQuality.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.enabled = q.shadows !== 'off';
    this.pixelRatioCap = q.pixelRatioCap;
    this.renderScale = q.renderScale;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06070c);

    this.camera = new THREE.PerspectiveCamera(cfg('render.fov', 55), 1, 0.05, 400);
    this.camera.position.set(0, 1.6, 4);

    /** @type {Array<(w:number,h:number)=>void>} */
    this.resizeHooks = [];
    window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  /** Drawing-buffer pixel ratio: the display's, capped by the preset, times the render scale. */
  pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.pixelRatioCap) * this.renderScale;
  }

  /**
   * Quality preset / adaptive resolution. Resizes the canvas drawing buffer
   * and, through the resize hooks, every post target.
   * @param {number} cap @param {number} scale
   */
  setResolution(cap, scale) {
    if (cap === this.pixelRatioCap && scale === this.renderScale) return;
    this.pixelRatioCap = cap;
    this.renderScale = scale;
    this._resize();
  }

  /**
   * Shadows on/off, live. Every lit program bakes the shadow-map state in, so
   * all of them are marked for recompile (once, on the switch).
   * @param {boolean} on
   */
  setShadowsEnabled(on) {
    const sm = this.renderer.shadowMap;
    if (sm.enabled === on) return;
    sm.enabled = on;
    sm.needsUpdate = true;
    this.scene.traverse((o) => {
      const m = /** @type {any} */ (o).material;
      if (!m) return;
      for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
    });
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // re-derived on every resize so a window dragged to another display picks up its DPR
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const fn of this.resizeHooks) fn(w, h);
  }
}
```

- [ ] **Step 3: Shadow quality in `src/scene3d/lighting.js`**
  - Add `import { renderSettings } from './quality.js';`.
  - Add a module constant: `/** PCF filter radius for "soft" shadows (r185 has no separate soft shadow type). */ const SOFT_RADIUS = 3;`
  - In the constructor, replace `const mapSize = cfg('render.shadowMapSize', 2048);` and `this.key.shadow.mapSize.set(mapSize, mapSize);` with:

```js
    const q = renderSettings(cfg('render', {}));
    this.key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
```

  - Directly after the `this.key.shadow.normalBias = 0.022;` line, add:

```js
    this.key.shadow.radius = q.shadows === 'soft' ? SOFT_RADIUS : 1;
```

  - Add the method after `setFloorOffset`:

```js
  /**
   * Shadow softness + resolution, live. Softness is the PCF filter radius;
   * a new map size needs the old map disposed, so the renderer allocates a new
   * one on its next shadow pass.
   * @param {'off'|'hard'|'soft'} mode @param {number} size
   */
  setShadowQuality(mode, size) {
    this.key.shadow.radius = mode === 'soft' ? SOFT_RADIUS : 1;
    if (this.key.shadow.mapSize.x === size) return;
    this.key.shadow.mapSize.set(size, size);
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null;
  }
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run lint && npm run test:e2e`
Expected: all green. The boot test's zero-console-errors assertion also covers the new SMAA/LUT/final shaders compiling. The LUT pass stays disabled until Task 26 hands it a table.

- [ ] **Step 5: Commit**

```bash
git add src/scene3d/postfx.js src/scene3d/stage.js src/scene3d/lighting.js
git commit -F - <<'EOF'
feat(post): SMAA + LUT grade + chromatic aberration; live pass switches, render scale

Pass order: Render → AO → AO blur → Bloom → Output → LUT → SMAA → Final.
The stage takes a pixel-ratio cap and render scale from the preset;
renderer.info resets per frame so it counts the whole frame.

Fixes: soft and hard shadows had been identical since r185 folded
PCFSoftShadowMap into PCFShadowMap; softness is now the shadow radius.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 26: RenderQuality: live apply, adaptive tick, LUT, `?quality=`

**Files:**
- Create: `src/scene3d/renderQuality.js`, `test/unit/renderquality.test.mjs`
- Modify: `src/core/app.js`, `src/main.js`, `test/smoke/smoke.spec.mjs`

**Interfaces:**
- Consumes:
  - `renderSettings` (Task 22), `AdaptiveResolution` (Task 23)
  - `stage.setResolution`/`setShadowsEnabled` and `postfx.configure`/`applyLook`/`setLUT` (Task 25)
  - `lighting.setShadowQuality` (Task 25) and `setHDRI` (Task 18)
  - `world.setRainDensity` (Task 20) and `setSkyTexture` (Task 19)
  - `assets.setAnisotropy`/`loadLUT` (Task 7), `loop.frameStats`/`resetFrameStats` (Task 23)
- Produces:
  - `new RenderQuality({ stage, postfx, assets, loop, lighting: () => Lighting|null, world: () => World3D|null })`, with:
    - `.settings`, `.level`, `.adaptive`
    - `.apply(next?)`, `.tick(dtMs)`, `.dispose()`
  - `app.renderQuality`
  - The bus event `render.applied { settings }`

- [ ] **Step 1: Write the failing test** `test/unit/renderquality.test.mjs`

```js
// @ts-check
// src/scene3d/renderQuality.js — the one place resolved settings are pushed
// into the subsystems. The Settings panel applies a preset by writing config;
// this test proves that write alone reaches every subsystem, live, and that
// adaptive resolution moves the stage and resets the loop's window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_DEFAULTS } from '../../data/configDefaults.js';
import { applyConfig, _setConfigStore } from '../../src/core/config.js';
import { RenderQuality } from '../../src/scene3d/renderQuality.js';

function rig({ maxAniso = 8 } = {}) {
  const calls = [];
  const stage = {
    pixelRatioCap: 2, renderScale: 1,
    renderer: { capabilities: { getMaxAnisotropy: () => maxAniso } },
    setResolution(c, s) { calls.push(['res', c, s]); this.pixelRatioCap = c; this.renderScale = s; },
    setShadowsEnabled: (on) => calls.push(['shadowsOn', on]),
  };
  const postfx = { configure: (q) => calls.push(['post', q.smaa, q.ao.enabled]), applyLook: () => calls.push(['look']) };
  const assets = { setAnisotropy: (n) => calls.push(['aniso', n]) };
  let stats = { avgMs: 10, count: 60 };
  const loop = { frameStats: () => stats, resetFrameStats: () => { calls.push(['reset']); stats = { avgMs: 0, count: 0 }; }, setStats: (s) => { stats = s; } };
  const lighting = { setShadowQuality: (m, s) => calls.push(['shadowQ', m, s]), setHDRI: async (r) => { calls.push(['hdri', r]); return null; } };
  const world = { setRainDensity: (d) => calls.push(['rain', d]), setSkyTexture: (t) => calls.push(['sky', t]) };
  const rq = new RenderQuality(/** @type {any} */ ({ stage, postfx, assets, loop, lighting: () => lighting, world: () => world }));
  return { rq, calls, loop };
}
const has = (calls, entry) => calls.some((c) => JSON.stringify(c) === JSON.stringify(entry));

test('apply() pushes every setting into every subsystem', () => {
  _setConfigStore(structuredClone(CONFIG_DEFAULTS));
  applyConfig('render', { quality: 'low' });
  const { rq, calls } = rig();
  rq.apply();
  for (const e of [['res', 1, 0.8], ['shadowsOn', false], ['shadowQ', 'off', 1024], ['post', false, false], ['look'], ['rain', 0.35], ['aniso', 2]]) {
    assert.ok(has(calls, e), `missing ${JSON.stringify(e)}`);
  }
  rq.dispose();
});

test('a render config change re-applies live — including the HDRI resolution', async () => {
  _setConfigStore(structuredClone(CONFIG_DEFAULTS));
  applyConfig('render', { quality: 'low' });
  const { rq, calls } = rig();
  calls.length = 0;
  applyConfig('render', { quality: 'ultra' });
  await Promise.resolve();
  assert.ok(has(calls, ['shadowQ', 'soft', 4096]));
  assert.ok(has(calls, ['hdri', '2k']), 'low had no HDRI; ultra loads the 2K one');
  assert.equal(rq.level, 'ultra');
  rq.dispose();
});

test('anisotropy is clamped to what the GPU supports', () => {
  _setConfigStore(structuredClone(CONFIG_DEFAULTS));
  applyConfig('render', { quality: 'ultra' });
  const { rq, calls } = rig({ maxAniso: 4 });
  rq.apply();
  assert.ok(has(calls, ['aniso', 4]));
  rq.dispose();
});

test('adaptive: sustained overload steps the stage down and restarts the frame window', () => {
  _setConfigStore(structuredClone(CONFIG_DEFAULTS));
  applyConfig('render', { quality: 'medium' });   // adaptive on
  const { rq, calls, loop } = rig();
  loop.setStats({ avgMs: 30, count: 60 });
  for (let t = 0; t < 2100; t += 16.7) { rq.tick(16.7); if (has(calls, ['reset'])) break; loop.setStats({ avgMs: 30, count: 60 }); }
  assert.ok(has(calls, ['res', 1.25, 0.9]));
  assert.ok(has(calls, ['reset']));
  rq.dispose();
});

test('adaptive does nothing when off, or before the window has 30 frames', () => {
  _setConfigStore(structuredClone(CONFIG_DEFAULTS));   // high: adaptive off
  const a = rig();
  a.loop.setStats({ avgMs: 50, count: 60 });
  for (let t = 0; t < 5000; t += 16.7) a.rq.tick(16.7);
  assert.ok(!a.calls.some((c) => c[0] === 'res'));
  a.rq.dispose();
  applyConfig('render', { quality: 'medium' });
  const b = rig();
  b.loop.setStats({ avgMs: 50, count: 10 });
  for (let t = 0; t < 5000; t += 16.7) b.rq.tick(16.7);
  assert.ok(!b.calls.some((c) => c[0] === 'res'));
  b.rq.dispose();
  _setConfigStore(structuredClone(CONFIG_DEFAULTS));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/renderquality.test.mjs`
Expected: FAIL, `Cannot find module …/renderQuality.js`

- [ ] **Step 3: Implement** `src/scene3d/renderQuality.js`

```js
// @ts-check
// The live quality switch. Resolves the render config into settings
// (src/scene3d/quality.js) and pushes them into every subsystem that owns one:
// Stage (resolution, shadows on/off), PostFX (passes + look), Lighting (shadow
// softness and map size, HDRI resolution), World3D (rain density, sky dome) and
// the asset facade (anisotropy). It re-applies on every `config.changed` for
// the render group — which is how the Settings panel switches a preset with no
// reload — and drives adaptive resolution from the loop's frame-time window.
import { cfg } from '../core/config.js';
import { on, emit } from '../core/bus.js';
import { renderSettings } from './quality.js';
import { AdaptiveResolution } from './adaptiveRes.js';

/** Frames the loop must have averaged before adaptive resolution trusts the number. */
const MIN_SAMPLES = 30;

export class RenderQuality {
  /**
   * @param {{
   *   stage: import('./stage.js').Stage,
   *   postfx: import('./postfx.js').PostFX,
   *   assets: {setAnisotropy:(n:number)=>void},
   *   loop: {frameStats:()=>{avgMs:number,count:number}, resetFrameStats:()=>void},
   *   lighting: () => (import('./lighting.js').Lighting|null|undefined),
   *   world: () => (import('./tower/zoneBuilder.js').World3D|null|undefined),
   * }} deps
   */
  constructor(deps) {
    this.deps = deps;
    /** @type {import('./quality.js').QualitySettings} */
    this.settings = renderSettings(cfg('render', {}));
    this.adaptive = new AdaptiveResolution({ targetMs: cfg('render.targetFrameMs', 16.7), scale: this.settings.renderScale });
    this._off = on('config.changed', (e) => {
      if (!e || e.group === 'render') this.apply(renderSettings(cfg('render', {})));
    });
  }

  /** The preset name in effect. */
  get level() { return cfg('render.quality', 'high'); }

  /**
   * Push settings everywhere. Idempotent: every setter below no-ops when the
   * value is unchanged, so calling this after the world is built just fills in
   * the subsystems that did not exist at boot.
   * @param {import('./quality.js').QualitySettings} [next]
   */
  apply(next = this.settings) {
    const prev = this.settings;
    this.settings = next;
    const { stage, postfx, assets } = this.deps;
    const lighting = this.deps.lighting();
    const world = this.deps.world();
    stage.setResolution(next.pixelRatioCap, next.renderScale);
    this.adaptive.reset(next.renderScale);
    this.adaptive.targetMs = cfg('render.targetFrameMs', 16.7);
    stage.setShadowsEnabled(next.shadows !== 'off');
    lighting?.setShadowQuality(next.shadows, next.shadowMapSize);
    postfx.configure(next);
    postfx.applyLook();
    world?.setRainDensity(next.rain);
    assets.setAnisotropy(Math.min(next.anisotropy, stage.renderer.capabilities.getMaxAnisotropy()));
    if (lighting && prev.hdri !== next.hdri) {
      lighting.setHDRI(next.hdri).then((eq) => this.deps.world()?.setSkyTexture(eq));
    }
    emit('render.applied', { settings: next });
  }

  /**
   * Once per rendered frame. A no-op unless adaptive resolution is on and the
   * loop's window holds enough frames to mean something.
   * @param {number} dtMs
   */
  tick(dtMs) {
    if (!this.settings.adaptive) return;
    const { avgMs, count } = this.deps.loop.frameStats();
    if (count < MIN_SAMPLES) return;
    const scale = this.adaptive.tick(avgMs, dtMs);
    if (scale === null) return;
    this.deps.stage.setResolution(this.settings.pixelRatioCap, scale);
    // those frames were drawn at the old resolution
    this.deps.loop.resetFrameStats();
  }

  dispose() { this._off?.(); }
}
```

- [ ] **Step 4: App wiring** (`src/core/app.js`)
  - Add `import { RenderQuality } from '../scene3d/renderQuality.js';`.
  - In the constructor, **delete** the alpha.2 line `this.assets.setAnisotropy(Math.min(8, …));`.
  - Directly after the `this.loop = new Loop({ … });` statement, add:

```js
    // the live quality switch + adaptive resolution (src/scene3d/renderQuality.js)
    this.renderQuality = new RenderQuality({
      stage: this.stage, postfx: this.postfx, assets: this.assets, loop: this.loop,
      lighting: () => this.lighting, world: () => this.world,
    });
    this.renderQuality.apply();
    // the neon-noir grade; null (no asset) leaves the LUT pass off — the ungraded look
    this.assetsReady
      .then(() => this.assets.loadLUT(cfg('render.lut.id', 'neon_noir')))
      .then((lut) => this.postfx.setLUT(lut?.texture3D ?? null));
```

  - In `startRun()`, replace the beta.1 literal `const hdri = /** @type {'off'|'1k'|'2k'} */ ('2k');` with:

```js
    const hdri = this.renderQuality.settings.hdri;
```

  - Directly before `this.world.precompile(this.stage.renderer, this.stage.camera);`, add:

```js
    // the world and lighting exist now: push rain density, shadow quality, etc. into them
    this.renderQuality.apply();
```

  - In `render(dt)`, directly before `this.postfx.render(dt);`, add `this.renderQuality.tick(dt);`.

- [ ] **Step 5: `?quality=`** (`src/main.js`)
  - Change the config import to `import { loadConfig, applyConfig } from './core/config.js';`.
  - After the `loadConfig` line, add:

```js
// ?quality=low|medium|high|ultra — a session-only preset (e2e + perf sampling);
// an invalid value is rejected by the schema and the configured preset stands
{
  const q = new URLSearchParams(location.search).get('quality');
  if (q) {
    const errs = applyConfig('render', { quality: q });
    if (errs.length) console.warn('[boot] ignored ?quality=', q, errs);
  }
}
```

- [ ] **Step 6: Smoke test.** Add to `test/smoke/smoke.spec.mjs`:

```js
  test('the post stack at high: AO + blur, bloom, grade, SMAA, in order', async ({ page }) => {
    await bootToRun(page, `${URL}&quality=high`);
    const s = await page.evaluate(() => {
      const p = window.__ncld.app.postfx;
      return {
        order: p.composer.passes.map((x) => x.constructor.name),
        smaa: p.smaa.enabled, lut: p.lut.enabled, ao: p.ao.enabled, blur: p.aoBlur.enabled, msaa: p.msaa,
      };
    });
    expect(s.order).toEqual(['RenderPass', 'AOPass', 'AOBlurPass', 'UnrealBloomPass', 'OutputPass', 'LUTPass', 'SMAAPass', 'ShaderPass']);
    expect(s).toMatchObject({ smaa: true, lut: true, ao: true, blur: true, msaa: 4 });
  });
```

  - In the `?noassets=1` test, add `lut: window.__ncld.app.postfx.lut.enabled,` to the state and `expect(state.lut).toBe(false);`. With no LUT asset the pass stays off, which is the ungraded fallback.

- [ ] **Step 7: Run everything**

Run: `node --test test/unit/renderquality.test.mjs && npm test && npm run lint && npm run test:e2e`
Expected: 5 new unit tests PASS, and the e2e suite is green.

- [ ] **Step 8: Commit**

```bash
git add src/scene3d/renderQuality.js src/core/app.js src/main.js test/unit/renderquality.test.mjs test/smoke/smoke.spec.mjs
git commit -F - <<'EOF'
feat(render): RenderQuality — live preset apply, adaptive resolution, LUT, ?quality=

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 27: The GRAPHICS section of the Settings panel

**Files:**
- Modify: `src/ui/settingsPanel.js`

**Interfaces:**
- Consumes: `QUALITY_LEVELS`, `renderSettings` (Task 22); `replaceConfig`, `saveConfigFile(…, { replace })` (Task 22)
- Produces:
  - Rows with these accessible names: radiogroups `Graphics quality`, `Anti-aliasing`, `Adaptive resolution`, `Shadow quality`, `Ambient occlusion` and `Colour grade`, plus sliders `Render scale`, `Bloom strength`, `Film grain amount` and `Field of view`
  - Every change writes the whole `render` group through `replaceConfig`, so it applies live via RenderQuality

- [ ] **Step 1: Edit the imports.** Change `import { cfg, applyConfig, saveConfigFile } from '../core/config.js';` to `import { cfg, replaceConfig, saveConfigFile } from '../core/config.js';`, and add:

```js
import { QUALITY_LEVELS, renderSettings } from '../scene3d/quality.js';
```

Below `const SHADOWS = …`, add:

```js
const AA_MODES = [['off', 'off'], ['smaa', 'SMAA'], ['msaa', 'MSAA + SMAA']];
```

In the file header, replace the paragraph starting `// Graphics had no control anywhere:` with:

```js
// Graphics is a quality preset (low/medium/high/ultra) that applies live, plus
// individual overrides beneath it. Only two settings still need a reload: the
// MSAA sample count (baked into the render target) and the field of view (the
// camera is built once).
```

- [ ] **Step 2: Replace the graphics logic.** In `settingsBody`, replace everything from the comment `// Graphics live in the CONFIG layer, not user settings, because the render` down to (not including) `return [` with:

```js
  // Graphics live in the CONFIG layer, not user settings: the render stack
  // reads them through cfg(). Every change writes the WHOLE group (to
  // config/render.yaml when the kit API is up, for this session otherwise)
  // through replaceConfig — a merge cannot remove a key, and picking a preset
  // must clear the overrides beneath it. RenderQuality listens for the change
  // and applies it live.
  const render = cfg('render', {});
  const q = renderSettings(render);   // what is actually in effect: preset ⊕ overrides
  let toastT = 0;
  /**
   * @param {(cur:any) => any} makeNext builds the next whole group from a copy of the current one
   * @param {{redraw?: boolean, reload?: boolean}} [o]
   */
  const setRender = async (makeNext, { redraw = true, reload = false } = {}) => {
    const next = makeNext(structuredClone(cfg('render', {})));
    const res = await saveConfigFile('render', next, { replace: true });
    if (!res.ok) {
      // no server write (static hosting, or the kit API is off) — at least make
      // it true for this session rather than silently doing nothing
      const errs = replaceConfig('render', next);
      if (errs?.length) { emit('hud.alert', { text: errs[0], kind: 'warn' }); return; }
    }
    clearTimeout(toastT);
    toastT = setTimeout(() => emit('hud.alert', {
      text: !res.ok ? 'Graphics applied for this session (could not write config/render.yaml).'
        : reload ? 'Graphics saved — reload to apply that one.' : 'Graphics saved.',
      kind: res.ok ? 'info' : 'warn',
    }), 400);
    // Sliders must NOT redraw: both hosts rebuild the whole panel, which
    // destroys the <input type=range> under the cursor and kills the drag after
    // a single step.
    if (redraw) rerender();
  };
  /** one or more preset keys, written as overrides (ao merges key by key) */
  const override = (patch, o) => setRender((cur) => {
    const prev = cur.overrides ?? {};
    const merged = { ...prev, ...patch };
    if (patch.ao) merged.ao = { ...(prev.ao ?? {}), ...patch.ao };
    return { ...cur, overrides: merged };
  }, o);
  /** a look parameter (bloom / grain), outside the preset */
  const look = (key, patch) => setRender((cur) => ({ ...cur, [key]: { ...(cur[key] ?? {}), ...patch } }), { redraw: false });
  const aaMode = q.msaa > 0 ? 'msaa' : q.smaa ? 'smaa' : 'off';
```

- [ ] **Step 3: Replace the GRAPHICS rows.** Replace everything from `h('div', { class: 'dir-label' }, ['GRAPHICS']),` to the end of the returned array (before its closing `];`) with:

```js
    h('div', { class: 'dir-label' }, ['GRAPHICS']),
    row('Quality',
      segmented(QUALITY_LEVELS.map((x) => [x, x]), render.quality ?? 'high',
        (v) => setRender((cur) => ({ ...cur, quality: v, overrides: {} })), 'Graphics quality'),
      'applies now · clears the overrides below'),
    row('Render scale',
      slider(q.renderScale, 0.5, 1, 0.05,
        (v) => override({ renderScale: v }, { redraw: false }), 'Render scale'),
      'fraction of full resolution drawn'),
    row('Anti-aliasing',
      segmented(AA_MODES, aaMode,
        (v) => override({ smaa: v !== 'off', msaa: v === 'msaa' ? (q.msaa || 4) : 0 },
          { reload: (v === 'msaa') !== (q.msaa > 0) }), 'Anti-aliasing'),
      'MSAA sample count applies on reload'),
    row('Adaptive resolution',
      segmented([[true, 'on'], [false, 'off']], q.adaptive,
        (v) => override({ adaptive: v }), 'Adaptive resolution'),
      'lowers render scale to hold 60 fps'),

    h('div', { class: 'dir-label' }, ['OVERRIDES']),
    row('Shadows',
      segmented(SHADOWS.map((x) => [x, x]), q.shadows,
        (v) => override({ shadows: v }), 'Shadow quality'),
      'soft costs the most'),
    row('Ambient occlusion',
      segmented([[true, 'on'], [false, 'off']], q.ao.enabled,
        (v) => override({ ao: { enabled: v } }), 'Ambient occlusion'),
      'contact shadows — about 1.8ms a frame with the blur'),
    row('Colour grade',
      segmented([[true, 'on'], [false, 'off']], q.lut,
        (v) => override({ lut: v }), 'Colour grade'),
      'the neon-noir LUT'),
    row('Bloom',
      slider(render.bloom?.strength ?? 0.42, 0, 1.2, 0.02,
        (v) => look('bloom', { strength: v }), 'Bloom strength'),
      'neon glow'),
    row('Film grain',
      slider(render.grain?.amount ?? 0.055, 0, 0.2, 0.005,
        (v) => look('grain', { amount: v }), 'Film grain amount'),
      null),
    row('Field of view',
      slider(render.fov ?? 55, 55, 100, 1,
        (v) => setRender((cur) => ({ ...cur, fov: v }), { redraw: false, reload: true }), 'Field of view'),
      'applies on reload'),
```

- [ ] **Step 4: Run and look**

Run: `npm test && npm run lint`
Expected: green.

Then serve the game and open Main menu → Settings.
- Click `low`: the image drops to 80% resolution with no shadows, instantly.
- Click `ultra`: sharp, with soft shadows.
- Move `Render scale`: resolution follows the drag, and the drag does not break.
- Toggle `Adaptive resolution`, `Shadows`, `Ambient occlusion` and `Colour grade`: each applies with no reload.
- Picking a preset re-selects that preset's values in the override rows below it.

- [ ] **Step 5: Commit**

```bash
git add src/ui/settingsPanel.js
git commit -F - <<'EOF'
feat(ui): Settings graphics — quality preset, render scale, AA, adaptive, overrides, all live

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 28: The F3 performance overlay

**Files:**
- Create: `src/ui/perfOverlay.js`, `test/unit/renderdebug.test.mjs`
- Modify: `src/core/app.js`

**Interfaces:**
- Consumes: `loop.frameStats` (Task 23), `renderer.info` (reset per frame, Task 25), `app.renderQuality` (Task 26)
- Produces:
  - `formatPerf({avgMs, fps, calls, triangles, textures, geometries, scale, preset, adaptive}) → string`
  - `new PerfOverlay({ renderer, loop, quality, stage })` with `.toggle()`, `.update()`, `.visible`
  - The `#perf-overlay` element
  - The F3 key, bound only when `app.debug`

- [ ] **Step 1: Write the failing test** `test/unit/renderdebug.test.mjs`

```js
// @ts-check
// Render debugging readouts. formatPerf is the F3 overlay's text: it has to
// stay readable at a glance — ms and fps first, counts compact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPerf } from '../../src/ui/perfOverlay.js';

test('formatPerf: frame time and fps first, then draws/tris, textures/geometries, scale + preset', () => {
  const text = formatPerf({ avgMs: 16.73, fps: 60, calls: 412, triangles: 1234567, textures: 88, geometries: 301, scale: 0.9, preset: 'medium', adaptive: true });
  assert.deepEqual(text.split('\n'), [
    '16.7 ms  60 fps',
    '412 draws  1.23M tris',
    '88 tex  301 geo',
    'scale 0.90  medium · adaptive',
  ]);
});

test('formatPerf: small counts stay exact, thousands get a k', () => {
  const text = formatPerf({ avgMs: 8, fps: 125, calls: 9, triangles: 5400, textures: 1, geometries: 2, scale: 1, preset: 'high', adaptive: false });
  assert.match(text, /9 draws {2}5\.4k tris/);
  assert.match(text, /scale 1\.00 {2}high$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/renderdebug.test.mjs`
Expected: FAIL, `Cannot find module …/perfOverlay.js`

- [ ] **Step 3: Implement** `src/ui/perfOverlay.js`

```js
// @ts-check
// F3 performance overlay — debug builds only (?debug=1). Frame time, fps, draw
// calls, triangles, live textures/geometries (renderer.info, reset once per
// frame by PostFX so it counts every pass) and the current render scale, so
// adaptive resolution can be watched doing its job.

const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

/**
 * @param {{avgMs:number, fps:number, calls:number, triangles:number, textures:number,
 *   geometries:number, scale:number, preset:string, adaptive:boolean}} s
 */
export function formatPerf(s) {
  return [
    `${s.avgMs.toFixed(1)} ms  ${s.fps} fps`,
    `${s.calls} draws  ${compact(s.triangles)} tris`,
    `${s.textures} tex  ${s.geometries} geo`,
    `scale ${s.scale.toFixed(2)}  ${s.preset}${s.adaptive ? ' · adaptive' : ''}`,
  ].join('\n');
}

export class PerfOverlay {
  /**
   * @param {{renderer: import('three').WebGLRenderer, loop: import('../core/loop.js').Loop,
   *   quality: import('../scene3d/renderQuality.js').RenderQuality, stage: import('../scene3d/stage.js').Stage}} deps
   */
  constructor({ renderer, loop, quality, stage }) {
    this.renderer = renderer;
    this.loop = loop;
    this.quality = quality;
    this.stage = stage;
    this.el = document.createElement('div');
    this.el.id = 'perf-overlay';
    this.el.hidden = true;
    this.el.style.cssText = 'position:fixed;top:8px;left:8px;z-index:9999;padding:6px 8px;'
      + 'background:rgba(4,5,9,0.78);color:#39e6ff;font:11px/1.35 ui-monospace,Consolas,monospace;'
      + 'white-space:pre;pointer-events:none;border:1px solid rgba(57,230,255,0.35)';
    document.body.appendChild(this.el);
    this._last = 0;
  }

  get visible() { return !this.el.hidden; }

  toggle() {
    this.el.hidden = !this.el.hidden;
    this._last = 0;   // draw on the next frame, not up to 250 ms later
  }

  /** Call once per frame, after PostFX.render(); redraws at most 4x a second. */
  update() {
    if (this.el.hidden) return;
    const now = performance.now();
    if (now - this._last < 250) return;
    this._last = now;
    const { avgMs } = this.loop.frameStats();
    const info = this.renderer.info;
    this.el.textContent = formatPerf({
      avgMs, fps: avgMs > 0 ? Math.round(1000 / avgMs) : 0,
      calls: info.render.calls, triangles: info.render.triangles,
      textures: info.memory.textures, geometries: info.memory.geometries,
      scale: this.stage.renderScale, preset: this.quality.level, adaptive: this.quality.settings.adaptive,
    });
  }
}
```

- [ ] **Step 4: App wiring** (`src/core/app.js`)
  - Add `import { PerfOverlay } from '../ui/perfOverlay.js';`.
  - In the constructor, directly after the RenderQuality block (Task 26), add:

```js
    if (this.debug) {
      // F3: frame time / draws / textures / render scale. Debug builds only.
      this.perfOverlay = new PerfOverlay({ renderer: this.stage.renderer, loop: this.loop, quality: this.renderQuality, stage: this.stage });
      document.addEventListener('keydown', (e) => {
        if (e.code !== 'F3') return;
        e.preventDefault();   // F3 is the browser's find-next
        this.perfOverlay.toggle();
      });
    }
```

  - In `render(dt)`, directly after `this.postfx.render(dt);`, add `this.perfOverlay?.update();`.

- [ ] **Step 5: Run the tests**

Run: `node --test test/unit/renderdebug.test.mjs && npm test && npm run lint`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/ui/perfOverlay.js src/core/app.js test/unit/renderdebug.test.mjs
git commit -F - <<'EOF'
feat(debug): F3 performance overlay — ms, fps, draws, tris, textures, render scale

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 29: Smoke tests: every preset, the live switch, the overlay

**Files:**
- Modify: `test/smoke/smoke.spec.mjs`

- [ ] **Step 1: Add the tests** inside the `test.describe` block:

```js
  for (const level of ['low', 'medium', 'high', 'ultra']) {
    test(`boots at quality=${level}: every floor renders, no console errors`, async ({ page }) => {
      const errors = await bootToRun(page, `${URL}&quality=${level}`);
      expect(await page.evaluate(() => window.__ncld.app.renderQuality.level)).toBe(level);
      for (const f of ['rooftop', 'fl40', 'fl27', 'fl12', 'ground', 'basement', 'penthouse']) {
        const meshes = await page.evaluate(async (floor) => {
          window.__ncld.app.setFloor(floor);
          await new Promise((r) => setTimeout(r, 300));
          let n = 0;
          window.__ncld.app.stage.scene.traverseVisible((o) => { if (o.isMesh) n++; });
          return n;
        }, f);
        expect(meshes, `${level}: ${f} should render geometry`).toBeGreaterThan(20);
      }
      await page.waitForTimeout(1000);   // a few frames on the last floor, at this preset's shaders
      expect(errors, `console errors at quality=${level}:\n${errors.join('\n')}`).toEqual([]);
    });
  }

  test('the Settings quality switch applies live, without a reload', async ({ page }) => {
    // answer the config write so the test never rewrites config/render.yaml on disk
    await page.route('**/api/config/**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '{"ok":true,"errors":[]}',
    }));
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^Settings$/ }).click();
    const quality = page.getByRole('radiogroup', { name: 'Graphics quality' });

    await quality.getByRole('radio', { name: 'low' }).click();
    await page.waitForFunction(() => window.__ncld.app.renderQuality.settings.shadows === 'off');
    const low = await page.evaluate(() => {
      const a = window.__ncld.app;
      return { shadows: a.stage.renderer.shadowMap.enabled, smaa: a.postfx.smaa.enabled, ao: a.postfx.ao.enabled, scale: a.stage.renderScale, pr: a.stage.renderer.getPixelRatio() };
    });
    expect(low).toMatchObject({ shadows: false, smaa: false, ao: false });
    // low turns adaptive resolution on, and SwiftShader is slow enough that it may already have stepped down
    expect(low.scale).toBeLessThanOrEqual(0.8);

    await quality.getByRole('radio', { name: 'ultra' }).click();
    await page.waitForFunction(() => window.__ncld.app.renderQuality.settings.shadowMapSize === 4096);
    const ultra = await page.evaluate(() => {
      const a = window.__ncld.app;
      return { shadows: a.stage.renderer.shadowMap.enabled, smaa: a.postfx.smaa.enabled, ao: a.postfx.ao.enabled, scale: a.stage.renderScale, pr: a.stage.renderer.getPixelRatio() };
    });
    expect(ultra).toMatchObject({ shadows: true, smaa: true, ao: true, scale: 1 });
    expect(ultra.pr).toBeGreaterThan(low.pr);
    await expect(page.getByRole('radio', { name: 'ultra' })).toHaveAttribute('aria-checked', 'true');
  });

  test('F3 toggles the performance overlay in debug builds', async ({ page }) => {
    await bootToRun(page);
    const overlay = page.locator('#perf-overlay');
    await expect(overlay).toBeHidden();
    await page.keyboard.press('F3');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('fps');
    await expect(overlay).toContainText('draws');
    await page.keyboard.press('F3');
    await expect(overlay).toBeHidden();
  });
```

- [ ] **Step 2: Run the suite**

Run: `npm run test:e2e`
Expected: all green, with 6 more tests than before. If a preset test times out under SwiftShader, raise that test's timeout with `test.setTimeout(150_000)` as its first line. Do not weaken the assertions.

- [ ] **Step 3: Commit**

```bash
git add test/smoke/smoke.spec.mjs
git commit -F - <<'EOF'
test(e2e): every quality preset boots clean; Settings switch applies live; F3 overlay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 30: beta.2 release bookkeeping

**Files:**
- Create: `docs/config/render.md`
- Modify: `package.json`, `CHANGELOG.md`, `README.md`, `AGENTS.md`, `docs/config/README.md`, `docs/systems/scene-audio-ui.md`, `docs/development.md`, `docs/screenshots/*.jpg`

- [ ] **Step 1: Version.** Set `"version"` to `"0.7.0-beta.2"`.

- [ ] **Step 2: CHANGELOG.** Add above beta.1:

```markdown
## [0.7.0-beta.2] — YYYY-MM-DD — Presets

The frame, finished: a full post stack, four quality presets that switch
live, adaptive resolution, and a Settings panel that exposes all of it.

### Added
- **Post stack** — RenderPass → AO → **AO blur** → Bloom → Output → **LUT** →
  **SMAA** → Final. The AO term is now blurred with a depth-aware bilateral
  filter (no more grain, no halo across silhouettes); the generated neon-noir
  `.cube` grades the image after tone-mapping; SMAA catches the post-process
  and alpha edges MSAA never touched; the final pass adds a little chromatic
  aberration at the frame corners.
- **Quality presets** `low | medium | high | ultra` (`render.quality`),
  resolved by a pure `resolveQuality()` into resolution cap + render scale,
  MSAA/SMAA, AO, bloom, grade, shadows, shadow-map size, rain density,
  anisotropy, HDRI resolution and adaptive resolution. `render.overrides`
  replaces single keys. `high` is exactly the pre-0.7 stack plus the new passes.
- **Adaptive resolution** — holds 16.7 ms by stepping the render scale in 0.1
  steps within [0.6, 1.0], after 2 s of sustained over- or under-load; a probe
  up that tips the frame over backs off exponentially, so it never flaps. On
  by default at `low` and `medium`.
- **Settings → Graphics** — the preset (applies live), render scale,
  anti-aliasing mode, adaptive resolution, and overrides for shadows, AO and
  the grade; bloom, grain and FOV as before. Only the MSAA sample count and
  the FOV still say "applies on reload".
- **F3 performance overlay** (debug builds) — frame ms, fps, draw calls,
  triangles, textures, geometries, render scale, preset.
- `?quality=low|medium|high|ultra` for a session-only preset.

### Changed
- `config/render.yaml` is now `quality` + `overrides` + the look. The old
  top-level `shadows`, `shadowMapSize`, `ao.enabled` and `ao.samples` still
  work (read as overrides).
- `renderer.info` resets once per frame, so it counts every pass, not just
  the last full-screen quad.

### Fixed
- "Soft" and "hard" shadows had been identical since three r185 folded
  `PCFSoftShadowMap` into `PCFShadowMap`; softness is now the shadow filter
  radius.
- The AO pass's resolution uniform was overwritten with CSS pixels after the
  composer set it in drawing-buffer pixels (half-resolution kernel rotation at
  DPR 2).
```

- [ ] **Step 3: `docs/config/render.md` (new).** Write the page in the same shape as `docs/config/lighting.md`, covering:
  - the preset table: the four levels × the 13 keys, with exactly the values in `src/scene3d/quality.js`;
  - `overrides` (every key and its allowed values from the schema; "picking a preset clears them");
  - `targetFrameMs` and how adaptive resolution behaves (0.1 steps, [0.6, 1.0], 2 s sustain, dead band 1.05–1.15× target, back-off 10 s doubling to 120 s);
  - the look keys (`ao.*` including `blurRadius`/`blurDepth`, `bloom.*`, `grain.*`, `aberration`, `lut.id`/`lut.intensity`, `hdri.id`, `fov`);
  - the pass order with one line per pass;
  - which settings apply live and which need a reload;
  - `?quality=`;
  - the legacy keys.

  Then link it from `docs/config/README.md`'s group list.

- [ ] **Step 4: Other docs.**
  - `docs/systems/scene-audio-ui.md`: add a `### Post stack & quality` subsection covering:
    - PostFX (the passes, `configure`, `applyLook`, `setLUT`, `msaa` fixed);
    - AOPass/AOBlurPass;
    - Stage (`pixelRatio`, `setResolution`, `setShadowsEnabled`, `info.autoReset`);
    - `RenderQuality` (`apply`, `tick`, the `config.changed` hook, `render.applied`);
    - AdaptiveResolution;
    - PerfOverlay.
  - `docs/development.md`: add F3 and `?quality=` to the debug-flags list.
  - README:
    - In Features, add a bullet: `- **Render quality.** A full post stack (blurred AO, bloom, a neon-noir LUT grade, SMAA, film grain), four quality presets that switch live from Settings, and adaptive resolution that holds 60 fps.`
    - In Controls, add `F3` (debug builds) to the table.
    - Update the test counts.
  - AGENTS.md:
    - version `**0.7.0-beta.2**`, roadmap `(at beta.2)`;
    - add a spine bullet: `- **`src/scene3d/renderQuality.js`** — the only place graphics settings reach the renderer. Settings resolve through `src/scene3d/quality.js` (pure); anything new that depends on quality gets a key in `QUALITY_PRESETS` + the `render.overrides` schema and a setter RenderQuality calls — never a direct cfg() read at render time.`

- [ ] **Step 5: Screenshots.** Run `node tools/screenshots.mjs` and inspect every image. The grade and SMAA change the look of every shot.

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run lint && npm run test:e2e`

```bash
git add package.json CHANGELOG.md README.md AGENTS.md docs/config/render.md docs/config/README.md docs/systems/scene-audio-ui.md docs/development.md docs/screenshots
git commit -F - <<'EOF'
docs: v0.7.0-beta.2 — post stack, quality presets, adaptive resolution, settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---
# Stage rc.1: performance hygiene, docs, screenshots

### Task 31: Correct bounds for skinned meshes, and frustum culling on

**Files:**
- Create: `src/humanoid/cullBounds.js`, `test/unit/cullbounds.test.mjs`
- Modify: `src/humanoid/bodyBuilder.js` (two sites), `src/humanoid/outfitBuilder.js` (one site), `test/smoke/smoke.spec.mjs`

**Interfaces:**
- Produces:
  - `CULL_PAD = 1.35`
  - `skinnedCullSphere(geometry, minRadius = 0, pad = CULL_PAD) → THREE.Sphere` (mesh-local)
  - `enableSkinnedCulling(mesh, height) → mesh` (sets `mesh.boundingSphere` and `frustumCulled = true`)

- [ ] **Step 1: Write the failing test** `test/unit/cullbounds.test.mjs`

```js
// @ts-check
// Skinned-mesh culling. Every body, hair and outfit mesh shipped with
// frustumCulled = false, because three computes a skinned mesh's bounds from
// whatever pose it happens to be in on first use — so every character was
// drawn (and shadow-cast) every frame even when behind the camera or on
// another floor's camera path. A bind-pose sphere, padded for any pose and
// never smaller than the body is tall, is correct for the lifetime of the rig.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { skinnedCullSphere, enableSkinnedCulling, CULL_PAD } from '../../src/humanoid/cullBounds.js';

/** a 1.75 m stand-in body in bind pose, feet at the origin */
const body = () => new THREE.BoxGeometry(0.5, 1.75, 0.3).translate(0, 0.875, 0);

test('the sphere is the bind pose, padded — never smaller than the character is tall', () => {
  const g = body();
  const tall = skinnedCullSphere(g, 1.75);
  assert.equal(tall.radius, 1.75, 'a lying pose swings the head a body-length from the hips');
  assert.deepEqual(tall.center.toArray().map((v) => +v.toFixed(6)), [0, 0.875, 0]);
  const padded = skinnedCullSphere(g, 0);
  g.computeBoundingSphere();
  assert.ok(Math.abs(padded.radius - g.boundingSphere.radius * CULL_PAD) < 1e-9);
});

test('computing the cull sphere never mutates the geometry’s own bounds', () => {
  const g = body();
  g.computeBoundingSphere();
  const r = g.boundingSphere.radius;
  skinnedCullSphere(g, 5);
  assert.equal(g.boundingSphere.radius, r);
});

test('an enabled skinned mesh is culled when out of view and kept when in it', () => {
  const mesh = new THREE.SkinnedMesh(body(), new THREE.MeshBasicMaterial());
  enableSkinnedCulling(mesh, 1.75);
  assert.equal(mesh.frustumCulled, true);
  mesh.position.set(0, 0, -10);
  mesh.updateMatrixWorld(true);
  const cam = new THREE.PerspectiveCamera(55, 1, 0.05, 400);
  const frustum = new THREE.Frustum();
  const see = () => { cam.updateMatrixWorld(true); frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)); return frustum.intersectsObject(mesh); };
  assert.equal(see(), true, 'straight ahead');
  cam.rotation.y = Math.PI;
  assert.equal(see(), false, 'behind the camera');
});

test('no humanoid mesh opts out of culling any more', () => {
  for (const f of ['src/humanoid/bodyBuilder.js', 'src/humanoid/outfitBuilder.js']) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /frustumCulled = false/, f);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/cullbounds.test.mjs`
Expected: FAIL, `Cannot find module …/cullBounds.js`

- [ ] **Step 3: Implement** `src/humanoid/cullBounds.js`

```js
// @ts-check
// Frustum-culling bounds for the procedural skinned meshes (body, hair,
// outfits). three derives a SkinnedMesh's bounding sphere from its CURRENT
// pose the first time it needs one, which for a rig that animates is wrong
// forever after — so every mesh shipped with frustumCulled = false and was
// drawn, and shadow-cast, every frame. The geometry is authored in bind-pose
// space with the mesh at the rig origin (see bodyBuilder.js), so a sphere
// computed once from it — padded for reaches and turns, and never smaller than
// the character is tall so a lying pose stays inside — is correct for the rig's
// whole life, and moves with the actor through matrixWorld.
import * as THREE from 'three';

/** Pose padding over the bind-pose (A-pose) sphere. */
export const CULL_PAD = 1.35;

/**
 * @param {THREE.BufferGeometry} geometry bind-pose geometry
 * @param {number} [minRadius] floor for the radius — the character's height
 * @param {number} [pad]
 * @returns {THREE.Sphere} mesh-local
 */
export function skinnedCullSphere(geometry, minRadius = 0, pad = CULL_PAD) {
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const s = /** @type {THREE.Sphere} */ (geometry.boundingSphere).clone();
  s.radius = Math.max(s.radius * pad, minRadius);
  return s;
}

/**
 * Give a skinned mesh fixed, pose-proof bounds and turn culling on. A non-null
 * `boundingSphere` is never recomputed by three (it only fills a null one).
 * @template {THREE.SkinnedMesh} M
 * @param {M} mesh @param {number} height metres
 * @returns {M}
 */
export function enableSkinnedCulling(mesh, height) {
  mesh.boundingSphere = skinnedCullSphere(mesh.geometry, height);
  mesh.frustumCulled = true;
  return mesh;
}
```

- [ ] **Step 4: Use it.**
  - `src/humanoid/bodyBuilder.js`:
    - Add `import { enableSkinnedCulling } from './cullBounds.js';`.
    - In `buildBody`, replace `mesh.frustumCulled = false; // skinned bounds are wrong when posed; cheap cast anyway` with:

```js
  // bind-pose bounds, padded for any pose (cullBounds.js) — culled like everything else
  enableSkinnedCulling(mesh, persona.body?.height ?? 1.75);
```

    - In `buildHair`, replace `mesh.frustumCulled = false;` with `enableSkinnedCulling(mesh, persona.body?.height ?? 1.75);`.
  - `src/humanoid/outfitBuilder.js`:
    - Add `import { enableSkinnedCulling } from './cullBounds.js';`.
    - In `buildOutfit`, replace `mesh.frustumCulled = false;` with `enableSkinnedCulling(mesh, persona.body?.height ?? 1.75);`.

- [ ] **Step 5: Smoke test.** Add to `test/smoke/smoke.spec.mjs`:

```js
  test('characters are frustum-culled with pose-proof bounds', async ({ page }) => {
    await bootToRun(page);
    const r = await page.evaluate(() => {
      const out = [];
      for (const c of Object.values(window.__ncld.app.cast)) {
        c.actor.root.traverse((o) => {
          if (o.isSkinnedMesh) out.push({ id: c.id, culled: o.frustumCulled, r: o.boundingSphere?.radius ?? 0, h: c.persona?.body?.height ?? 1.75 });
        });
      }
      return out;
    });
    expect(r.length).toBeGreaterThan(3);
    for (const m of r) {
      expect(m.culled, `${m.id}`).toBe(true);
      expect(m.r, `${m.id} bounds`).toBeGreaterThanOrEqual(m.h);
    }
  });
```

- [ ] **Step 6: Run everything**

Run: `node --test test/unit/cullbounds.test.mjs && npm test && npm run lint && npm run test:e2e`
Expected: 4 new tests PASS, and `humanoid.test.mjs` is unchanged and green.

Then serve the game and orbit around the cast in `director` mode, near the edges of the frame, with a character sitting and one lying on the bed. No limb, hair strand or garment may pop out while it is still on screen.

- [ ] **Step 7: Commit**

```bash
git add src/humanoid/cullBounds.js src/humanoid/bodyBuilder.js src/humanoid/outfitBuilder.js test/unit/cullbounds.test.mjs test/smoke/smoke.spec.mjs
git commit -F - <<'EOF'
perf(humanoid): pose-proof bind-pose bounds; frustum culling on for skinned meshes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 32: Merge static furniture per material per floor

**Files:**
- Create: `src/scene3d/tower/staticMerge.js`, `test/unit/staticmerge.test.mjs`
- Modify: `src/scene3d/tower/zoneBuilder.js`, `test/smoke/smoke.spec.mjs`

**Interfaces:**
- Consumes: `mergeGeometries` from `three/addons/utils/BufferGeometryUtils.js` (a Node shim since Task 2); `world.furnitureGroups` (Tasks 14 and 15)
- Produces:
  - `geometrySignature(geometry) → string`
  - `isMergeable(object) → boolean`
  - `planStaticMerge(roots) → Map<key, Mesh[]>`
  - `mergeStatic(floorGroup, roots, merge = mergeGeometries) → { before, after }`
  - `world.mergeStats: Record<floorId, {before, after}>`

- [ ] **Step 1: Write the failing test** `test/unit/staticmerge.test.mjs`

```js
// @ts-check
// Static furniture batching. Non-interactive furniture is hundreds of small
// meshes sharing a handful of library materials; merged per material per
// floor it is a handful of draws. The rules that keep it safe: nothing that is
// named (animated, or found later by name), transparent (needs sorting),
// skinned, instanced, or interactive is touched, and every merged vertex lands
// exactly where its source vertex was in the world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { planStaticMerge, mergeStatic, isMergeable } from '../../src/scene3d/tower/staticMerge.js';

function scene() {
  const floor = new THREE.Group();
  floor.position.x = 400;   // floors live at large X offsets
  const wood = new THREE.MeshStandardMaterial();
  const metal = new THREE.MeshStandardMaterial();
  const a = new THREE.Group(); a.position.set(1, 0, 2); a.rotation.y = 0.5;
  const b = new THREE.Group(); b.position.set(-3, 0, 1);
  const m = (geo, mat, pos) => { const x = new THREE.Mesh(geo, mat); x.position.set(...pos); x.castShadow = x.receiveShadow = true; return x; };
  a.add(m(new THREE.BoxGeometry(1, 1, 1), wood, [0, 0.5, 0]), m(new THREE.BoxGeometry(2, 0.1, 1), wood, [0, 1, 0]), m(new THREE.BoxGeometry(0.2, 1, 0.2), metal, [0.5, 0.5, 0]));
  b.add(m(new THREE.BoxGeometry(1, 1, 1), wood, [0, 0.5, 0]));
  const named = m(new THREE.BoxGeometry(1, 1, 1), wood, [0, 2, 0]); named.name = 'fire_glow';
  const glass = m(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.2 }), [0, 3, 0]);
  b.add(named, glass);
  floor.add(a, b);
  return { floor, roots: [a, b], wood, metal, named, glass };
}

test('eligibility: named, transparent, skinned and instanced meshes are left alone', () => {
  const { named, glass } = scene();
  assert.equal(isMergeable(named), false);
  assert.equal(isMergeable(glass), false);
  assert.equal(isMergeable(new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())), false);
  assert.equal(isMergeable(new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2)), false);
  assert.equal(isMergeable(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())), true);
});

test('the plan groups by material, shadow flags and attribute layout', () => {
  const { roots, wood, metal } = scene();
  const groups = [...planStaticMerge(roots).values()];
  const woodGroup = groups.find((g) => g[0].material === wood);
  assert.equal(woodGroup.length, 3, 'three wood boxes across two furniture pieces');
  assert.equal(groups.find((g) => g[0].material === metal).length, 1);
});

test('mergeStatic: fewer meshes, same vertices, same world positions', () => {
  const { floor, roots, wood, named, glass } = scene();
  floor.updateMatrixWorld(true);
  const src = roots[0].children[1];   // the 2 x 0.1 x 1 shelf
  const probe = new THREE.Vector3().fromBufferAttribute(src.geometry.getAttribute('position'), 0).applyMatrix4(src.matrixWorld);
  const stats = mergeStatic(floor, roots);
  assert.deepEqual(stats, { before: 4, after: 2 }, 'wood 3 → 1, metal stays 1');
  const merged = floor.children.find((o) => o.isMesh && o.material === wood);
  assert.equal(merged.geometry.getAttribute('position').count, 3 * 24);
  assert.equal(merged.castShadow, true);
  floor.updateMatrixWorld(true);
  const pos = merged.geometry.getAttribute('position');
  let found = false;
  for (let i = 0; i < pos.count && !found; i++) {
    found = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(merged.matrixWorld).distanceTo(probe) < 1e-5;
  }
  assert.ok(found, 'a source vertex is at the same world position after merging');
  assert.ok(named.parent && glass.parent, 'ineligible meshes stay where they were');
});

test('a single mesh for a material is left as it is', () => {
  const { floor, roots, metal } = scene();
  mergeStatic(floor, roots);
  const metals = [];
  floor.traverse((o) => { if (o.isMesh && o.material === metal) metals.push(o); });
  assert.equal(metals.length, 1);
  assert.notEqual(metals[0].parent, floor, 'not re-parented for nothing');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/staticmerge.test.mjs`
Expected: FAIL, `Cannot find module …/staticMerge.js`

- [ ] **Step 3: Implement** `src/scene3d/tower/staticMerge.js`

```js
// @ts-check
// Static furniture batching: merge non-interactive furniture meshes per
// material per floor with BufferGeometryUtils.mergeGeometries. The PBR library
// shares materials by name, so a floor's hundreds of couch cushions, shelf
// boards and table legs collapse to a draw or two per surface.
//
// Only what nothing will ever address on its own is merged: unnamed (named
// meshes are animated or looked up later — fire_glow, vinyl_disc, cam_*),
// opaque (transparent needs per-object sorting), not skinned or instanced, and
// only under the roots World3D hands over (non-interactive furniture + prop
// dressing; interactive props clone their materials for hover highlight).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Geometries merge only with identical attribute layouts; mergeGeometries
 * console.errors on a mismatch, and the e2e suite fails on console errors.
 * @param {THREE.BufferGeometry} g
 */
export function geometrySignature(g) {
  const attrs = Object.keys(g.attributes).sort().map((n) => {
    const a = /** @type {THREE.BufferAttribute} */ (g.attributes[n]);
    return `${n}:${a.itemSize}:${a.array?.constructor?.name}:${a.normalized ? 1 : 0}`;
  });
  return `${g.index ? 'i' : 'n'}|${attrs.join(',')}|${Object.keys(g.morphAttributes).length}`;
}

/** @param {THREE.Object3D} o */
export function isMergeable(o) {
  const m = /** @type {any} */ (o);
  if (!m.isMesh || m.isSkinnedMesh || m.isInstancedMesh) return false;
  if (m.name) return false;
  if (!m.material || Array.isArray(m.material) || m.material.transparent) return false;
  if (m.geometry?.isInstancedBufferGeometry) return false;
  if (m.userData?.noMerge) return false;
  return true;
}

/** @param {THREE.Object3D[]} roots @returns {Map<string, THREE.Mesh[]>} */
export function planStaticMerge(roots) {
  /** @type {Map<string, THREE.Mesh[]>} */
  const groups = new Map();
  for (const root of roots) {
    root.traverse((o) => {
      if (!isMergeable(o)) return;
      const m = /** @type {THREE.Mesh} */ (o);
      const mat = /** @type {THREE.Material} */ (m.material);
      const key = `${mat.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${geometrySignature(m.geometry)}`;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(m);
    });
  }
  return groups;
}

/**
 * @param {THREE.Object3D} floorGroup merged meshes are added here, in its local space
 * @param {THREE.Object3D[]} roots the furniture/dressing roots on this floor
 * @param {(geos: THREE.BufferGeometry[], useGroups?: boolean) => THREE.BufferGeometry|null} [merge]
 * @returns {{before:number, after:number}} eligible mesh count before and after
 */
export function mergeStatic(floorGroup, roots, merge = mergeGeometries) {
  floorGroup.updateMatrixWorld(true);
  const toFloor = new THREE.Matrix4().copy(floorGroup.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  let before = 0;
  let after = 0;
  for (const meshes of planStaticMerge(roots).values()) {
    before += meshes.length;
    if (meshes.length < 2) { after += meshes.length; continue; }
    const geos = meshes.map((m) => m.geometry.clone().applyMatrix4(rel.multiplyMatrices(toFloor, m.matrixWorld)));
    const merged = merge(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) { after += meshes.length; continue; }
    const out = new THREE.Mesh(merged, meshes[0].material);
    out.castShadow = meshes[0].castShadow;
    out.receiveShadow = meshes[0].receiveShadow;
    out.userData.mergedFrom = meshes.length;
    floorGroup.add(out);
    // sources are detached, not disposed: a geometry could be shared with a named mesh that stays
    for (const m of meshes) m.removeFromParent();
    after += 1;
  }
  return { before, after };
}
```

- [ ] **Step 4: Wire it into the build** (`src/scene3d/tower/zoneBuilder.js`)
  - Add `import { mergeStatic } from './staticMerge.js';`.
  - Add `/** @type {Record<string, {before:number, after:number}>} static batching per floor */ this.mergeStats = {};` to the constructor fields.
  - In `_buildFloor`, directly after `applyWorldUVsTo(group);`, add:

```js
    // Batch this floor's non-interactive furniture per material. AFTER the UV
    // pass (merged geometry keeps its world UVs) and after the colliders were
    // taken (they come from data, not from these meshes).
    this.mergeStats[floor.id] = mergeStatic(group, this.furnitureGroups[floor.id]);
```

- [ ] **Step 5: Smoke test.** Add to `test/smoke/smoke.spec.mjs`:

```js
  test('static furniture is batched per material on every floor', async ({ page }) => {
    const errors = await bootToRun(page);
    const stats = await page.evaluate(() => window.__ncld.app.world.mergeStats);
    expect(Object.keys(stats).length).toBe(7);
    expect(stats.penthouse.after).toBeLessThan(stats.penthouse.before);
    expect(errors).toEqual([]);   // mergeGeometries console.errors on a layout mismatch
  });
```

- [ ] **Step 6: Run everything**

Run: `node --test test/unit/staticmerge.test.mjs && npm test && npm run lint && npm run test:e2e`
Expected: all green. `every floor is reachable and renders` still sees more than 20 meshes per floor, because shells, lights and interactive props are untouched.

Then serve the game with F3 open (`?debug=1`). Compare the penthouse draw count against the same view on the parent commit (`git stash`, or check out the previous commit and reload). Record both numbers for the CHANGELOG in Task 35.

- [ ] **Step 7: Commit**

```bash
git add src/scene3d/tower/staticMerge.js src/scene3d/tower/zoneBuilder.js test/unit/staticmerge.test.mjs test/smoke/smoke.spec.mjs
git commit -F - <<'EOF'
perf(scene): merge non-interactive furniture per material per floor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 33: Texture-memory budget log, and precompile after the PBR build

**Files:**
- Create: `src/assets/budget.js`
- Modify: `src/core/app.js`, `test/unit/renderdebug.test.mjs`

**Interfaces:**
- Produces:
  - `TEXTURE_BUDGET_MB = { low: 256, medium: 384, high: 512, ultra: 1024 }`
  - `textureBytes(tex) → number`
  - `sceneTextures(root) → Texture[]`
  - `sceneTextureBytes(root) → number`
  - `budgetReport(bytes, level) → { mb, budgetMb, over }`
  - One boot log line: `[render] textures ≈ N MB of the B MB <level> budget`

- [ ] **Step 1: Write the failing tests.** Append to `test/unit/renderdebug.test.mjs`:

```js
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { textureBytes, sceneTextures, sceneTextureBytes, budgetReport, TEXTURE_BUDGET_MB } from '../../src/assets/budget.js';

const tex = (w, h, type = THREE.UnsignedByteType, mips = true) => {
  const t = new THREE.DataTexture(null, w, h, THREE.RGBAFormat, type);
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  return t;
};

test('textureBytes: texels × bytes per texel × the mip chain', () => {
  assert.equal(textureBytes(tex(1024, 1024, THREE.UnsignedByteType, false)), 1024 * 1024 * 4);
  assert.equal(textureBytes(tex(1024, 1024)), Math.round(1024 * 1024 * 4 * 4 / 3));
  assert.equal(textureBytes(tex(2048, 1024, THREE.HalfFloatType, false)), 2048 * 1024 * 8, 'the HDRI is half-float RGBA');
  assert.equal(textureBytes(new THREE.Texture()), 0, 'no image yet → nothing on the GPU yet');
});

test('sceneTextures counts a shared texture once, across every material slot', () => {
  const shared = tex(512, 512);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: shared, roughnessMap: tex(256, 256) })));
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: shared, aoMap: shared })));
  assert.equal(sceneTextures(root).length, 2);
  assert.equal(sceneTextureBytes(root), textureBytes(shared) + textureBytes(tex(256, 256)));
});

test('budgetReport per preset', () => {
  assert.deepEqual(Object.keys(TEXTURE_BUDGET_MB), ['low', 'medium', 'high', 'ultra']);
  assert.deepEqual(budgetReport(300 * 1048576, 'low'), { mb: 300, budgetMb: 256, over: true });
  assert.deepEqual(budgetReport(300 * 1048576, 'high'), { mb: 300, budgetMb: 512, over: false });
  assert.equal(budgetReport(1, 'potato').budgetMb, TEXTURE_BUDGET_MB.high);
});

test('startRun precompiles AFTER the PBR world and the HDRI lighting exist', () => {
  // precompile() pays for every floor's shader variants up front; run before
  // the library materials or the HDRI env exist, it compiles the wrong ones
  const src = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');
  const at = (s) => { const i = src.indexOf(s); assert.ok(i >= 0, `${s} not found`); return i; };
  assert.ok(at('World3D.create(') < at('await this.lighting.ready'));
  assert.ok(at('await this.lighting.ready') < at('this.world.precompile('));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/unit/renderdebug.test.mjs`
Expected: FAIL, `Cannot find module …/budget.js`. The precompile-order test already passes: Task 18 put `World3D.create` and `await this.lighting.ready` before the `precompile` call, and this test locks that in.

- [ ] **Step 3: Implement** `src/assets/budget.js`

```js
// @ts-check
// Texture-memory accounting, logged once at boot against the preset's budget,
// so a new asset that quietly doubles VRAM shows up in the console of whoever
// adds it rather than as a crash on someone's 2 GB laptop GPU. An ESTIMATE:
// texels × bytes per texel × the mip chain; drivers pad, and PMREM/render
// targets are not counted (they are sized by the screen, not by assets).
import * as THREE from 'three';

/** Per-preset texture budgets in MB (the preset's target GPU class). */
export const TEXTURE_BUDGET_MB = { low: 256, medium: 384, high: 512, ultra: 1024 };

const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
  'alphaMap', 'bumpMap', 'lightMap', 'sheenColorMap', 'clearcoatNormalMap'];

/** @param {THREE.Texture} tex */
export function textureBytes(tex) {
  const img = /** @type {any} */ (tex?.image);
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!w || !h) return 0;
  const d = img.depth ?? 1;
  const bpp = tex.type === THREE.FloatType ? 16 : tex.type === THREE.HalfFloatType ? 8 : 4;
  const mipmapped = tex.generateMipmaps && tex.minFilter !== THREE.LinearFilter && tex.minFilter !== THREE.NearestFilter;
  return Math.round(w * h * d * bpp * (mipmapped ? 4 / 3 : 1));
}

/** Every distinct texture any material under `root` samples. @param {THREE.Object3D} root */
export function sceneTextures(root) {
  /** @type {Set<THREE.Texture>} */
  const set = new Set();
  root.traverse((o) => {
    const m = /** @type {any} */ (o).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      for (const s of SLOTS) if (mat[s]?.isTexture) set.add(mat[s]);
    }
  });
  return [...set];
}

/** @param {THREE.Object3D} root */
export function sceneTextureBytes(root) {
  return sceneTextures(root).reduce((n, t) => n + textureBytes(t), 0);
}

/** @param {number} bytes @param {string} level */
export function budgetReport(bytes, level) {
  const budgetMb = TEXTURE_BUDGET_MB[/** @type {keyof typeof TEXTURE_BUDGET_MB} */ (level)] ?? TEXTURE_BUDGET_MB.high;
  const mb = Math.round(bytes / 1048576);
  return { mb, budgetMb, over: mb > budgetMb };
}
```

- [ ] **Step 4: Log it** (`src/core/app.js`)
  - Add `import { sceneTextureBytes, budgetReport } from '../assets/budget.js';`.
  - In `startRun()`, directly after `this.world.precompile(this.stage.renderer, this.stage.camera);`, add:

```js
    // every floor is built, so every material's textures are known: log them against the preset
    {
      const level = this.renderQuality.level;
      const b = budgetReport(sceneTextureBytes(this.stage.scene), level);
      (b.over ? console.warn : console.info)(`[render] textures ≈ ${b.mb} MB of the ${b.budgetMb} MB ${level} budget`);
    }
```

- [ ] **Step 5: Run everything**

Run: `node --test test/unit/renderdebug.test.mjs && npm test && npm run lint && npm run test:e2e`
Expected: all green. In a manual boot, the console shows one `[render] textures ≈ …` line.

- [ ] **Step 6: Commit**

```bash
git add src/assets/budget.js src/core/app.js test/unit/renderdebug.test.mjs
git commit -F - <<'EOF'
perf(render): log texture memory against the preset's budget at boot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 34: The perf-sample tool and screenshots at a preset

**Files:**
- Create: `tools/perf-sample.mjs`
- Modify: `tools/screenshots.mjs`

**Interfaces:**
- Produces:
  - `node tools/perf-sample.mjs [levels…]`, which prints a markdown table (preset, fps, ms, draws, triangles) plus a GPU/CPU line
  - `node tools/screenshots.mjs --quality <level>`

- [ ] **Step 1: Create** `tools/perf-sample.mjs`

```js
// @ts-check
// Measure frame cost per quality preset on THIS machine's GPU — the numbers in
// the CHANGELOG's perf table. DEV-TIME ONLY: needs @playwright/test and a
// running server (node tools/serve.mjs 8420).
//
//   node tools/perf-sample.mjs              # all four presets at 1920x1080
//   node tools/perf-sample.mjs high ultra   # just these
//
// Unlike the e2e suite this runs HEADED on the real GPU (no SwiftShader), with
// vsync and the frame-rate limiter off, so the number is what a frame costs
// rather than the monitor's refresh rate. Adaptive resolution is forced OFF
// for the sample — otherwise it would "fix" the very number being measured.
import { chromium } from '@playwright/test';
import os from 'node:os';

const BASE = process.env.NCLD_URL || 'http://localhost:8420/?debug=1';
const LEVELS = ['low', 'medium', 'high', 'ultra'];
const ANGLE = { win32: 'd3d11', darwin: 'metal' }[process.platform] ?? 'gl';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {import('@playwright/test').Browser} browser @param {string} level */
async function sample(browser, level) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  // a sample must never rewrite config/render.yaml
  await page.route('**/api/config/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"errors":[]}' }));
  try {
    await page.goto(`${BASE}&quality=${level}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /New Run/i }).click();
    const begin = page.getByRole('button', { name: /^(Begin|Start|Enter the tower|Start run)/i }).first();
    if (await begin.isVisible().catch(() => false)) await begin.click();
    await page.waitForFunction(() => window.__ncld?.app?.mode === 'run', null, { timeout: 60000 });
    // same settle loop as the smoke suite: skip the opening cutscene
    for (let i = 0; i < 90; i++) {
      const s = await page.evaluate(() => {
        const a = window.__ncld.app;
        return { settled: a.scenarioSettled === true, playing: a.cutscene?.playing === true, paused: a.loop.paused };
      });
      if (s.settled && !s.playing && !s.paused) break;
      if (s.playing) await page.keyboard.press('Escape');
      await sleep(500);
    }
    await page.evaluate(async () => {
      const { applyConfig } = await import('/src/core/config.js');
      applyConfig('render', { overrides: { adaptive: false } });
      window.__ncld.app.scheduler.hold = true;          // no world event mid-sample
      window.__ncld.app.cameraRig.setMode('auto');      // the default framing
    });
    await sleep(5000);   // shaders compiled, caches warm
    await page.evaluate(() => window.__ncld.app.loop.resetFrameStats());
    await sleep(3000);   // the loop keeps the last 120 frames
    return await page.evaluate(() => {
      const a = window.__ncld.app;
      const { avgMs, count } = a.loop.frameStats();
      const info = a.stage.renderer.info;
      const gl = a.stage.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        ms: avgMs, fps: Math.round(1000 / avgMs), frames: count,
        draws: info.render.calls, tris: info.render.triangles,
        gpu: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      };
    });
  } finally {
    await ctx.close();
  }
}

async function main() {
  const wanted = process.argv.slice(2);
  const levels = wanted.length ? LEVELS.filter((l) => wanted.includes(l)) : LEVELS;
  if (!levels.length) throw new Error(`unknown preset(s): ${wanted.join(', ')} — use ${LEVELS.join(' | ')}`);
  const res = await fetch(BASE).catch(() => null);
  if (!res?.ok) throw new Error(`no server at ${BASE} — start one with: node tools/serve.mjs 8420`);
  const browser = await chromium.launch({
    headless: false,
    args: [`--use-angle=${ANGLE}`, '--disable-gpu-vsync', '--disable-frame-rate-limit'],
  });
  const rows = [];
  try {
    for (const level of levels) {
      process.stdout.write(`${level}… `);
      const r = await sample(browser, level);
      console.log(`${r.fps} fps (${r.ms.toFixed(2)} ms over ${r.frames} frames)`);
      rows.push({ level, ...r });
    }
  } finally {
    await browser.close();
  }
  console.log('\n| Preset | fps | ms / frame | Draw calls | Triangles |');
  console.log('|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.level} | ${r.fps} | ${r.ms.toFixed(2)} | ${r.draws} | ${r.tris.toLocaleString('en')} |`);
  console.log(`\n1920×1080 · ${rows[0]?.gpu ?? 'unknown GPU'} · ${os.cpus()[0]?.model?.trim() ?? 'unknown CPU'} · adaptive off · vsync off`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
```

- [ ] **Step 2: `--quality` for the screenshot tool.** In `tools/screenshots.mjs`:
  - Change `async function boot(page, to) {` to `async function boot(page, to, url = URL) {`, and inside it change `await page.goto(URL, …)` to `await page.goto(url, …)`.
  - Change `async function capture(browser, shot, outDir = OUT) {` to `async function capture(browser, shot, outDir = OUT, url = URL) {`, and inside it change `await boot(page, shot.boot || 'run');` to `await boot(page, shot.boot || 'run', url);`.
  - In `main()`, replace the Task 9 `--out` parsing block (from `const outAt = args.indexOf('--out');` through the `if (unknown.length) throw …` line) with:

```js
  // `--flag value` pairs: --out <dir> (e.g. the v0.6 "before" set), --quality <preset>
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const outDir = flag('--out') ?? OUT;
  const quality = flag('--quality');
  if (quality && !['low', 'medium', 'high', 'ultra'].includes(quality)) throw new Error(`--quality must be low|medium|high|ultra, not "${quality}"`);
  const url = quality ? `${URL}&quality=${quality}` : URL;
  const valued = new Set(['--out', '--quality']);
  const names = args.filter((a, i) => !valued.has(a) && !valued.has(args[i - 1]));
  const wanted = names.length
    ? SHOTS.filter((s) => names.includes(s.name) || names.includes(s.file))
    : SHOTS;
  const unknown = names.filter((a) => !SHOTS.some((s) => s.name === a || s.file === a));
  if (unknown.length) throw new Error(`unknown shot(s): ${unknown.join(', ')} — try --list`);
```

  - Change the capture call to `try { await capture(browser, shot, outDir, url); }`.
  - Add this line to the usage comment:

```js
//   node tools/screenshots.mjs --quality high   # at a quality preset (?quality=)
```

- [ ] **Step 3: Check the tools run**

Run: `node tools/screenshots.mjs --list`
Expected: the shot list, including `bar`, `rooftop` and `exterior`.

Then, with the server running, run `node tools/perf-sample.mjs low`.
Expected: a headed Chromium window opens, the run boots, and one table row plus the GPU line print. If the GPU line names SwiftShader, the machine fell back to software. Re-run on the dev machine's desktop session, not over RDP.

- [ ] **Step 4: Commit**

```bash
git add tools/perf-sample.mjs tools/screenshots.mjs
git commit -F - <<'EOF'
feat(tools): perf-sample (fps per preset on the real GPU) + screenshots --quality

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 35: rc.1 release bookkeeping: before/after pairs, perf table, docs

**Files:**
- Modify: `package.json`, `CHANGELOG.md`, `README.md`, `AGENTS.md`, `docs/README.md`, `docs/development.md`, `docs/systems/scene-audio-ui.md`, `docs/engine-overview.md`, `docs/screenshots/*.jpg`

- [ ] **Step 1: Version.** Set `"version"` to `"0.7.0-rc.1"`.

- [ ] **Step 2: Measure.**
  - With the server running on the dev machine, run `node tools/perf-sample.mjs` and keep the printed table and GPU line.
  - Take the penthouse draw-call before/after numbers recorded in Task 32 Step 6.
  - Re-capture every shot at `high`: `node tools/screenshots.mjs --quality high`.
  - Open every image, including the new `14-bar`, `15-rooftop` and `16-exterior`, and compare each with its `docs/screenshots/v0.6/` counterpart.

- [ ] **Step 3: CHANGELOG.** Add above beta.2. Paste the tool's table and GPU line where shown, and the two draw-call numbers from Task 32.

```markdown
## [0.7.0-rc.1] — YYYY-MM-DD — Glass and neon

The release candidate for 0.7 (sub-project 2 of 7: asset pipeline + render
quality). This pass makes the new look cheap enough to keep, and documents
all of it.

### Changed
- **Characters are frustum-culled.** Every body, hair and outfit mesh shipped
  with culling off (three computes skinned bounds from whatever pose it first
  sees). They now carry a bind-pose sphere, padded for any pose and never
  smaller than the character is tall.
- **Static furniture is batched** per material per floor
  (`BufferGeometryUtils.mergeGeometries`) — penthouse draw calls <before> → <after>.
  Interactive props, anything named or animated, and transparent surfaces are
  untouched.
- Boot logs texture memory against the preset's budget
  (`[render] textures ≈ N MB of the B MB <preset> budget`).
- README screenshots re-captured at `high`, with before/after pairs for the
  lounge, the bar, the rooftop and the view outside.

### Performance
<the table printed by `node tools/perf-sample.mjs`>

<the GPU / CPU line it printed>. Adaptive resolution off, vsync off, the
default auto-camera in the penthouse after the opening beat.

### Added
- `tools/perf-sample.mjs` (the table above) and `--quality` for
  `tools/screenshots.mjs`.
```

- [ ] **Step 4: README.**
  - Directly under the existing `## Screenshots` table, add:

```markdown
### v0.6 → v0.7

The same views before and after the asset pipeline and render pass (`high` preset).

<table>
  <tr><th width="50%">v0.6</th><th width="50%">v0.7</th></tr>
  <tr>
    <td><img src="docs/screenshots/v0.6/03-penthouse-lounge.jpg" alt="Penthouse lounge in v0.6"></td>
    <td><img src="docs/screenshots/03-penthouse-lounge.jpg" alt="Penthouse lounge in v0.7"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/v0.6/14-bar.jpg" alt="The bar in v0.6"></td>
    <td><img src="docs/screenshots/14-bar.jpg" alt="The bar in v0.7: marble, wood and metal PBR"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/v0.6/15-rooftop.jpg" alt="The rooftop in v0.6"></td>
    <td><img src="docs/screenshots/15-rooftop.jpg" alt="The rooftop in v0.7"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/v0.6/16-exterior.jpg" alt="The view outside in v0.6"></td>
    <td><img src="docs/screenshots/16-exterior.jpg" alt="The view outside in v0.7: HDRI skyline, rain on the glass"></td>
  </tr>
</table>
```

  - Update the `03-penthouse-lounge` caption to `<b>Neon-noir penthouse</b> — PBR surfaces, HDRI reflections, a graded neon-noir frame, and a live city through rain-streaked glass.`
  - Rewrite the intro sentence `Everything here — geometry, textures, music, sound effects, UI — is **procedurally generated or hand-authored**.` as: `Geometry, music, sound effects and UI are **procedurally generated or hand-authored**; surfaces, the skyline and a little clutter come from CC0 scans and models (Poly Haven, Kenney), each with a procedural fallback.`
  - Update the test counts.
  - Roadmap: change item 2 to `2. **Asset pipeline + render quality** (v0.7, at rc.1)`, and the lead-in sentence to name 0.7.
  - Add `node tools/perf-sample.mjs` to the Development command list: `# fps per quality preset on this GPU (headed Chromium, dev)`.

- [ ] **Step 5: AGENTS.md and docs.**
  - AGENTS.md:
    - version `**0.7.0-rc.1**`, roadmap `(at rc.1)`;
    - in `## Conventions`, add: `- Skinned meshes use `enableSkinnedCulling` (src/humanoid/cullBounds.js); never set `frustumCulled = false`. Furniture that must stay addressable after build is interactive (PROP_PROMPTS) or named — everything else is merged per floor.`
  - `docs/systems/scene-audio-ui.md`: add a `### Performance` subsection covering skinned culling, static merging (eligibility rules, `world.mergeStats`), the texture budget log, precompile ordering, and the F3 overlay.
  - `docs/engine-overview.md`: mention the asset facade and RenderQuality in the architecture section, one line each.
  - `docs/development.md`: `perf-sample` usage, and `--quality`/`--out` for screenshots.
  - `docs/README.md`: in the Engine Config line, say that `render` now holds the quality presets.

- [ ] **Step 6: Full verification**

Run:

```bash
npm test
npm run lint
npm run test:e2e
node tools/fetch-assets.mjs --verify
```

Expected: all green, and `ok — 14 entries, NN.NN MB of 40.00 MB`.

Then play it for real (`node tools/serve.mjs 8420`) and fix anything that fails:
- [ ] The boot has no console errors, and one `[render] textures ≈` line appears.
- [ ] Settings → Graphics: each preset applies instantly, and render scale drags smoothly.
- [ ] F3 shows the overlay. At `medium` on a weak window size, the scale moves and settles, and does not flap.
- [ ] Surfaces are PBR, hero furniture edges catch highlights, and clutter sits on its surfaces.
- [ ] The HDRI city is in the window and in reflections. `__ncld.debug.light('blackout_emergency')` dips the reflections, then darkens the city.
- [ ] Rain streaks fall outside, and droplets sit on the glass.
- [ ] `?noassets=1`: the game boots, and the room is canvas-textured with the flat skyline, no grade and no dressing.
- [ ] Walk every floor with the elevator: nothing pops in, and no character vanishes at the frame edge.

- [ ] **Step 7: Commit**

```bash
git add package.json CHANGELOG.md README.md AGENTS.md docs
git commit -F - <<'EOF'
docs: v0.7.0-rc.1 — perf hygiene, before/after screenshots, perf table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

The controller then pushes, tags `v0.7.0-rc.1`, publishes the pre-release, and — after review — merges the PR and releases 0.7.0. This plan does none of that.

---

## Self-review against the spec

| Spec item | Task |
|---|---|
| §1 `tools/vendor-three.mjs`: pinned tarball, listed files + deps, import check, `VENDORED.json` | 1, 2 |
| §1 `tools/fetch-assets.mjs` + `assets/manifest.json` (id/kind/source/urls/license/files/transform; 1K JPEG q82; AO packed; Kenney unzip; sha256; idempotent; `--verify`) | 3, 5, 6 |
| §1 facade: `loadTexture(id,map)`, `loadPBR`, `loadHDRI → PMREM`, `loadGLTF → clone`, `loadLUT`; null + log once; sRGB on albedo only; anisotropy from the preset | 7, 8, 26 |
| §1 per-floor preload, World3D awaits it (no pop-in) | 14 (+15 props, 18 HDRI) |
| §1 `tools/lint-assets.mjs` in `npm run lint` (manifest ↔ sha256, licence, budget) | 3 (+15 prop refs) |
| §2 `pbr.js` with the ten names, hybrid fallback, `furniture.js` `mat.*` names kept | 13, 14 |
| §2 world-scale UVs + unit test | 12, 14 |
| §2 bevelled hero furniture via `box(…, {bevel})`, colliders unchanged | 14 |
| §2 seeded texGen | 11 |
| §3 HDRI IBL through HDRLoader + PMREM; per-preset envIntensity + rotation; sign cards as accents; fallback | 18 |
| §3 skyline: HDRI background sphere behind the instanced towers, graded per preset; emissive windows with per-instance offsets | 19 |
| §3 rain: instanced velocity-aligned streaks (count by preset) + rain-on-glass | 20, 26 |
| §3 0.6 s environment crossfade (dip-and-swap) | 17, 18 |
| §4 pass order RenderPass → AO → AO blur → Bloom → Output → LUT → SMAA → Final (grain + vignette + CA) | 24, 25 |
| §4 `quality: low…ultra` + pure `resolveQuality(preset, overrides)` with every listed key | 22 |
| §4 adaptive resolution (16.7 ms, 0.1 steps in [0.6,1.0], 2 s hysteresis, loop buffer, pure + tested) | 23, 26 |
| §4 Settings GRAPHICS: preset (live), render scale, AA mode, adaptive, overrides; reload notes only for FOV + MSAA | 27 |
| §4 F3 perf overlay (debug) | 28 |
| §5 skinned bounds + `frustumCulled = true` | 31 |
| §5 static merge per material per floor | 32 |
| §5 precompile per floor includes PBR | 14 (order), 33 (test) |
| §5 texture memory budget per preset logged at boot | 33 |
| §6 unit tests: resolveQuality, adaptive, UV math, manifest (schema + sha256), facade null fallback, vendored imports, seeded texGen | 22, 23, 12, 3, 7, 2, 11 |
| §6 e2e: every preset boots clean with every floor rendering; the Settings switch applies live; `?noassets=1` boots | 29, 8 (+14/18/26 assertions) |
| §6 visual: shots at `high`; README before/after for lounge, bar, rooftop, exterior; perf table in the CHANGELOG | 9, 34, 35 |
| §7 staged delivery with CHANGELOG/README/AGENTS/docs at every stage | 10, 16, 21, 30, 35 |

Checks run while writing:
- Every new pure module has complete code and a test that fails first.
- Every modification either names an exact anchor string or gives the replacement code.
- Every commit leaves `npm test` and `npm run lint` green:
  - The render-config keys removed in Task 22 still have their old fallbacks until Task 25.
  - The PostFX interim edit in Task 24 keeps AO composited until the Task 25 rewrite.
- The existing source-guard tests' anchors are preserved:
  - the `bed()`/`vanity_table()` markers, `const PROP_PROMPTS` and `if (PROP_PROMPTS[`;
  - `_collectSolids(group, floor.id)`, now in `_buildFloor`;
  - the `userData.solid = true` tags, which are untouched.
- `floorheight.test.mjs` still builds synchronously through the unchanged constructor path.
