// @ts-check
// Layered animator: clip layer (with crossfade) → gait blend by speed →
// additive breath/fidget → gaze. Single writer to bone transforms.
import * as THREE from 'three';
import { getClip } from './clips.js';
import { Gait } from './gait.js';

const D2R = THREE.MathUtils.degToRad;
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

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

    this.current = getClip('idle_stand');
    /** @type {import('./clips.js').CompiledClip|null} */
    this.previous = null;
    this.clipTime = 0;
    this.prevTime = 0;
    this.fade = 1;            // 0→1 progress of crossfade
    this.fadeDuration = 0.3;

    this.gait = new Gait();
    this.speed = 0;           // set by mover each frame
    this.tempo = 1;           // arousal/energy scalar for tempoScaled clips
    this.breathAmp = personality.breathBase ?? 1;
    this.fidget = personality.fidget ?? 1;
    this._t = 0;

    /** @type {THREE.Object3D|null} world-space gaze target */
    this.gazeTarget = null;
    this.gazeWeight = 0;
    this._gazeYaw = 0;
    this._gazePitch = 0;
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
    const boneNames = new Set();
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
        bone.quaternion.copy(_q2);
      } else if (hasCur) {
        bone.quaternion.copy(_q);
      }
    }
    // bones untouched by either clip relax to identity
    for (const [name, bone] of Object.entries(this.bones)) {
      if (name === 'root') continue;
      if (!boneNames.has(name) && !GAIT_BONES.includes(name)) {
        bone.quaternion.slerp(_q.identity(), Math.min(1, dt * 6));
      }
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
      const g = this.gait.pose(0.4 + 0.6 * w);
      for (const [name, deg] of Object.entries(g.eulers)) {
        const bone = this.bones[name];
        if (!bone) continue;
        _e.set(deg[0], deg[1], deg[2], 'XYZ');
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
      _v.setFromMatrixPosition(this.gazeTarget.matrixWorld);
      const local = characterRoot.worldToLocal(_v.clone());
      const headPos = this.bones.head.getWorldPosition(new THREE.Vector3());
      const headLocal = characterRoot.worldToLocal(headPos);
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
  }
}

function applyAdditiveX(bone, rx) { applyAdditive(bone, rx, 0, 0); }
function applyAdditive(bone, rx, ry, rz) {
  _e.set(rx, ry, rz, 'XYZ');
  _q2.setFromEuler(_e);
  bone.quaternion.multiply(_q2);
}
