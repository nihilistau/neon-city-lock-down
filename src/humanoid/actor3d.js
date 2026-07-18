// @ts-check
// Actor3D — the visual+animation body of a character in the scene.
// Owns the root group, skinned mesh, face rig, animator. Movement/pose commands
// arrive via ActorQueue (Phase 1.2); here we expose the primitives it drives.
import * as THREE from 'three';
import { buildSkeleton } from './skeleton.js';
import { buildBody } from './bodyBuilder.js';
import { FaceRig } from './face.js';
import { Animator } from './animator.js';

export class Actor3D {
  /** @param {import('../../data/cast/lola.js').lola} persona */
  constructor(persona) {
    this.persona = persona;
    this.id = persona.id;

    this.root = new THREE.Group();
    this.root.name = `actor_${persona.id}`;

    this.rig = buildSkeleton(persona.body);
    this.mesh = buildBody(persona, this.rig);
    this.root.add(this.mesh);

    this.face = new FaceRig(persona, this.rig);
    this.animator = new Animator(this.rig, persona.personality);
    this.animator.play(persona.personality.idleClip || 'idle_stand', 0.01);

    // movement state (set by mover/nav; animator reads speed)
    this._lastPos = this.root.position.clone();
    this.facingTarget = null; // yaw radians the body eases toward
    this._yawVel = 0;

    // rim light that travels with the character for the neon look
    this.rim = new THREE.PointLight(new THREE.Color(persona.accent), 0, 2.6, 2);
    this.rim.position.set(0, persona.body.height * 1.05, -0.55);
    this.root.add(this.rim);
  }

  /** face a world-space yaw (radians); body eases, doesn't snap */
  faceYaw(yaw) { this.facingTarget = yaw; }

  /** hard-teleport without a gait speed spike */
  snapTo(x, z, yaw) {
    this.root.position.set(x, 0, z);
    if (yaw != null) { this.root.rotation.y = yaw; this.facingTarget = yaw; }
    this._lastPos.copy(this.root.position);
  }

  /** @param {THREE.Object3D|null} obj */
  lookAt(obj) { this.animator.lookAt(obj); }

  /** @param {string} clipId @param {number} [fade] */
  playClip(clipId, fade) { this.animator.play(clipId, fade); }

  /** set arousal/energy tempo scalar (drives tempoScaled clips + breath) */
  setTempo(t) { this.animator.tempo = t; }

  /** @param {number} v 0..1 rim intensity */
  setRim(v) { this.rim.intensity = v * 2.2; }

  /**
   * @param {number} dt seconds
   */
  update(dt) {
    // derive planar speed from root motion for the gait layer
    const dx = this.root.position.x - this._lastPos.x;
    const dz = this.root.position.z - this._lastPos.z;
    const dist = Math.hypot(dx, dz);
    this.animator.speed = dt > 0 ? dist / dt : 0;
    this._lastPos.copy(this.root.position);

    // ease body yaw toward facing target
    if (this.facingTarget != null) {
      let diff = this.facingTarget - this.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.root.rotation.y += diff * Math.min(1, dt * 8);
    }

    this.animator.update(dt, this.root);
    this.face.update(dt);
  }

  dispose() {
    this.root.traverse((o) => {
      const m = /** @type {THREE.Mesh} */ (o);
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) { if (mat.map) mat.map.dispose(); mat.dispose(); }
    });
  }
}
