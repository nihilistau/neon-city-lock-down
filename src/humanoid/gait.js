// @ts-check
// Procedural walk cycle. Phase is driven by actual root velocity, so feet
// approximately match ground speed; blended over the clip layer by speed.
// Amplitudes are config-tunable (config/humanoid.yaml → gait).
import * as THREE from 'three';
import { cfg } from '../core/config.js';

const D2R = THREE.MathUtils.degToRad;

/**
 * Bone order for the packed euler buffer below. `set()` calls in pose() must
 * stay in exactly this order — the index IS the binding.
 */
const GAIT_ORDER = ['thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR',
  'armL', 'armR', 'foreL', 'foreR', 'spine1', 'chest', 'hips', 'head'];
/** shared scratch: 3 euler radians per bone, in GAIT_ORDER */
const _eulers = new Float32Array(GAIT_ORDER.length * 3);
const _result = { names: GAIT_ORDER, eulers: _eulers, hipBobY: 0, hipShiftX: 0 };

export class Gait {
  constructor() {
    this.phase = 0;          // radians; one full cycle = 2 steps
    this.strideLen = cfg('humanoid.gait.strideLen', 0.62);   // meters per step at full walk
    this.walkSpeed = cfg('humanoid.gait.walkSpeed', 1.25);   // m/s considered "full walk"
  }

  /**
   * @param {number} dt seconds
   * @param {number} speed current horizontal speed m/s
   */
  advance(dt, speed) {
    if (speed > 0.01) {
      this.phase += (speed * dt / this.strideLen) * Math.PI;
    } else {
      // settle phase toward nearest rest point so stopping doesn't freeze mid-swing
      const rest = Math.round(this.phase / Math.PI) * Math.PI;
      this.phase += (rest - this.phase) * Math.min(1, dt * 8);
    }
  }

  /**
   * Compute gait pose targets (euler radians per bone) + hip bob offset.
   * Intensity 0..1 scales all amplitudes (speed / walkSpeed).
   *
   * The result is written into SHARED module-level storage and handed back by
   * reference. This used to build a fresh object literal plus fourteen array
   * literals plus a wrapper object on every call — and it is called once per
   * MOVING actor per frame, so a walking cast was churning ~30 objects a frame
   * for numbers that are consumed and discarded three lines later.
   *
   * The contract that makes this safe: the caller (Animator.update, the only
   * one) reads the values into a Euler and a Quaternion inside the same block
   * and never retains the returned object. Any future caller that wants to KEEP
   * a pose must copy it out.
   * @param {number} intensity
   * @returns {{names: string[], eulers: Float32Array, hipBobY: number, hipShiftX: number}}
   */
  pose(intensity) {
    const p = this.phase;
    const k = intensity;
    const swing = Math.sin(p);            // +1: L leg forward
    const lift = Math.max(0, Math.sin(p + Math.PI / 2)); // L foot lift window
    const liftR = Math.max(0, Math.sin(p + Math.PI * 1.5));

    const g = cfg('humanoid.gait', {});
    const thighAmp = D2R(g.thighAmp ?? 26) * k;
    const shinFlex = D2R(g.shinFlex ?? 38) * k;
    const armAmp = D2R(g.armAmp ?? 13) * k;

    // Written by hand rather than through a helper: a closure here would itself
    // be an allocation per call, which is the thing this function exists to
    // avoid. Indices are 3 * the bone's position in GAIT_ORDER.
    const e = _eulers;
    e[0] = -swing * thighAmp; e[1] = 0; e[2] = 0;                              // thighL
    e[3] = swing * thighAmp; e[4] = 0; e[5] = 0;                               // thighR
    // shin flexes while its leg swings forward (knee bend during swing phase)
    e[6] = lift * shinFlex * (swing > -0.2 ? 1 : 0.3) + D2R(3); e[7] = 0; e[8] = 0;    // shinL
    e[9] = liftR * shinFlex * (swing < 0.2 ? 1 : 0.3) + D2R(3); e[10] = 0; e[11] = 0;  // shinR
    e[12] = -lift * D2R(14) + swing * D2R(6); e[13] = 0; e[14] = 0;            // footL
    e[15] = -liftR * D2R(14) - swing * D2R(6); e[16] = 0; e[17] = 0;           // footR
    e[18] = swing * armAmp; e[19] = 0; e[20] = D2R(4);                         // armL
    e[21] = -swing * armAmp; e[22] = 0; e[23] = -D2R(4);                       // armR
    e[24] = Math.max(0, swing) * D2R(12) + D2R(8) * k; e[25] = 0; e[26] = 0;   // foreL
    e[27] = Math.max(0, -swing) * D2R(12) + D2R(8) * k; e[28] = 0; e[29] = 0;  // foreR
    e[30] = D2R(2) * k; e[31] = -swing * D2R(3.5); e[32] = 0;                  // spine1
    e[33] = 0; e[34] = -swing * D2R(2.5); e[35] = 0;                           // chest
    e[36] = D2R(3) * k; e[37] = swing * D2R(4); e[38] = Math.sin(p) * D2R(2.5); // hips
    e[39] = 0; e[40] = swing * D2R(2); e[41] = 0;                              // head

    _result.hipBobY = Math.abs(Math.sin(p)) * (g.hipBob ?? 0.028) * k - (g.hipDrop ?? 0.012) * k;
    _result.hipShiftX = Math.cos(p) * (g.hipShift ?? 0.014) * k;
    return _result;
  }
}
