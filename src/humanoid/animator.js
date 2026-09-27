// @ts-check
// Layered animator: clip layer (with crossfade) → gait blend by speed →
// additive breath/fidget → gaze. Single writer to bone transforms.
import * as THREE from 'three';
import { getClip } from './clips.js';
import { Gait } from './gait.js';
import { cfg } from '../core/config.js';

const D2R = THREE.MathUtils.degToRad;
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
/** rest pose target — never mutated */
const _QI = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
/** scratch set for the per-frame touched-bone union — never escapes update() */
const _touched = new Set();

/** bones the gait layer may write */
const GAIT_BONES = ['thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR',
  'armL', 'armR', 'foreL', 'foreR', 'spine1', 'chest', 'hips', 'head'];

export class Animator {
  /**
   * @param {{ byName: Record<string, THREE.Bone> }} rig
   * @param {{ breathBase?: number, fidget?: number }} [personality]
   */
  constructor(rig, personality = {}) {
    this.bones = rig.byName;
    this.hipsRest = this.bones.hips.position.clone();
    // The relax pass below used to walk `Object.entries(this.bones)` every
    // frame: one array plus 31 two-element pair arrays PER ACTOR PER FRAME, for
    // a set of bones that never changes after the rig is built. Cache the
    // parallel arrays once — and the GAIT_BONES membership test with them, so
    // the inner loop stops doing a linear `includes` per bone as well.
    this._boneNames = Object.keys(this.bones);
    this._boneList = this._boneNames.map((n) => this.bones[n]);
    this._boneIsGait = this._boneNames.map((n) => GAIT_BONES.includes(n));
    this._boneIsRoot = this._boneNames.map((n) => n === 'root');

    this.current = getClip('idle_stand');
    /** @type {import('./clips.js').CompiledClip|null} */
    this.previous = null;
    this.clipTime = 0;
    this.prevTime = 0;
    this.fade = 1;            // 0→1 progress of crossfade
    this.fadeDuration = cfg('humanoid.animator.crossfade', 0.3);

    this.gait = new Gait();
    this.speed = 0;           // set by mover each frame
    this.tempo = 1;           // energy/tension scalar for tempoScaled clips
    this.breathAmp = personality.breathBase ?? 1;
    this.fidget = personality.fidget ?? 1;
    this._t = 0;

    /** @type {THREE.Object3D|null} world-space gaze target */
    this.gazeTarget = null;
    this.gazeWeight = 0;
    this._gazeYaw = 0;
    this._gazePitch = 0;

    // ---- hair spring. skeleton.js has declared hair1/hair2/hair3 since day one
    // and NOTHING animated them, so long hair was a rigid slab welded to the
    // skull. Springing them from root motion is the whole difference between
    // "hair" and "a helmet".
    this._hairBones = ['hair1', 'hair2', 'hair3'].map((n) => this.bones[n]).filter(Boolean);
    this._hair = this._hairBones.map(() => ({ x: 0, z: 0, vx: 0, vz: 0 }));
    this._hairPrevPos = new THREE.Vector3();
    this._hairPrevVel = new THREE.Vector3();
    this._hairPrevYaw = 0;
    this._hairInit = false;
  }

  /**
   * Crossfade to a clip.
   * @param {string} clipId @param {number} [fadeSec]
   */
  play(clipId, fadeSec = 0.3) {
    if (this.current?.id === clipId) return;
    this.previous = this.current;
    this.prevTime = this.clipTime;
    this.current = getClip(clipId);
    this.clipTime = 0;
    this.fade = 0;
    this.fadeDuration = Math.max(0.01, fadeSec);
  }

  /** @param {THREE.Object3D|null} target */
  lookAt(target) {
    this.gazeTarget = target;
  }

  /**
   * @param {number} dt seconds
   * @param {THREE.Object3D} characterRoot root group (for gaze space + velocity)
   */
  update(dt, characterRoot) {
    this._t += dt;
    const rate = this.current.tempoScaled ? this.tempo : 1;
    this.clipTime += dt * rate;
    if (this.previous) this.prevTime += dt;
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / this.fadeDuration);
      if (this.fade >= 1) this.previous = null;
    }

    // ---- layer 1: clip pose (crossfaded)
    // One reused Set rather than a fresh one per actor per frame. Cleared, not
    // reallocated; it never escapes this function.
    const boneNames = _touched;
    boneNames.clear();
    for (const b of this.current.tracks.keys()) boneNames.add(b);
    if (this.previous) for (const b of this.previous.tracks.keys()) boneNames.add(b);

    for (const name of boneNames) {
      const bone = this.bones[name];
      if (!bone) continue;
      const hasCur = this.current.sample(name, this.clipTime, _q);
      if (this.previous) {
        const hasPrev = this.previous.sample(name, this.prevTime, _q2);
        if (hasPrev && hasCur) _q2.slerp(_q, this.fade);
        else if (!hasPrev) _q2.identity().slerp(_q, this.fade);
        // hasPrev && !hasCur: the incoming clip doesn't touch this bone, so ease
        // the outgoing pose back to rest. Without this the case matched neither
        // branch, held the outgoing pose at FULL weight for the whole fade, and
        // then popped when `previous` was nulled (e.g. sit_relaxed → idle_stand
        // snapped the legs at the end of the blend).
        else _q2.slerp(_QI, this.fade);
        bone.quaternion.copy(_q2);
      } else if (hasCur) {
        bone.quaternion.copy(_q);
      }
    }
    // bones untouched by either clip relax to identity. Gait-owned bones relax
    // too when the character isn't moving — otherwise a sit pose's legs stay
    // latched forever under a torso-only clip (the "seated contortion" bug).
    const gaitW = Math.min(1, this.speed / this.gait.walkSpeed);
    for (let i = 0; i < this._boneList.length; i++) {
      if (this._boneIsRoot[i] || boneNames.has(this._boneNames[i])) continue;
      const rate = this._boneIsGait[i] ? dt * 6 * (1 - gaitW) : dt * 6;
      if (rate > 0.0005) this._boneList[i].quaternion.slerp(_q.identity(), Math.min(1, rate));
    }

    // hips position: rest + clip offset
    _v.set(0, 0, 0);
    if (this.current.sampleHips(this.clipTime, _v)) {
      this.bones.hips.position.copy(this.hipsRest).add(_v);
    } else {
      this.bones.hips.position.copy(this.hipsRest);
    }

    // ---- layer 2: gait, blended by speed
    this.gait.advance(dt, this.speed);
    const w = Math.min(1, this.speed / this.gait.walkSpeed);
    if (w > 0.01) {
      // `g` is shared scratch owned by Gait — read it here, never retain it
      const g = this.gait.pose(0.4 + 0.6 * w);
      for (let i = 0; i < g.names.length; i++) {
        const bone = this.bones[g.names[i]];
        if (!bone) continue;
        const o = i * 3;
        _e.set(g.eulers[o], g.eulers[o + 1], g.eulers[o + 2], 'XYZ');
        _q.setFromEuler(_e);
        bone.quaternion.slerp(_q, w);
      }
      this.bones.hips.position.y += g.hipBobY * w;
      this.bones.hips.position.x += g.hipShiftX * w;
    }

    // ---- layer 3: additive breath + idle fidget
    const breath = Math.sin(this._t * (1.4 * this.breathAmp)) * D2R(1.6) * this.breathAmp;
    applyAdditiveX(this.bones.chest, breath);
    applyAdditiveX(this.bones.spine2, breath * 0.5);
    if (w < 0.3 && this.fidget > 0) {
      const f = this.fidget;
      applyAdditive(this.bones.spine1,
        Math.sin(this._t * 0.31) * D2R(1.1) * f, 0, Math.sin(this._t * 0.23) * D2R(1.4) * f);
      applyAdditive(this.bones.head,
        Math.sin(this._t * 0.43 + 1) * D2R(1.5) * f, Math.sin(this._t * 0.19 + 2) * D2R(2.2) * f, 0);
    }

    // ---- layer 4: gaze (neck 40% / head 60%)
    let targetYaw = 0, targetPitch = 0, targetWeight = 0;
    if (this.gazeTarget) {
      // Two scratch vectors, no allocation. `_v` was already dead after the
      // setFromMatrixPosition read, so cloning it was pure waste, and
      // getWorldPosition() takes a target precisely so it need not allocate.
      _v.setFromMatrixPosition(this.gazeTarget.matrixWorld);
      const local = characterRoot.worldToLocal(_v);
      const headLocal = characterRoot.worldToLocal(
        _v2.setFromMatrixPosition(this.bones.head.matrixWorld));
      const d = local.sub(headLocal);
      targetYaw = Math.atan2(d.x, d.z);
      targetPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      // clamp to plausible neck range; beyond that, give up (body turn is nav's job)
      if (Math.abs(targetYaw) < D2R(75)) {
        targetWeight = 1;
        targetYaw = THREE.MathUtils.clamp(targetYaw, -D2R(60), D2R(60));
        targetPitch = THREE.MathUtils.clamp(targetPitch, -D2R(25), D2R(30));
      }
    }
    this.gazeWeight += (targetWeight - this.gazeWeight) * Math.min(1, dt * 5);
    this._gazeYaw += (targetYaw - this._gazeYaw) * Math.min(1, dt * 5);
    this._gazePitch += (targetPitch - this._gazePitch) * Math.min(1, dt * 5);
    if (this.gazeWeight > 0.01) {
      const yaw = this._gazeYaw * this.gazeWeight, pitch = this._gazePitch * this.gazeWeight;
      applyAdditive(this.bones.neck, -pitch * 0.4, yaw * 0.4, 0);
      applyAdditive(this.bones.head, -pitch * 0.6, yaw * 0.6, 0);
    }

    // ---- layer 5: hair secondary motion
    this._updateHair(dt, characterRoot);
  }

  /**
   * Spring the hair chain from ROOT motion, in body space so a turn swishes the
   * hair sideways and a sprint trails it back. Written last, after the relax pass
   * that eases un-clipped bones to identity, so this is the single writer.
   * @param {number} dt @param {THREE.Object3D} root
   */
  _updateHair(dt, root) {
    const n = this._hairBones.length;
    if (!n || dt <= 0) return;
    if (!this._hairInit) {
      this._hairPrevPos.copy(root.position);
      this._hairPrevYaw = root.rotation.y;
      this._hairInit = true;
      return;
    }

    // body-space velocity + acceleration. Both are clamped: a teleport
    // (Actor3D.snapTo, save restore, the director) is a one-frame position jump
    // and an unclamped spring would fling the hair off the head.
    _v.copy(root.position).sub(this._hairPrevPos).divideScalar(dt);
    this._hairPrevPos.copy(root.position);
    _v.applyAxisAngle(UP, -root.rotation.y);
    _v.clampLength(0, 8);
    const ax = THREE.MathUtils.clamp((_v.x - this._hairPrevVel.x) / dt, -40, 40);
    const az = THREE.MathUtils.clamp((_v.z - this._hairPrevVel.z) / dt, -40, 40);
    this._hairPrevVel.copy(_v);

    let dYaw = root.rotation.y - this._hairPrevYaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this._hairPrevYaw = root.rotation.y;
    const yawRate = THREE.MathUtils.clamp(dYaw / dt, -12, 12);

    const sway = cfg('humanoid.hair.sway', 0.030);
    const stiff = cfg('humanoid.hair.stiffness', 55);
    const damp = cfg('humanoid.hair.damping', 9);
    const maxA = D2R(cfg('humanoid.hair.maxDeg', 26));
    const idle = cfg('humanoid.hair.idleSway', 0.035);

    // hair lags motion: forward accel throws it back (+x), lateral accel and body
    // yaw throw it to the opposite side (-z)
    const tX = sway * (az + _v.z * 2.2) + idle * Math.sin(this._t * 0.9);
    const tZ = -sway * (ax + yawRate * 1.6) + idle * 0.6 * Math.sin(this._t * 0.7 + 1.3);

    for (let i = 0; i < n; i++) {
      const s = this._hair[i];
      const lag = 1 - i * 0.22;                // tips move more, later
      const k = stiff * (1 - i * 0.14);
      s.vx += ((tX * lag - s.x) * k - s.vx * damp) * dt;
      s.vz += ((tZ * lag - s.z) * k - s.vz * damp) * dt;
      s.x = THREE.MathUtils.clamp(s.x + s.vx * dt, -maxA, maxA);
      s.z = THREE.MathUtils.clamp(s.z + s.vz * dt, -maxA, maxA);
      _e.set(s.x, 0, s.z, 'XYZ');
      this._hairBones[i].quaternion.setFromEuler(_e);
    }
  }
}

function applyAdditiveX(bone, rx) { applyAdditive(bone, rx, 0, 0); }
function applyAdditive(bone, rx, ry, rz) {
  _e.set(rx, ry, rz, 'XYZ');
  _q2.setFromEuler(_e);
  bone.quaternion.multiply(_q2);
}
