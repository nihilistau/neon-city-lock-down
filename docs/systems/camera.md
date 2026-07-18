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
  aim direction, plays walk/idle, then places the camera: at the eye (FP) or over-the-shoulder with
  wall push-in (`_camDist`, TPS).
- Hooks set by `app.js`: `onInteract` (E), `onFire` (LMB → `combat.fireRay`), `onReload` (R),
  `onAction` (Space). `attachBody(actor)` attaches the player `Actor3D`. `placeAt(x,z,yaw)` seats the
  eye (used by the bed scene).

## Situational director (`src/camera/cameraDirector.js`)
A bus-driven auto-camera. A **priority shot stack**; the top shot composes an eye+target each frame:
- `establishing` (default) — slow orbit around the present cast centroid.
- `dialogue` (`chat.reply`) — over-shoulder 2-shot of the speaker's head + the guest.
- `action` (`combat.started`→`resolved`) — side-on tracking of player↔nearest hostile, hit shake.
- `event` (`event.fired`) — a brief wide of the room.
Hard-cuts between subjects, eases within a shot. Suspends during the first-person bed scene. Only
ticks in `auto` mode; any manual mode (C / mouse / WASD) takes over instantly.

## Cutscenes (`src/cutscene/player.js`)
`CutscenePlayer.play(steps)` pauses the sim, enters `cinematic`, runs a `ScriptRunner` DSL
(`shot`, `line`, `titleCard`, `light`, `anim`, `face`, `look`, `teleport`, `wait`), then restores the
prior mode. `_shot` is an eased two-point dolly with a live or fixed look target. Space skips.
