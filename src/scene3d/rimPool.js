// @ts-check
// A fixed-size pool of character rim lights.
//
// WHY THIS EXISTS
// Every Actor3D used to own a PointLight, created at intensity 0 and raised to
// 0.35 while speaking or 0.8 while fighting. Two problems, both structural:
//
// 1. An intensity-0 light is NOT free. three's forward renderer counts every
//    *visible* light and bakes that count into each material's shader. Four cast
//    plus a wave of hostiles meant a dozen point lights permanently in every
//    lit-material's uniform arrays, doing nothing but costing samples.
// 2. Worse, the count CHANGES as hostiles spawn and despawn — and each distinct
//    count is a different shader program, so a wave spawning mid-fight forced a
//    full recompile of every material on screen. That is the frame hitch you see
//    exactly when the game most needs to not hitch.
//
// The effect only ever highlights the one or two actors that currently matter,
// so the pool holds a fixed SIZE lights, always in the scene, never added or
// removed. The light count is a constant for the whole run: one shader variant,
// no spawn hitch, and the same look.
//
// The lights live on the SCENE ROOT rather than being parented to their actor.
// Parenting would drop them out of `traverseVisible` whenever the actor's floor
// group is hidden — which changes the count again, which is the bug. They follow
// their claimant by world position instead, updated once per frame.
import * as THREE from 'three';

/** How many actors can carry a rim at once. Speaker + combat focus covers every real case. */
const SIZE = 2;
const DISTANCE = 2.6;
const DECAY = 2;
/** Behind and slightly above the head. Must stay clear of the body: at decay 2 a
 *  point 0.1m away receives ~100x the intensity and blows to white, and strand
 *  hair falls back through anything closer than this. */
const OFFSET = new THREE.Vector3(0, 0, -0.95);

const _v = new THREE.Vector3();

class RimPool {
  constructor() {
    /** @type {THREE.PointLight[]} */
    this.lights = [];
    /** @type {({actor: any, want: number}|null)[]} slot i serves this.lights[i] */
    this.claims = [];
    this.scene = null;
  }

  /**
   * Attach the pool to a scene. Idempotent — a second run reuses the same lights
   * rather than leaking a new set per run.
   * @param {THREE.Scene} scene
   */
  init(scene) {
    if (this.scene === scene) return;
    for (const l of this.lights) l.parent?.remove(l);
    this.scene = scene;
    if (!this.lights.length) {
      for (let i = 0; i < SIZE; i++) {
        const l = new THREE.PointLight(0xffffff, 0, DISTANCE, DECAY);
        l.castShadow = false;
        l.name = `rimPool_${i}`;
        this.lights.push(l);
        this.claims.push(null);
      }
    }
    for (const l of this.lights) scene.add(l);
  }

  /**
   * Ask for a rim on `actor` at strength `v` (0 releases it).
   *
   * When every slot is busy the weakest claim is evicted, so a combat rim (0.8)
   * displaces a speaking rim (0.35) rather than being silently dropped.
   * @param {any} actor an Actor3D
   * @param {number} v 0..1
   */
  set(actor, v) {
    const held = this.claims.findIndex((c) => c && c.actor === actor);
    if (!(v > 0)) {
      if (held !== -1) { this.claims[held] = null; this.lights[held].intensity = 0; }
      return;
    }
    let slot = held;
    if (slot === -1) slot = this.claims.findIndex((c) => !c);
    if (slot === -1) {
      // all busy — evict the weakest, but only if we actually outrank it
      let weakest = 0;
      for (let i = 1; i < this.claims.length; i++) {
        if (this.claims[i].want < this.claims[weakest].want) weakest = i;
      }
      if (this.claims[weakest].want >= v) return;
      slot = weakest;
    }
    this.claims[slot] = { actor, want: v };
    const light = this.lights[slot];
    light.color.set(actor.persona?.accent ?? 0xffffff);
    light.intensity = v * 2.2;
    this._place(slot);
  }

  /** Drop any claim held by `actor` — call on despawn so a disposed body isn't tracked. */
  release(actor) { this.set(actor, 0); }

  /** @param {number} i */
  _place(i) {
    const claim = this.claims[i];
    if (!claim) return;
    const { actor } = claim;
    const root = actor.root;
    // the offset is in the actor's own frame, so a rim behind the head stays
    // behind the head as they turn
    _v.copy(OFFSET).applyQuaternion(root.quaternion).add(root.position);
    this.lights[i].position.set(_v.x, root.position.y + (actor.persona?.body?.height ?? 1.75) * 0.92, _v.z);
  }

  /** Follow claimants. Cheap: at most SIZE transforms, no allocation. */
  update() {
    for (let i = 0; i < this.claims.length; i++) {
      const c = this.claims[i];
      if (!c) continue;
      // an actor removed from the scene (dead hostile, floor swap) keeps no rim
      if (!c.actor.root?.parent) { this.claims[i] = null; this.lights[i].intensity = 0; continue; }
      this._place(i);
    }
  }
}

/** Single pool for the whole app — Actor3D has no scene reference of its own. */
export const rimPool = new RimPool();
