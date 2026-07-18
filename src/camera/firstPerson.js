// @ts-check
// First-person controls: pointer-lock mouselook + WASD, E interact, SPACE
// context action, shift run. Collision: the active floor's walk-rect union
// (rect edges ARE the walls) + furniture AABB push-out.
import * as THREE from 'three';

const EYE = 1.62;
const RADIUS = 0.26;

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

    this._onMouse = (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0023;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0021, -1.35, 1.35);
    };
    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE' && this.onInteract) this.onInteract();
      if (e.code === 'Space' && this.onAction) { e.preventDefault(); this.onAction(); }
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onClick = () => {
      if (this.enabled && document.pointerLockElement !== this.dom) this.dom.requestPointerLock();
    };

    document.addEventListener('mousemove', this._onMouse);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    dom.addEventListener('click', this._onClick);
  }

  enable() {
    this.enabled = true;
    this.dom.requestPointerLock?.();
  }
  disable() {
    this.enabled = false;
    this.keys.clear();
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  /** @param {number} dt seconds */
  update(dt) {
    if (!this.enabled) return;
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
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    this.dom.removeEventListener('click', this._onClick);
  }
}
