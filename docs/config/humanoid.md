# config/humanoid.yaml

Procedural animation tuning for the humanoid rig. Defaults in `data/configDefaults.js` →
`humanoid`. Skeleton **proportion ratios** stay in code (`src/humanoid/skeleton.js`) for rig
stability — only `armAngle` is exposed, and it's applied when a new avatar is built.

## `gait` — walk cycle (`src/humanoid/gait.js`)

| Key | Default | Effect |
|-----|---------|--------|
| `strideLen` | 0.62 | Metres per step at full walk (sets footfall cadence vs. speed). |
| `walkSpeed` | 1.25 | m/s treated as "full walk" — the speed at which amplitudes reach full scale. |
| `thighAmp` | 26 | Thigh swing amplitude, degrees. |
| `shinFlex` | 38 | Knee flex amplitude, degrees. |
| `armAmp` | 13 | Arm swing amplitude, degrees. |
| `hipBob` | 0.028 | Vertical hip bob, metres. |
| `hipDrop` | 0.012 | Baseline hip drop, metres. |
| `hipShift` | 0.014 | Lateral hip sway, metres. |

## `animator`

| Key | Default | Effect |
|-----|---------|--------|
| `crossfade` | 0.3 | Default clip crossfade duration, seconds. |

## `skeleton`

| Key | Default | Effect |
|-----|---------|--------|
| `armAngle` | 42 | A-pose arm angle from vertical, degrees. Read at avatar build time (not live). |
