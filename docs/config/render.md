# config/render.yaml

The post-FX stack, shadow quality, and the HDRI behind image-based lighting and the
exterior sky dome. Defaults in `data/configDefaults.js` → `render`, range-checked by
`data/configSchema.js`. These are the same values the in-game Settings screen writes
(`src/ui/settingsPanel.js` → `applyConfig`), so editing here changes the defaults a new
player starts from. Read via `cfg('render.…')`.

Before v0.5 every one of these was hard-coded across `src/scene3d/*`, so a player whose
machine couldn't afford the post-FX stack had no way to turn any of it down.

## Top-level

| Key | Type | Default | Range | Effect |
|-----|------|---------|-------|--------|
| `shadows` | string | `soft` | `off` \| `hard` \| `soft` | `hard` is `PCFShadowMap` — one texel of penumbra, which reads as a jagged stencil at this map size. `soft` is `PCFSoftShadowMap`, the difference between "there is a shadow here" and "this thing is standing on this floor". Turn this down first if the game runs hot. |
| `shadowMapSize` | number | `2048` | 512 \| 1024 \| 2048 \| 4096 | Per-side texels for the key light's shadow map. |
| `fov` | number | `55` | 30–110 | Vertical field of view, degrees. Applies on reload (the camera is built once). |

## `ao` — screen-space ambient occlusion

Contact darkening in creases and where objects meet the floor (`src/scene3d/aoPass.js`).
Without it, a PBR scene under an IBL environment fills every crevice with uniform ambient
and everything reads as a decal sitting ON the floor rather than IN the room. Measured
cost at 1912×961: about 1.5 ms/frame.

| Key | Default | Range | Effect |
|-----|---------|-------|--------|
| `enabled` | `true` | boolean | Toggle the whole pass. |
| `radius` | `0.45` | 0.05–3 | World-space sample radius, metres. |
| `intensity` | `0.9` | 0–2 | 0 = no darkening, 1 = full occlusion in creases (values above 1 push it further). |
| `bias` | `0.025` | 0.001–0.5 | Depth slack, metres — too low and flat surfaces self-occlude (acne). |
| `samples` | `12` | 4–32 | Hemisphere taps per pixel; this is a shader `#define`, so changing it rebuilds the AO shader. |

## `bloom`

LINEAR HDR, applied BEFORE tone-mapping — `threshold` is not a 0..1 brightness. The default
1.55 sits above lit skin and hair and below the neon core (~2.4), so only things that are
actually emissive glow. Lowering it makes the cast's own specular highlights bloom into
blobs on every head.

| Key | Default | Range | Effect |
|-----|---------|-------|--------|
| `strength` | `0.42` | 0–3 | Bloom intensity. |
| `radius` | `0.40` | 0–2 | Bloom spread. |
| `threshold` | `1.55` | 0–8 | Linear-HDR cutoff below which nothing blooms. |

## `grain`

Film grain and vignette, applied after tone-mapping in display colour.

| Key | Default | Range | Effect |
|-----|---------|-------|--------|
| `amount` | `0.055` | 0–0.4 | Grain strength. |
| `vignette` | `0.42` | 0–1.5 | Edge darkening strength. |

## `hdri` — image-based lighting + the exterior sky dome

The HDRI is a photograph in **absolute radiance** (street lamps read ~20000), so it needs
grading before it can light a scene tuned for a procedural sky well under 0.1. The quality
preset picks the resolution (`assets/manifest.json` has `${id}_1k` and `${id}_2k`); the
per-preset `lighting.presets.*.ibl` block (`docs/config/lighting.md`) grades it further —
tint, exposure and rotation — on top of these.

| Key | Default | Range | Effect |
|-----|---------|-------|--------|
| `id` | `shanghai_bund` | string | Which HDRI equirect (Poly Haven, CC0) to load for both the IBL capture and the visible dome. |
| `gain` | `0.14` | 0–2 | Scales the photograph's raw radiance down to the IBL capture's level. Applies on the next environment rebuild. |
| `clamp` | `3.0` | 1.05–20 | Soft-knee cap (knee at 1.0) on each texel's brightest channel — shared by the IBL capture **and** the visible dome, so a lamp core keeps its falloff instead of flattening at a hard cap in one but not the other. Too high: pin-sharp lamps in every eye and flaring skyline lamps. Too low: a flat, grey city. The dome reads this when its shader compiles (reload). |
| `domeGain` | `0.1` | 0–2 | Separate level for the visible exterior dome behind the towers (the IBL capture uses `gain` instead — the dome is seen directly, the capture only lights reflections, so they're tuned independently). |

`src/scene3d/env.js` builds the IBL capture (HDRI or procedural sky, plus the neon sign
cards and warm floor bounce as local accents) and PMREM-prefilters it; the render target is
cached and disposed on rebuild, not leaked. `src/scene3d/materials/skyDome.js` renders the
same equirect directly behind the instanced towers, folded so its skyline half wraps the
circle and its street-level half fades below the horizon (see
`docs/systems/scene-audio-ui.md` → Environment & exterior).

## See also

- `docs/config/lighting.md` — per-preset `ibl` grading (`envIntensity`, `rotation`,
  `skyTint`, `skyExposure`) and the dip-and-swap crossfade.
- `docs/systems/scene-audio-ui.md` — `EnvBuilder`, `Lighting`, the dome, the towers and
  rain, wired together.
