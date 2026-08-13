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

---

Everything below is read when an avatar is **built** (character spawn, hostile
wave, clothes change), not per frame. Edit and respawn to see a change.

Lengths written as *fraction of height* scale with the persona's `body.height`,
so one value works for 1.63 m Aria and 1.84 m Kai.

## `body` — swept-limb mesh (`src/humanoid/bodyBuilder.js`)

Limbs are rings lofted along the bone path, and the torso→neck→head is one
continuous ring stack. There are no joint spheres: the elbow/knee/shoulder stay
round because the skin weights are smooth, not because a ball is pasted over the
seam.

| Key | Default | Effect |
|-----|---------|--------|
| `radialTrunk` | 20 | Ring segments around the torso/neck/head stack. Dominates vertex count. |
| `radialLimb` | 12 | Ring segments around an arm (legs use `+2`, fingers a fixed 6). |
| `skinBand` | 0.030 | Bone-blend half-width, **fraction of height**. Wider = softer joints but more bleed between bones. |
| `deltoidBlend` | 0.80 | Share of the shoulder shelf driven by the arm bone (the "tri-chain"). 0 shears the arm out of a rigid chest. |
| `gluteBlend` | 0.55 | Same idea for the seat and the thigh bone. |
| `jawBlend` | 0.85 | Share of the chin mass driven by the `jaw` bone. 0 freezes the jaw. |

## `skin` — skin material

Retuned for the procedural environment map (`src/scene3d/env.js`). **Keep
`envMapIntensity` low.** Bloom triggers at 0.86 and nothing on a character should
glow — an over-bright specular on a body reads as a flashing lamp when the head
turns.

| Key | Default | Effect |
|-----|---------|--------|
| `roughness` | 0.62 | Base roughness (a roughness map modulates it). |
| `sheen` | 0.65 | Grazing-angle sheen — the main "skin not plastic" cue. |
| `sheenRoughness` | 0.72 | How tight that sheen band is. |
| `envMapIntensity` | 0.7 | Image-based lighting strength on skin. |
| `subsurface` | 0.55 | Wrap-lighting subsurface strength. **0 disables the shader patch entirely** and falls back to stock three lighting. |
| `subsurfaceWrap` | 0.55 | How far light wraps past the terminator (0 = hard terminator, 1 = fully wrapped). |

## `hair` — strand cards + secondary sway

Hair is generated as strand cards flowing from a crown whorl; front azimuths stop
at the hairline (that's the fringe), the rest fall free. The falling length is
skinned to `hair1`/`hair2`/`hair3`, which the animator springs from root motion.

| Key | Default | Effect |
|-----|---------|--------|
| `strands` | 0 | Strand count **override**. `0` = use the style's own count (short 52 / bob 62 / long 72). |
| `fallScale` | 1 | Multiplier on how far the free length falls. |
| `roughness` | 0.42 | Hair roughness. |
| `envMapIntensity` | 0.65 | Clearcoat and anisotropy are both reflection lobes; raising this double-counts them and blooms the highlight. |
| `stiffness` | 55 | Hair spring constant. Higher = hair snaps back faster. |
| `damping` | 9 | Spring damping. Too low oscillates, too high goes rigid. |
| `sway` | 0.030 | Radians of lag per m/s² of body-space acceleration. |
| `idleSway` | 0.035 | Ambient drift so hair is never dead still, radians. |
| `maxDeg` | 26 | Per-bone rotation clamp. Also what stops a teleport flinging the hair. |

## `eye`

The cornea is the glossiest surface on a character and therefore the first thing
to blow past the bloom threshold once the scene has an environment map.

| Key | Default | Effect |
|-----|---------|--------|
| `roughness` | 0.20 | Eyeball roughness. Below ~0.15 it becomes a mirror and catches neon signs as hard points. |
| `envMapIntensity` | 0.55 | Reflection strength. Aim for a small crisp catchlight, not a lamp. |
| `catchlight` | 0.55 | Alpha of the highlight painted into the iris. The iris is an **unlit** material, so this renders at full value in any room — 1.0 blooms. |

## `face` — canvas rig (`src/humanoid/face.js`)

A 256² canvas on a curved patch with alpha-cut eye holes and real 3D eyeballs
behind it. The patch is displaced into a nose, brow, lips and chin, and its
border fades out *and* tucks into the skull so it stops reading as a painted mask.

| Key | Default | Effect |
|-----|---------|--------|
| `redrawHz` | 15 | Canvas repaint cap. Skipped entirely while the body is hidden (first-person player). |
| `jawOpenDeg` | 14 | `jaw` bone rotation at a fully open mouth. |
| `relief` | 1 | Facial displacement scale. `0` gives the old flat sphere patch. |
| `borderTuck` | 0.014 | How far the patch rim sinks under the skull, fraction of height. Too small and the patch edge shows as a rim; too large and the cheeks flatten. |

## `outfit` — garment shells (`src/humanoid/outfitBuilder.js`)

Garments sample the body's own profile and offset outward, so they cannot clip
the shape they cover. Each is a closed shell — outer surface, inner surface, and
a stitched hem you can see the thickness of.

| Key | Default | Effect |
|-----|---------|--------|
| `clearance` | 0.0055 | Gap between skin and garment, fraction of height. Individual recipes multiply this (a robe uses 3.4×). |
| `thickness` | 0.0032 | Fabric thickness, fraction of height. This is what the hem shows. Clamped to 85% of clearance. |
| `radial` | 18 | Ring segments around a garment. |
| `envMapIntensity` | 0.7 | IBL strength on cloth. |
