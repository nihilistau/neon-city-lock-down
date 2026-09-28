# Sub-project #2 — Asset pipeline + render quality (v0.7.0 "Glass and neon")

Date: 2026-09-27 · Branch: `overhaul/v0.7` (from master after v0.6.0) · Status: design (user pre-authorized continuation)

## Context

Sub-project 2 of 7:

1. content cleanse (done, v0.6)
2. **asset pipeline + render quality**
3. GLTF characters
4. survival loop
5. combat & stealth
6. story
7. UI polish

The asset path is **hybrid**. The no-build, procedural engine stays. Real assets are loaded where they exist, and the procedural versions remain the fallback.

The user approved these downloads:
- three@0.185.0 addons
- Poly Haven CC0 HDRIs and PBR textures
- CC0 GLTF props (Kenney)

Blender is **not** installed, so no step may depend on it. Quaternius packs are itch.io-gated and deferred to #3.

**Today's gaps**, from the render audit:
- The world is untextured-looking boxes with 128–256² canvas textures (albedo plus a Sobel normal map).
- IBL is a runtime sign-card PMREM, and the background is flat.
- The skyline is a single billboard.
- AO has no blur.
- There is no post-MSAA AA, no colour grade, and no quality presets, render scale or adaptive resolution.
- `frustumCulled = false` on every skinned mesh.
- There is no GLTF/HDR/KTX2 loader.

**Goal:** make the tower look like a AAA neon-noir interior at 60 fps on a mid-range GPU, and put in the asset plumbing that #3 builds characters on.

**Non-goals:**
- Characters and animation (#3).
- WebGPU/TSL migration.
- Baked lightmaps (no Blender).
- CSM (the interiors are small, and one directional key with a tight frustum is enough).

## Decisions (rulings; user pre-authorized)

| Decision | Choice | Why | Cost if wrong |
|---|---|---|---|
| Asset storage | Commit assets to the repo, with a **40 MB budget** enforced by a test | Keeps the "clone && serve" zero-dependency promise; no LFS or setup step | Repo grows about 30 MB; can move to LFS later |
| Texture format | 1K JPEG, resized with `sharp` (already a devDependency); **no KTX2** in 0.7 | KTX2 needs `toktx`/`basisu` binaries, which aren't installed; JPEG at 1K is fine for the interior scale | More VRAM than KTX2; revisit in #7 |
| IBL | One 2K HDRI (`shanghai_bund`) through the vendored **HDRLoader** + PMREM, one per lighting preset family; the runtime sign-card env stays as the fallback and for tinting | Real night-city reflections; the HDR also serves as the far skyline | ~6 MB of repo |
| AO | Keep the custom `aoPass.js`; add a **depth-aware bilateral blur** pass | Its no-MRT design rationale still holds; noise is the only problem | — |
| AA | **SMAA** after OutputPass, on medium and above; MSAA stays on the HDR target | MSAA can't catch post-process or alpha edges; SMAA is cheap | One more pass |
| Grade | **LUTPass** with a generated `.cube` (neon-noir LUT authored by a node tool), plus mild chromatic aberration and vignette in the existing final shader | A signature look without art tools | — |
| Props | Kenney **Furniture Kit** + **City Kit Industrial** GLBs, used selectively for clutter and small props, re-skinned to PBR materials; hero furniture stays procedural but gets PBR materials and bevelled geometry | The Kenney style is chunky, so it's used only where it reads as detail | Visual style mismatch; each prop is opt-in in data |

## 1. Asset pipeline

- **`tools/vendor-three.mjs`**
  - Downloads the `three@0.185.0` npm tarball (pinned) and extracts the listed `examples/jsm` files into `vendor/three/addons/`, keeping their relative paths.
  - Checks every file's relative imports are also vendored (fails otherwise) and writes `vendor/three/addons/VENDORED.json` (file, bytes, sha256).
  - Files:
    - `loaders/GLTFLoader.js`, `loaders/DRACOLoader.js`, `loaders/HDRLoader.js`, `loaders/LUTCubeLoader.js`
    - `utils/BufferGeometryUtils.js`, `utils/SkeletonUtils.js`
    - `libs/meshopt_decoder.module.js`, `libs/draco/gltf/*`
    - `postprocessing/SMAAPass.js` + `shaders/SMAAShader.js`
    - `postprocessing/LUTPass.js`
    - `geometries/RoundedBoxGeometry.js`
    - plus the dependencies of all of these
  - The import map already maps `three/addons/` to `vendor/three/addons/`.
- **`tools/fetch-assets.mjs`**, driven by **`assets/manifest.json`**
  - Each manifest entry has `{id, kind: hdri|pbr|gltf|lut, source, url(s), license: "CC0", files: [{path, sha256, bytes}], transform}`.
  - The tool downloads the sources, applies transforms (sharp resize to 1K, JPEG q82, pack AO into a single channel where possible; unzip and pick GLBs from the Kenney zips), writes to `assets/{hdri,pbr/<id>,props/<pack>,luts}/`, and records the sha256.
  - It is idempotent: sha256 is checked before download, and `--verify` checks without downloading.
- **`src/assets/assets.js`**: a single loader facade with a cache.
  - `loadTexture(id, map)`, `loadPBR(id) → {map, normalMap, roughnessMap, aoMap, metalnessMap}` (sRGB on albedo only, anisotropy from the preset), `loadHDRI(id) → PMREM texture`, `loadGLTF(id) → scene clone`, `loadLUT(id)`.
  - Every loader resolves to `null` on failure and logs once. Callers must fall back to procedural; nothing blocks boot.
  - Loading is preloaded per floor, and `World3D` awaits the preload before building a floor so there's no pop-in.
- **`tools/lint-assets.mjs`** (also run from `npm run lint`): the manifest matches the files on disk (sha256), every file has a license, and the total is within budget.

## 2. Materials and geometry

- **`src/scene3d/materials/pbr.js`**: the named material library the furniture and shells use. The existing names in `furniture.js` `mat.*` are kept.
  - `concrete`, `concreteFloor`, `metal`, `metalDark`, `tile`, `marble`, `wood`, `fabric`, `bedding`, `rust`.
  - Each is a `MeshStandardMaterial` built from a PBR set when one is loaded, or from `texGen.js` otherwise (hybrid fallback).
- **World-scale UVs**: the `box()` helper gets UVs scaled to real size (1 texture repeat per N metres per material), so a 2.4 m counter and a 0.3 m shelf share the same texel density. The unit test covers the UV math.
- **Bevelled hero furniture**: `RoundedBoxGeometry` replaces `BoxGeometry` for the visible hero pieces (couch, counters, bed, tables) through a `box(..., {bevel})` option. Colliders are unchanged.
- **texGen determinism**: replace `Math.random()` with a seeded stream so procedural textures are stable between runs (screenshots and tests).

## 3. Lighting, environment, exterior

- **HDRI IBL**
  - `env.js` loads `shanghai_bund` (2K) through `assets.loadHDRI`, then PMREMs it.
  - Lighting presets choose `envIntensity` and a rotation, and the sign cards are still composited as local accents.
  - Fallback: the current runtime env.
- **Skyline**
  - The billboard plane is replaced by the HDRI rendered as a background sphere behind the exterior instanced towers.
  - The tint and exposure are graded per preset (e.g. `blackout_emergency` darkens it).
  - The instanced towers get emissive window textures with per-instance random offsets, so the windows don't repeat.
- **Rain**
  - `Points` are replaced by instanced velocity-aligned streak quads (count set by the preset).
  - A **rain-on-glass** shader effect is added on the curtain-wall panes: animated droplet normal plus a refraction offset, applied when it's raining.
- **Env transitions**: the hard cut between environment maps becomes a 0.6 s crossfade via `scene.environmentIntensity` dip-and-swap.

## 4. Post stack and quality presets

- The pass order becomes:
  1. RenderPass (HDR, MSAA 4× / 2× / off by preset)
  2. AO
  3. **AO blur**
  4. Bloom
  5. OutputPass
  6. **LUTPass**
  7. **SMAA**
  8. Final (grain + vignette + chromatic aberration)
- **Presets** in `config/render.yaml` `quality: low|medium|high|ultra`, resolved by a pure `resolveQuality(preset, overrides)` that returns a full settings object. The settings are:
  - `pixelRatioCap`, `renderScale`
  - `msaa`, `smaa`
  - `ao` (on/off, samples)
  - `bloom`, `lut`
  - `shadows`, `shadowMapSize`
  - `rain` (density), `anisotropy`
  - `hdri` (resolution)
  - `adaptive` (bool)
- **Adaptive resolution**: when on, a controller keeps a target frame time (16.7 ms). It steps `renderScale` in 0.1 increments within [0.6, 1.0], with hysteresis (sustained 2 s over or under), using the existing `loop` frame-time buffer. This is a pure unit, and it is tested.
- **Settings UI**: the GRAPHICS section of `settingsPanel.js` gets a Quality preset selector (which applies live where possible), render scale, AA mode and adaptive toggle, with individual overrides below. It keeps the existing "reload needed" notes only where they are genuinely required (FOV and MSAA sample count).
- **Performance overlay**: F3 toggles frame ms, fps, draw calls, triangles and textures (from `renderer.info`) and the current render scale. It's debug-only.

## 5. Performance hygiene

- Skinned meshes get correct bounds: compute the bounding sphere from the bind pose times a padding factor, and set `frustumCulled = true`.
- Static furniture is merged per material per floor with `BufferGeometryUtils.mergeGeometries`, where a piece isn't interactive, cutting draw calls.
- Shader precompile per floor stays (from 0.5), and now includes the PBR materials.
- A texture memory budget per preset is logged at boot.

## 6. Testing and verification

- **Unit tests**
  - `resolveQuality` for every preset, and that overrides win.
  - The adaptive-resolution controller: it steps down under sustained load, steps up with headroom, and doesn't flap.
  - The world-scale UV math.
  - The asset manifest (schema, and that sha256 matches the files).
  - The assets facade falls back to `null` on a missing file (Node, with a fake loader).
  - Vendored imports are complete (the `VENDORED.json` check).
  - Seeded texGen is deterministic.
- **Lint**: `tools/lint-assets.mjs` (manifest, licences, budget).
- **E2E**
  - Boots at every quality preset with no console errors, and every floor renders.
  - The settings preset switch applies live.
  - A missing-asset run (via a `?noassets=1` debug flag) boots on procedural fallbacks.
- **Visual**: `tools/screenshots.mjs` re-captures every README shot at `high`. The README gets before/after pairs for the lounge, bar, rooftop and exterior. A perf table (fps per preset, at 1080p, on the dev machine) goes in the CHANGELOG.

## 7. Delivery

- Branch `overhaul/v0.7`, released in stages:
  - **alpha.1**: vendor + asset pipeline + facade.
  - **alpha.2**: PBR materials, UVs and bevels.
  - **beta.1**: HDRI, skyline and rain.
  - **beta.2**: post stack, presets, adaptive resolution and settings UI.
  - **rc.1**: performance hygiene, docs and screenshots.
  - **0.7.0**: merge the PR and publish the GitHub release.
- At each stage: CHANGELOG, README, AGENTS.md and docs updated, the tag pushed, and a GitHub pre-release published. The PR is opened as a draft at alpha.1.
