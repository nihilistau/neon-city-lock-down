# config/lighting.yaml

Named lighting presets + time-of-day keyframes for the scene light kit
(`src/scene3d/lighting.js`). Defaults in `data/lightingPresets.js` (referenced by
`data/configDefaults.js` → `lighting`). `Lighting.apply(presetId, fade)` reads the live
values via `cfg('lighting.presets')`, so edits hot-reload. Retint the entire game here.

## `presets` — map of preset id → light rig

The 10 shipped presets: `neon_night` (default, ToD-aware), `blackout_emergency`,
`golden_hour`, `candlelit`, `dawn_grey`, `storm`, `club_pulse`, `fireplace_warm`,
`security_red`, `morning_haze`. Add your own by adding a key.

Each preset:

| Field | Shape | Meaning |
|-------|-------|---------|
| `hemi` | `{sky, ground, intensity}` | Hemisphere light — sky/ground colors (0xRRGGBB) + intensity. |
| `key` | `{color, intensity, pos:[x,y,z]}` | Directional key light (casts shadows). |
| `warm` | `{color, intensity}` | Warm point light (lounge lamp pool). Intensity in three.js units. |
| `cool` | `{color, intensity}` | Cool wash (ceiling strip). |
| `accent` | `{color, intensity}` | Accent (bar magenta / alarm). |
| `fog` | `{color, density}` | Exponential fog. |
| `exposure` | number | Tone-mapping exposure. |
| `pulse` | `{light, speed, depth?, lightning?}` | Optional animation: which light (`accent`/`warm`/`cool`/`key`) pulses, at `speed`, with `depth` amplitude; `lightning: true` gives storm-style flashes. |

Colors are `0xRRGGBB` integers (YAML parses `0x…` as an int). Values not present fall back
to the baked default, so partial preset edits are safe.

## `ibl` — per-preset HDRI grading

Each preset also carries an `ibl` block (`data/lightingPresets.js`, range-checked by
`data/configSchema.js`) that grades the HDRI environment (`render.hdri`, see
`docs/config/render.md`) for that preset:

| Key | Range | Meaning |
|-----|-------|---------|
| `envIntensity` | 0–3 | This preset's own `scene.environmentIntensity` target — distinct from the top-level `envIntensity` key below, which is the baked default before any preset overrides it. |
| `rotation` | any number, radians | Yaw applied to `scene.environmentRotation.y` — turns the reflected skyline without moving the visible dome. |
| `skyTint` | `0xRRGGBB`, 0–0xffffff | Colour multiplied into the HDRI before it enters the IBL capture and the dome. |
| `skyExposure` | 0–4 | Brightness multiplier alongside `skyTint` — together they're `render.hdri.gain`'s per-preset modifier. |

Example — `blackout_emergency` darkens and reddens the city instead of showing it at full
brightness: `ibl: { envIntensity: 0.15, rotation: 0, skyTint: 0x6a5060, skyExposure: 0.25 }`.
A preset change dips `environmentIntensity` to 0, swaps the prefiltered map, then grades
`skyColor` in with `onSkyGrade` as it fades back in — see `Lighting.apply()` and
`src/scene3d/envMath.js` (`dipAndSwap`, pure and unit-tested).

## `envIntensity` / `hemiScale` — image-based lighting

| Key | Default | Range | Meaning |
|-----|---------|-------|---------|
| `envIntensity` | `0.4` | 0–3 | Strength of the procedural environment map (`scene.environmentIntensity`). |
| `hemiScale` | `0.45` | 0–2 | Multiplier applied to every preset's authored `hemi.intensity`. |

**Why `hemiScale` exists.** All 10 presets were authored *before* there was an environment
map, so their hemisphere light was standing in for all ambient bounce. Now that IBL supplies
real ambient, applying both double-counts it — the penthouse goes flat and beige and loses its
noir contrast. Rather than re-author every preset and throw away their hand-tuned relative
balance, only the pure-ambient term is scaled; `key`, `warm`, `cool` and `accent` are left
exactly as authored. Set `hemiScale: 1` to disable the compensation (and expect a brighter,
flatter room), or lower it further for harder contrast.

`src/scene3d/env.js` builds a small neon-noir environment — gradient sky, horizon city
glow, neon sign cards, warm floor bounce — and PMREM-prefilters it into a reflection probe.
Its palette is derived from **the active preset's own colors**, so retinting a preset also
retints what the room's chrome, glass, skin sheen and hair reflect. One map is built and
cached per preset on first use.

This is what makes `MeshPhysicalMaterial`'s sheen (skin), clearcoat + anisotropy (hair) and
every `metalness > 0` surface read as material rather than plastic — those are reflection
lobes and need something to reflect.

Set `0` to disable reflections entirely (cheapest, flattest). Above `1` the reflections start
to overpower the authored key/fill balance.

## `tod` — time-of-day keyframes

An array of keyframes (ascending `t` over `dayFraction`, 0 = midnight … 1 = midnight) that
modulate the **key light color/intensity, hemisphere, and exposure** while the active preset
is `neon_night`:

| Field | Meaning |
|-------|---------|
| `t` | Day fraction 0..1 (must ascend). |
| `key.color` / `key.i` | Key light color + intensity at this time. |
| `hemi` | Hemisphere intensity multiplier. |
| `exp` | Exposure multiplier. |

The defaults sweep cold night → warm dawn → bright midday → dusk → night.
