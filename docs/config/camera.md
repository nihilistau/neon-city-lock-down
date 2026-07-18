# config/camera.yaml

Camera tuning: the first/third-person controller (`src/camera/firstPerson.js`), the
situational auto-director (`cameraDirector.js`), and the orbit rig (`cameraRig.js`).
Defaults in `data/configDefaults.js` → `camera`. Read via `cfg('camera.…')`.

## Top-level

| Key | Type | Default | Range | Effect |
|-----|------|---------|-------|--------|
| `eye` | number | 1.62 | 0.8–2.2 | Eye height in metres (first-person camera + TPS pivot base). |
| `radius` | number | 0.26 | 0.1–0.8 | Player body collision radius for wall/furniture push-out. |
| `walkSpeed` | number | 2.6 | 0.5–12 | Walk speed, m/s. |
| `runSpeed` | number | 4.4 | 0.5–16 | Run speed (Shift), m/s. |
| `mouseSensitivity` | number | 0.0019 | 0.0002–0.02 | Base radians of look per mouse pixel (multiplied by the player's `settings.mouseSensitivity`). |
| `pitchClamp` | number | 1.35 | 0.5–1.55 | Max look up/down, radians (≈77°). |
| `lookSmoothing` | number | 30 | 4–120 | Ease rate of the view toward the look target (×dt); higher = snappier. |

## `mouselook` — pointer-lock spike hardening

| Key | Default | Range | Effect |
|-----|---------|-------|--------|
| `maxDelta` | 40 | 5–300 | Per-event px clamp for a fast flick; larger deltas are clamped. |
| `spikeDelta` | 200 | 50–2000 | Per-event px above which the event is **dropped** as an impossible spike (anti spin-out). |
| `settleMs` | 160 | 0–1000 | Ignore mouselook for this long after pointer-lock/focus/blur (swallows the Chromium spike burst). |

## `thirdPerson` — over-the-shoulder framing

| Key | Default | Range | Effect |
|-----|---------|-------|--------|
| `shoulderDist` | 2.7 | 0.5–10 | Camera distance behind the player. |
| `shoulderSide` | 0.85 | 0–3 | Over-the-shoulder side offset (puts the body in one third of the frame). |
| `shoulderUp` | 0.14 | −1–2 | Pivot raise above the eye so the camera clears the head. |

## `aimAssist` — continuous combat magnetism

| Key | Default | Range | Effect |
|-----|---------|-------|--------|
| `strength` | 7.0 | 0–40 | Per-second pull toward the target (fraction of the angular error). |
| `stickDeg` | 22 | 0–90 | Half-angle cone (deg) within which magnetism engages; outside it, aim is free. |
| `softenMs` | 220 | 0–2000 | After a manual mouselook the pull drops to zero and ramps back over this long. |

## `director` — situational auto-camera

| Key | Default | Effect |
|-----|---------|--------|
| `shots.dialogue` / `.action` / `.event` | `{priority, ttl}` = `{3, 4.5}` / `{6, 1e9}` / `{4, 4}` | Priority (higher wins the shot stack) and time-to-live (seconds) per shot type. |
| `easeBase` | 0.0008 | Per-second lerp base for eye/look easing within a shot (`1 − base^dt`). |
| `shakeOnHit` | 0.5 | Handheld shake impulse when the player is hit during action. |
| `shakeDecay` | 0.06 | Shake decay base (`^dt`). |
| `shakeAmp` | 0.06 | Shake amplitude, metres. |
| `establishing.radius/height/speed` | 4.2 / 2.6 / 0.12 | Idle orbit radius (m), eye height (m), angular speed (rad/s) around the cast centroid. |
| `action.eyeY/spanFactor/spanPad` | 2.2 / 0.9 / 1.5 | Combat shot eye height and how the side-on distance scales with the player↔hostile span. |
| `event.eyeY` | 3.1 | Eye height for the brief wide when an event fires. |

## `rig` — orbit (free director) camera

| Key | Default | Effect |
|-----|---------|--------|
| `orbit.damping` | 0.08 | OrbitControls damping factor. |
| `orbit.maxPolar` | 1.6336 | Max polar angle, radians (π×0.52 — just past horizontal). |
| `orbit.minDist` / `maxDist` | 1.2 / 18 | Zoom clamp, metres. |
| `target` | `[-3.5, 1.1, 0]` | Initial orbit target (world XYZ). |
| `initialPos` | `[2.5, 3.2, 5.5]` | Initial camera position (world XYZ). |
