# Camera

One shared `THREE.PerspectiveCamera` whose driver is arbitrated by `cameraRig.mode`.

## Modes (`src/camera/cameraRig.js`)
- **`auto`** — the situational director (`cameraDirector.js`) owns the camera cinematically.
- **`thirdPerson`** — over-the-shoulder follow of the player avatar (FP controller, `thirdPerson=true`).
- **`firstPerson`** — FPS; camera at the avatar's eye, body hidden.
- **`director`** — free `OrbitControls`.
- **`cinematic`** — a cutscene writes `camera.position`/`lookAt` each frame (reserved).

`C` cycles `auto → thirdPerson → firstPerson → director` (auto included when `settings.autoCamera`).
`setMode` enables the right driver, syncs the FP controller to the body when entering FP/TPS (no
teleport), toggles body visibility (hidden only in first person), and emits `camera.mode`.
`attachDirector(deps)` wires the director after cast/combat/playerMarker exist.

## Player controller (`src/camera/firstPerson.js`)
Despite the name it drives **both** first and third person, and owns the player avatar.
- Robust pointer-lock mouselook: rejects NaN, ignores a **settle window** (160 ms) after every
  lock/focus/blur (kills the Chromium spike burst), drops impossible >200px events, clamps the rest,
  and smooths (`_targetYaw/_targetPitch` eased). *This was the fix for the spin-out bug.*
- `update(dt)` moves the body (WASD, camera-relative, walk-rect + AABB collision), faces it to the
  aim direction, plays walk/idle (or the `aim` hold while `aiming`), then places the camera: at the
  eye (FP) or over-the-shoulder (TPS). The TPS shot pivots at head height (`SHOULDER_UP`) and offsets
  behind + to one side (`SHOULDER_DIST` 2.7, `SHOULDER_SIDE` 0.85) so the body sits in one third of the
  frame while the camera still looks straight down the aim yaw — the centre reticle and the fire
  raycast stay aligned. `_camDist` pulls the camera in against walls.
- **Hostile aim magnetism** (combat): while `aiming`, `_aimAssist` applies a *continuous* soft pull of
  the aim yaw/pitch toward whichever live hostile is nearest the current aim (`aimTarget()`, wired from
  `app._hostileAimPoints` → all live hostile torso points). The pull engages **only inside a stick
  cone** (`ASSIST_STICK_DEG`, 22°) — aiming at empty space or a different target is never fought — and
  strengthens as the reticle nears the target (`prox = 1 − err/cone`, sticky adhesion). A manual
  mouselook softens it to zero and it ramps back over `ASSIST_SOFTEN_MS` (220 ms), so a deliberate
  flick always wins. `ASSIST_STRENGTH` (7/s) sets the base pull. (These become `config/camera.yaml`
  keys in the config layer.)
- Hooks set by `app.js`: `onInteract` (E), `onFire` (LMB → `combat.fireRay`), `onReload` (R),
  `onAction` (Space). `attachBody(actor)` attaches the player `Actor3D`. `placeAt(x,z,yaw)` seats the
  eye (used by the bed: sitting and lying set the eye height).

## Situational director (`src/camera/cameraDirector.js`)
A bus-driven auto-camera. A **priority shot stack**; the top shot composes an eye+target each frame:
- `establishing` (default) — slow orbit around the present cast centroid.
- `dialogue` (`chat.reply`) — over-shoulder 2-shot of the speaker's head + the guest.
- `action` (`combat.started`→`resolved`) — side-on tracking of player↔nearest hostile, hit shake.
- `event` (`event.fired`) — a brief wide of the room.
Hard-cuts between subjects, eases within a shot. Stands down during the stay-the-night fade
(`bedscene.started` → `bedscene.ended`), when the first-person bed view owns the camera. Only
ticks in `auto` mode; any manual mode (C / mouse / WASD) takes over instantly.

## Cutscenes (`src/cutscene/player.js`)
`CutscenePlayer.play(steps)` pauses the sim, enters `cinematic`, runs a `ScriptRunner` DSL
(`shot`, `line`, `titleCard`, `light`, `anim`, `face`, `look`, `teleport`, `wait`), then restores the
prior mode. `_shot` is an eased two-point dolly with a live or fixed look target. Space skips.
