// @ts-check
// First-person controls: pointer-lock mouselook + WASD, E interact, SPACE
// context action, shift run. Collision: the active floor's walk-rect union
// (rect edges ARE the walls) + furniture AABB push-out.
//
// Mouselook robustness: Chromium can deliver enormous movementX/Y spikes right
// after pointer-lock engages or on alt-tab return, and some devices emit NaN on
// the first event — either one turns the camera into an uncontrollable spin.
// We clamp per-event deltas, reject non-finite values, swallow the first event
// after each lock, and smooth the result.
import * as THREE from 'three';
import { settings } from '../core/settings.js';

const EYE = 1.62;
const RADIUS = 0.26;
const MAX_DELTA = 120;          // px per event — anything larger is a glitch spike

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

    this._justLocked = false;
    // smoothed look target (raw deltas write these; update() eases toward them)
    this._targetYaw = this.yaw;
    this._targetPitch = this.pitch;

    this._onMouse = (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      let mx = e.movementX, my = e.movementY;
      if (!Number.isFinite(mx) || !Number.isFinite(my)) return;   // NaN poisons yaw
      if (this._justLocked) { this._justLocked = false; return; } // first event = garbage
      mx = THREE.MathUtils.clamp(mx, -MAX_DELTA, MAX_DELTA);
      my = THREE.MathUtils.clamp(my, -MAX_DELTA, MAX_DELTA);
      const sens = 0.0019 * (settings.mouseSensitivity ?? 1);
      this._targetYaw -= mx * sens;
      this._targetPitch = THREE.MathUtils.clamp(this._targetPitch - my * sens, -1.35, 1.35);
    };
    this._onLockChange = () => {
      if (document.pointerLockElement === this.dom) {
        this._justLocked = true;
      } else {
        // lock lost (Esc, alt-tab): drop held keys so movement can't run away
        this.keys.clear();
      }
    };
    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE' && this.onInteract) this.onInteract();
      if (e.code === 'Space' && this.onAction) { e.preventDefault(); this.onAction(); }
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => this.keys.clear();
    this._onClick = () => {
      if (this.enabled && document.pointerLockElement !== this.dom) {
        const p = this.dom.requestPointerLock();
        if (p && p.catch) p.catch(() => { /* gesture rejected — next click retries */ });
      }
    };

    document.addEventListener('mousemove', this._onMouse);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    dom.addEventListener('click', this._onClick);
  }

  enable() {
    this.enabled = true;
    // sync targets so entering FP never snaps or inherits stale deltas
    this._targetYaw = this.yaw;
    this._targetPitch = this.pitch;
    const p = this.dom.requestPointerLock?.();
    if (p && p.catch) p.catch(() => { /* needs a click — _onClick will retry */ });
  }
  disable() {
    this.enabled = false;
    this.keys.clear();
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  /** @param {number} dt seconds */
  update(dt) {
    if (!this.enabled) return;
    // ease actual view toward the target — small smoothing kills jitter without
    // adding perceptible lag (≈1 frame at 60fps)
    const k = Math.min(1, dt * 30);
    this.yaw += (this._targetYaw - this.yaw) * k;
    this.pitch += (this._targetPitch - this.pitch) * k;
    if (!Number.isFinite(this.yaw)) { this.yaw = this._targetYaw = Math.PI; }
    if (!Number.isFinite(this.pitch)) { this.pitch = this._targetPitch = 0; }

    const speed = this.keys.has('ShiftLeft') ? 4.4 : 2.6;
    const f = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const s = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    if (f || s) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const dx = (-sin * f + cos * s) * speed * dt;
      const dz = (-cos * f - sin * s) * speed * dt;
      this._move(dx, dz);
    }
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
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
    this.dom.removeEventListener('click', this._onClick);
  }
}
