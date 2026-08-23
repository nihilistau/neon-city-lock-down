// @ts-check
// Actor3D — the visual+animation body of a character in the scene.
// Owns the root group, skinned mesh, face rig, animator. Movement/pose commands
// arrive via ActorQueue (Phase 1.2); here we expose the primitives it drives.
import * as THREE from 'three';
import { buildSkeleton } from './skeleton.js';
import { buildBody } from './bodyBuilder.js';
import { FaceRig } from './face.js';
import { Animator } from './animator.js';
import { attachAccessories } from './accessories.js';

/** Material texture slots an actor can own; all must be disposed with the body. */
const TEXTURE_SLOTS = [
  'map', 'roughnessMap', 'metalnessMap', 'normalMap', 'bumpMap',
  'emissiveMap', 'alphaMap', 'aoMap',
];

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

    // Rim light that travels with the character for the neon look.
    //
    // It MUST stay clear of the body: with decay 2, a point 0.1m away receives
    // ~100x the intensity, so any geometry that reaches the light blows to pure
    // white. It used to sit 0.55m behind the head, which was empty space when
    // hair was a small skull cap — the strand hair now falls back through that
    // point, which put a blazing blob on the back of every head.
    this.rim = new THREE.PointLight(new THREE.Color(persona.accent), 0, 2.6, 2);
    this.rim.position.set(0, persona.body.height * 0.92, -0.95);
    this.root.add(this.rim);
    attachAccessories(this, persona);
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
  playClip(clipId, fade) {
    if (this.downed) return;   // a corpse stays down whoever asks
    this.animator.play(clipId, fade);
  }

  /**
   * Collapse (or un-collapse) this body. Latched, because plenty of callers
   * replay an idle clip afterwards — the combat resolver, save restore, the
   * director — and none of them know the character just died.
   * @param {boolean} v
   */
  setDowned(v) {
    this.downed = false;                 // let the pose change land
    if (v) {
      this.playClip('lounge', 0.35);
      this.lookAt(null);
      this.face.setExpression({ lids: 1, mouth: 'neutral', browAngle: 0, browRaise: 0 });
      this.setRim(0);
      this.root.rotation.x = -Math.PI / 2 * 0.06;
    } else {
      this.root.rotation.x = 0;
    }
    this.downed = !!v;
  }

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
    // Pass visibility down: the first-person player body is hidden but still
    // ticked, and the face rig would otherwise repaint + re-upload a 256² canvas
    // (and two iris canvases) at 15Hz for a mesh nobody can see.
    this.face.update(dt, this.root.visible);
  }

  dispose() {
    this.root.traverse((o) => {
      const m = /** @type {THREE.Mesh} */ (o);
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      // every texture slot, not just .map — the 128px roughness CanvasTexture is
      // built per actor, so one leaked per hostile per combat wave.
      // EXCEPT textures flagged shared: bodyBuilder now caches the skin albedo +
      // roughness canvases per tone (they were bit-identical per actor and cost a
      // multi-hundred-ms hitch per breach wave to regenerate). Disposing one here
      // would black out every later actor with the same skin tone.
      for (const mat of mats) {
        for (const slot of TEXTURE_SLOTS) {
          const tex = mat[slot];
          if (tex && !tex.userData?.shared) tex.dispose?.();
        }
        mat.dispose();
      }
    });
  }
}
