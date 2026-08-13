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

## `envIntensity` — image-based lighting strength

| Key | Default | Range | Meaning |
|-----|---------|-------|---------|
| `envIntensity` | `0.55` | 0–3 | Strength of the procedural environment map (`scene.environmentIntensity`). |

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
