// @ts-check
// First-person controls: pointer-lock mouselook + WASD, E interact, SPACE
// context action, shift run. Collision: the active floor's walk-rect union
// (rect edges ARE the walls) + furniture AABB push-out.
//
// Mouselook robustness: Chromium delivers a BURST of enormous movementX/Y
// spikes right after pointer-lock engages or on alt-tab/focus return, and some
// devices emit NaN on the first event — either turns the camera into an
// uncontrollable spin. We (1) reject non-finite values, (2) ignore ALL mousemove
// for a short SETTLE window after every lock/focus/blur (not just one event, as
// the spike arrives as a multi-event burst), (3) drop any single event whose
// delta is physically impossible for a real mouse, (4) clamp the rest, and (5)
// smooth the result.
import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { cfg } from '../core/config.js';
import { on } from '../core/bus.js';

// Tuning is config-backed (config/camera.yaml → data/configDefaults.js). These
// module vars mirror the live config and refresh on load / live edit, so every
// usage site below stays a plain constant read. See docs/config/camera.md.
let EYE, RADIUS, MAX_DELTA, SPIKE_DELTA, SETTLE_MS, SHOULDER_DIST, SHOULDER_SIDE, SHOULDER_UP,
  ASSIST_STRENGTH, ASSIST_STICK_DEG, ASSIST_SOFTEN_MS, MOUSE_SENS, PITCH_CLAMP, LOOK_SMOOTH,
  WALK_SPEED, RUN_SPEED;
function _readCameraConfig() {
  EYE = cfg('camera.eye', 1.62);
  RADIUS = cfg('camera.radius', 0.26);
  MAX_DELTA = cfg('camera.mouselook.maxDelta', 40);
  SPIKE_DELTA = cfg('camera.mouselook.spikeDelta', 200);
  SETTLE_MS = cfg('camera.mouselook.settleMs', 160);
  SHOULDER_DIST = cfg('camera.thirdPerson.shoulderDist', 2.7);
  SHOULDER_SIDE = cfg('camera.thirdPerson.shoulderSide', 0.85);
  SHOULDER_UP = cfg('camera.thirdPerson.shoulderUp', 0.14);
  ASSIST_STRENGTH = cfg('camera.aimAssist.strength', 7.0);
  ASSIST_STICK_DEG = cfg('camera.aimAssist.stickDeg', 22);
  ASSIST_SOFTEN_MS = cfg('camera.aimAssist.softenMs', 220);
  MOUSE_SENS = cfg('camera.mouseSensitivity', 0.0019);
  PITCH_CLAMP = cfg('camera.pitchClamp', 1.35);
  LOOK_SMOOTH = cfg('camera.lookSmoothing', 30);
  WALK_SPEED = cfg('camera.walkSpeed', 2.6);
  RUN_SPEED = cfg('camera.runSpeed', 4.4);
}
_readCameraConfig();
on('config.loaded', _readCameraConfig);
on('config.changed', (e) => { if (!e || e.group === 'camera') _readCameraConfig(); });

// reusable scratch (avoid per-frame allocation)
const _EULER = new THREE.Euler();
const _V1 = new THREE.Vector3();
const _V2 = new THREE.Vector3();
const _V3 = new THREE.Vector3();

export class FirstPersonControls {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} dom
   * @param {{ colliders: THREE.Box3[] }} world
   */
  constructor(camera, dom, world) {
    this.camera = camera;
    this.dom = dom;
    this.world = world;
    this.enabled = false;
    this.yaw = Math.PI;         // face the lounge from spawn
    this.pitch = 0;
    this.pos = new THREE.Vector3(-1, EYE, 2);
    this.keys = new Set();
    /** @type {(() => void)|null} set by picking — fires on E */
    this.onInteract = null;
    /** @type {(() => void)|null} context action — SPACE */
    this.onAction = null;
    /** @type {(() => void)|null} fire weapon — LMB while locked */
    this.onFire = null;
    /** @type {(() => void)|null} reload — R */
    this.onReload = null;
    /** @type {import('../humanoid/actor3d.js').Actor3D|null} player body (third person) */
    this.body = null;
    this.thirdPerson = false;    // over-the-shoulder camera + visible body
    this.aiming = false;         // combat active → hold the two-handed aim stance
    /** @type {(() => THREE.Vector3|null)|null} nearest-hostile aim point during combat */
    this.aimTarget = null;
    this._lastLookMs = 0;        // last real mouselook; auto-track backs off right after
    this._moving = false;

    this._settleUntil = 0;      // ignore mouselook until this timestamp (ms)
    // smoothed look target (raw deltas write these; update() eases toward them)
    this._targetYaw = this.yaw;
    this._targetPitch = this.pitch;

    this._onMouse = (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      let mx = e.movementX, my = e.movementY;
      if (!Number.isFinite(mx) || !Number.isFinite(my)) return;      // NaN poisons yaw
      if (performance.now() < this._settleUntil) return;             // swallow the lock/focus spike BURST
      if (Math.abs(mx) > SPIKE_DELTA || Math.abs(my) > SPIKE_DELTA) return; // impossible jump → drop
      mx = THREE.MathUtils.clamp(mx, -MAX_DELTA, MAX_DELTA);
      my = THREE.MathUtils.clamp(my, -MAX_DELTA, MAX_DELTA);
      const sens = MOUSE_SENS * (settings.mouseSensitivity ?? 1);
      this._targetYaw -= mx * sens;
      this._targetPitch = THREE.MathUtils.clamp(this._targetPitch - my * sens, -PITCH_CLAMP, PITCH_CLAMP);
      this._lastLookMs = performance.now();   // player is aiming → suspend auto-track
    };
    this._settle = () => { this._settleUntil = performance.now() + SETTLE_MS; };
    this._onLockChange = () => {
      // any lock transition (engage OR release) precedes a movement spike
      this._settle();
      // lock lost (Esc, alt-tab): drop held keys so movement can't run away
      if (document.pointerLockElement !== this.dom) this.keys.clear();
    };
    this._onFocus = () => this._settle();     // alt-tab back can retain lock + a queued spike
    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE' && this.onInteract) this.onInteract();
      if (e.code === 'KeyR' && this.onReload) this.onReload();
      if (e.code === 'Space' && this.onAction) { e.preventDefault(); this.onAction(); }
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => { this.keys.clear(); this._settle(); };
    this._onClick = () => {
      if (this.enabled && document.pointerLockElement !== this.dom) {
        const p = this.dom.requestPointerLock();
        if (p && p.catch) p.catch(() => { /* gesture rejected — next click retries */ });
      }
    };
    this._onMouseDown = (e) => {
      // LMB while locked = fire the weapon (FP or third-person)
      if (this.enabled && e.button === 0 && document.pointerLockElement === this.dom && this.onFire) {
        this.onFire();
      }
    };

    document.addEventListener('mousemove', this._onMouse);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('focus', this._onFocus);
    dom.addEventListener('click', this._onClick);
    dom.addEventListener('mousedown', this._onMouseDown);
  }

  enable() {
    this.enabled = true;
    this._settle();   // ignore the lock-engage spike burst
    // sync targets so entering FP never snaps or inherits stale deltas
    this._targetYaw = this.yaw;
    this._targetPitch = this.pitch;
    const p = this.dom.requestPointerLock?.();
    if (p && p.catch) p.catch(() => { /* needs a click — _onClick will retry */ });
  }

  /** Teleport the eye to (x,z) at eye height, aimed at `yaw` (radians). Used to
   *  seat the player somewhere specific — e.g. on the bed for the bed game. */
  placeAt(x, z, yaw, pitch = -0.05) {
    this._settle();
    this.pos.set(x, this.pos.y, z);
    this.yaw = this._targetYaw = yaw;
    this.pitch = this._targetPitch = pitch;
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
  disable() {
    this.enabled = false;
    this.keys.clear();
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  /** Continuous combat aim magnetism: a soft, always-on pull toward whichever
   *  hostile is nearest the current aim, but ONLY once the reticle is within a
   *  stick cone — so aiming at empty space or a different target is never fought.
   *  The pull strengthens as the reticle nears the target (sticky adhesion) and
   *  fades briefly after a manual mouselook (a ramp, not a hard gate), so a
   *  deliberate flick always wins. `aimTarget()` returns live hostile aim points. */
  _aimAssist(dt) {
    if (!this.aiming || !this.aimTarget) return;
    const targets = this.aimTarget();
    if (!targets || !targets.length) return;
    const stick = ASSIST_STICK_DEG * Math.PI / 180;
    // pick the hostile closest to the current aim (angularly), not just nearest in space
    let bestErr = Infinity, bestYaw = 0, bestPitch = 0;
    for (const t of targets) {
      const dx = t.x - this.pos.x, dy = t.y - this.pos.y, dz = t.z - this.pos.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz < 0.01) continue;
      let dYaw = Math.atan2(-dx, -dz) - this._targetYaw;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));           // shortest path
      const dPitch = Math.atan2(dy, horiz) - this._targetPitch;
      const err = Math.hypot(dYaw, dPitch);
      if (err < bestErr) { bestErr = err; bestYaw = dYaw; bestPitch = dPitch; }
    }
    if (bestErr > stick) return;                                    // aiming away → free look
    const prox = 1 - bestErr / stick;                               // 1 aligned → 0 at cone edge
    const soft = THREE.MathUtils.clamp((performance.now() - this._lastLookMs) / ASSIST_SOFTEN_MS, 0, 1);
    const k = Math.min(0.5, ASSIST_STRENGTH * prox * soft * dt);
    this._targetYaw += bestYaw * k;
    this._targetPitch = THREE.MathUtils.clamp(this._targetPitch + bestPitch * k, -PITCH_CLAMP, PITCH_CLAMP);
  }

  /** @param {number} dt seconds */
  update(dt) {
    if (!this.enabled) return;
    this._aimAssist(dt);   // hostile auto-track nudges the targets before smoothing
    // ease actual view toward the target — small smoothing kills jitter without
    // adding perceptible lag (≈1 frame at 60fps)
    const k = Math.min(1, dt * LOOK_SMOOTH);
    this.yaw += (this._targetYaw - this.yaw) * k;
    this.pitch += (this._targetPitch - this.pitch) * k;
    if (!Number.isFinite(this.yaw)) { this.yaw = this._targetYaw = Math.PI; }
    if (!Number.isFinite(this.pitch)) { this.pitch = this._targetPitch = 0; }

    this.crouching = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
    this.pos.y = this.crouching ? EYE * 0.70 : EYE;
    const speed = (this.keys.has('ShiftLeft') && !this.crouching ? RUN_SPEED : WALK_SPEED)
      * (this.crouching ? 0.55 : 1);
    const f = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const s = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this._moving = !!(f || s);
    if (f || s) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const dx = (-sin * f + cos * s) * speed * dt;
      const dz = (-cos * f - sin * s) * speed * dt;
      this._move(dx, dz);
    }

    // drive the player body (visible only in third person)
    if (this.body) {
      this.body.root.visible = this.thirdPerson;
      this.body.root.position.set(this.pos.x, 0, this.pos.z);
      // face where the camera aims (horizontal): forward = (-sin, -cos)
      this.body.root.rotation.y = Math.atan2(-Math.sin(this.yaw), -Math.cos(this.yaw));
      this.body.facingTarget = this.body.root.rotation.y;
      const clip = this.crouching ? 'crouch'
        : (this.aiming ? 'aim'
          : (this._moving ? 'walk' : (this.body.persona.personality.idleClip || 'idle_confident')));
      if (this.body.animator.current?.id !== clip) this.body.playClip(clip, 0.18);
      this.body.update(dt);
    }

    const euler = _EULER.set(this.pitch, this.yaw, 0, 'YXZ');
    if (this.thirdPerson) {
      const look = _V1.set(0, 0, -1).applyEuler(euler);
      const right = _V2.set(1, 0, 0).applyEuler(euler);
      // pivot at head height; the side offset pushes the body into one third of
      // the frame while the camera still looks straight down the aim yaw — so the
      // centre-screen reticle and the fire raycast stay aligned (no down-tilt).
      const pivot = _V3.set(this.pos.x, this.pos.y + SHOULDER_UP, this.pos.z);
      const dist = this._camDist(pivot, look, SHOULDER_DIST);
      this.camera.position.copy(pivot).addScaledVector(look, -dist).addScaledVector(right, SHOULDER_SIDE);
      this.camera.rotation.copy(euler);
    } else {
      this.camera.position.copy(this.pos);
      this.camera.rotation.copy(euler);
    }
  }

  /** attach the visible player body (Actor3D) driven in third-person mode */
  attachBody(actor) { this.body = actor; }

  /** pull the third-person camera in if a wall is behind the player */
  _camDist(pivot, look, maxDist) {
    let d = maxDist;
    // sample back along -look; stop before leaving the walkable area / hitting a box
    for (let t = 0.6; t <= maxDist; t += 0.3) {
      const cx = pivot.x - look.x * t, cz = pivot.z - look.z * t;
      if (!this._walkable(cx, cz)) { d = Math.max(0.8, t - 0.35); break; }
    }
    return d;
  }

  /** point inside any walk rect (deflated by the body radius)? */
  _walkable(x, z) {
    const rects = this.world.walkRects?.[this.world.activeFloor];
    if (!rects || !rects.length) return true;
    for (const r of rects) {
      if (x >= r.x[0] + RADIUS && x <= r.x[1] - RADIUS &&
          z >= r.z[0] + RADIUS && z <= r.z[1] - RADIUS) return true;
    }
    // near a rect seam the radius margin can reject valid straddles — retry raw
    for (const r of rects) {
      if (x >= r.x[0] && x <= r.x[1] && z >= r.z[0] && z <= r.z[1]) return true;
    }
    return false;
  }

  _move(dx, dz) {
    let x = this.pos.x + dx, z = this.pos.z + dz;

    // walk-rect clamp with axis sliding
    if (!this._walkable(x, z)) {
      if (this._walkable(x, this.pos.z)) z = this.pos.z;
      else if (this._walkable(this.pos.x, z)) x = this.pos.x;
      else { x = this.pos.x; z = this.pos.z; }
    }

    // furniture AABB push-out (2D)
    for (const box of this.world.colliders) {
      if (x > box.min.x - RADIUS && x < box.max.x + RADIUS &&
          z > box.min.z - RADIUS && z < box.max.z + RADIUS && box.max.y > 0.5) {
        const pushLeft = x - (box.min.x - RADIUS);
        const pushRight = (box.max.x + RADIUS) - x;
        const pushBack = z - (box.min.z - RADIUS);
        const pushFront = (box.max.z + RADIUS) - z;
        const m = Math.min(pushLeft, pushRight, pushBack, pushFront);
        if (m === pushLeft) x = box.min.x - RADIUS;
        else if (m === pushRight) x = box.max.x + RADIUS;
        else if (m === pushBack) z = box.min.z - RADIUS;
        else z = box.max.z + RADIUS;
      }
    }
    this.pos.x = x;
    this.pos.z = z;
  }

  dispose() {
    document.removeEventListener('mousemove', this._onMouse);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    // focus + mousedown were added in the constructor but never removed: the
    // mousedown one kept onFire (and this whole rig) reachable after disposal
    window.removeEventListener('focus', this._onFocus);
    this.dom.removeEventListener('click', this._onClick);
    this.dom.removeEventListener('mousedown', this._onMouseDown);
  }
}
