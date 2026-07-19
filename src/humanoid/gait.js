// @ts-check
// Procedural walk cycle. Phase is driven by actual root velocity, so feet
// approximately match ground speed; blended over the clip layer by speed.
// Amplitudes are config-tunable (config/humanoid.yaml → gait).
import * as THREE from 'three';
import { cfg } from '../core/config.js';

const D2R = THREE.MathUtils.degToRad;

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
   * @param {number} intensity
   * @returns {{eulers: Record<string, [number,number,number]>, hipBobY: number, hipShiftX: number}}
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

    /** @type {Record<string, [number,number,number]>} */
    const eulers = {
      thighL: [-swing * thighAmp, 0, 0],
      thighR: [swing * thighAmp, 0, 0],
      // shin flexes while its leg swings forward (knee bend during swing phase)
      shinL: [lift * shinFlex * (swing > -0.2 ? 1 : 0.3) + D2R(3), 0, 0],
      shinR: [liftR * shinFlex * (swing < 0.2 ? 1 : 0.3) + D2R(3), 0, 0],
      footL: [-lift * D2R(14) + swing * D2R(6), 0, 0],
      footR: [-liftR * D2R(14) - swing * D2R(6), 0, 0],
      armL: [swing * armAmp, 0, D2R(4)],
      armR: [-swing * armAmp, 0, -D2R(4)],
      foreL: [Math.max(0, swing) * D2R(12) + D2R(8) * k, 0, 0],
      foreR: [Math.max(0, -swing) * D2R(12) + D2R(8) * k, 0, 0],
      spine1: [D2R(2) * k, -swing * D2R(3.5), 0],
      chest: [0, -swing * D2R(2.5), 0],
      hips: [D2R(3) * k, swing * D2R(4), Math.sin(p) * D2R(2.5)],
      head: [0, swing * D2R(2), 0],
    };
    return {
      eulers,
      hipBobY: Math.abs(Math.sin(p)) * (g.hipBob ?? 0.028) * k - (g.hipDrop ?? 0.012) * k,
      hipShiftX: Math.cos(p) * (g.hipShift ?? 0.014) * k,
    };
  }
}
