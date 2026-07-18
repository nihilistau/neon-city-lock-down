# Humanoid Rig

`src/humanoid/` — the procedural, code-built character body: a 34-bone skeleton, skinned body + outfit
meshes, a CanvasTexture face, and a layered animator driven by clips + a procedural gait. No imported
model files; everything is generated from proportions at spawn. Movement/pose commands arrive via the
ActorQueue (see [sim-world-loop.md](./sim-world-loop.md)); this layer exposes the primitives it drives.

## Skeleton (`skeleton.js`)
`BONES` — the 34-bone list, parents before children:
```
root hips spine1 spine2 chest neck head jaw eyeL eyeR breastL breastR
clavL clavR armL armR foreL foreR handL handR
thighL thighR shinL shinR footL footR toeL toeR  hair1 hair2 hair3
```
`BONE_INDEX` (name→index). Bind pose is an **A-pose with identity bone rotations**, so every bone's local
axes are world-aligned at bind — pose data stays intuitive (`.x` tips forward, `.y` twists, `.z` tilts).
- `computeJoints(body: BodyParams) → { name: Vector3 }` — world-space joint positions from proportions
  (`height, shoulderW, hipW, bust, waist, hips, build`). `ARM_ANGLE = 42°`.
- `buildSkeleton(body) → { bones, byName, skeleton, joints }` — parents the bones, calls
  `bones[0].updateMatrixWorld(true)` to resolve the pure bind pose, then constructs the `THREE.Skeleton`
  so its `boneInverses` are the correct **bind-pose** inverses, computed exactly once here.

## Body & outfit (`bodyBuilder.js`, `outfitBuilder.js`)
`buildBody(persona, rig) → SkinnedMesh` and `buildOutfit(persona, rig, recipe) → SkinnedMesh[]` — build
merged, skinned geometry over the shared skeleton (skin weights via `util/geo.js`). Outfit meshes are added
to the actor root and toggled by the wardrobe.

> **Gotcha — the identity bindMatrix rule (real bug, now fixed).** Every SkinnedMesh MUST bind with an
> explicit identity bind matrix: `mesh.bind(skeleton, new THREE.Matrix4())`. If you call `mesh.bind(skeleton)`
> (no matrix), three.js runs `Skeleton.calculateInverses()` on the **live, already-posed** shared skeleton,
> overwriting the correct bind-pose inverses computed in `buildSkeleton`. Because every body/outfit mesh
> shares one skeleton, a single re-bind (e.g. a clothes change spawning a new outfit mesh) then corrupted
> skinning for **every** mesh on that character. Bind with identity; never let `calculateInverses` re-run.

## Face (`face.js`)
`class FaceRig(persona, rig)` — a `CanvasTexture` face (eyes, brows, mouth, blush) mapped to the head.
`setExpression(expr)` blends toward `{mouth, browAngle, browRaise, blush, lids, pupil, …}`; `setTalk(amp)`
drives the mouth from voice amplitude; `update(dt)` eases + blinks. The animator never writes the face —
mood/dialogue/voice do.

## Animator (`animator.js`)
`class Animator(rig, personality)` — single writer to bone transforms, composed as a **layer stack**:
1. **Clip** — crossfaded pose from `getClip()`; `sample(bone, t, quat)` per track, `sampleHips` for root motion.
2. **Gait** — blended in by `min(1, speed/walkSpeed)`.
3. **Additive** — breath (chest/spine) + idle fidget (spine/head) when nearly still.
4. **Gaze** — neck 40% / head 60% toward `gazeTarget`, clamped to a plausible neck cone.

- `play(clipId, fadeSec=0.3)` — crossfade. `lookAt(target)`, `speed` (set by the mover each frame),
  `tempo` (arousal/energy scalar for `tempoScaled` clips).
- **Gotcha:** bones untouched by either clip relax to identity; gait-owned bones only relax when the
  character isn't moving — otherwise a sit pose's legs stayed latched under a torso-only clip (the
  "seated contortion" bug).

## Gait (`gait.js`)
`class Gait` — procedural walk cycle. `advance(dt, speed)` drives `phase` from real root velocity (feet
roughly match ground speed; settles to a rest point on stop). `pose(intensity) → { eulers, hipBobY,
hipShiftX }` — per-bone leg/arm/spine swing scaled by intensity. `walkSpeed = 1.25`, `strideLen = 0.62`.

## Clips (`clips.js`)
Poses/clips are authored as sparse **euler-degree keyframes** per bone (`data/poses/*`) and compiled to
quaternion tracks. `registerClips(defs)` (duplicate id throws), `getClip(id)` (unknown throws).
```
ClipDef { id, duration?, loop?: 'loop'|'hold'|'pingpong', tempoScaled?,
          bones?: { bone:[x,y,z]deg }, tracks?: { bone:[[t,[x,y,z]],…] }, hipsPos?:[[t,[x,y,z]],…] }
```
`class CompiledClip` — `wrap(t)` (loop mode), `sample(bone, t, out)` (smoothstep-eased slerp between keys),
`sampleHips(t, out)`.

## Actor3D (`actor3d.js`)
`class Actor3D(persona)` — the visual+animation body. Owns `root` (Group), `mesh`, `rig`, `face`, `animator`,
plus a traveling accent rim light.
- `faceYaw(yaw)` (body eases, no snap), `snapTo(x, z, yaw?)` (teleport without a gait spike),
  `lookAt(obj)`, `playClip(id, fade?)`, `setTempo(t)`, `setRim(v)`.
- `update(dt)` — derives planar speed for the gait layer, eases body yaw toward `facingTarget`, then ticks
  the animator + face. `dispose()` frees geometry/materials/textures.

## Paired poses (`pairedPoses.js`)
`PAIRED_POSES` — two characters anchored to shared furniture sockets with role clips. `startPairedPose(poseId,
a, b) → accepted` — **gate-checks tiered poses on BOTH participants**, emits `pose.paired`, clears + stages
both queues (sit → clip → mutual look), shares a phase clock. `endPairedPose(a, b)` clears back to autonomy
and emits `pose.unpaired`.

## Geometry helpers (`util/geo.js`)
- `mergeGeometries(geos)` — merges position/normal/uv/skinIndex/skinWeight into one indexed geometry.
- `rigidSkin(geo, boneIndex)` — bind every vertex 100% to one bone.
- `chainSkin(geo, chain, band?, axisFn?)` — blend along a bone chain by a scalar axis (default vertex Y),
  max 2 influences, 50/50 at each boundary.
- `limbGeo/latheGeo/ballGeo` — primitive builders in bind-pose world space.
- `weldGeometry(geo, eps?)` — welds coincident verts + recomputes smooth normals for seamless joints.
  **Gotcha:** the dedupe key now includes the **skin binding** (skinIndex + quantized skinWeight), so two
  coincident verts bound to different bones/weights are never welded into one — welding them used to discard
  one side's weights and pull seam verts toward the wrong bone.
