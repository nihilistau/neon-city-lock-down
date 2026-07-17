// @ts-check
// Scene lighting: a fixed light kit whose parameters lerp between presets.
// Slice ships two presets; the full 10 land with data/lightingPresets.js in P2.
import * as THREE from 'three';
import { PALETTE } from './materials/palette.js';

/** @typedef {{hemi:{sky:number, ground:number, intensity:number},
 *             key:{color:number, intensity:number, pos:[number,number,number]},
 *             warm:{color:number, intensity:number}, cool:{color:number, intensity:number},
 *             accent:{color:number, intensity:number},
 *             fog:{color:number, density:number}, exposure:number, pulse?:{light:'accent', speed:number}}} LightPreset */

/** @type {Record<string, LightPreset>} */
export const PRESETS = {
  neon_night: {
    hemi: { sky: 0x2a4a8a, ground: 0x141020, intensity: 1.1 },
    key: { color: 0xbfd8ff, intensity: 1.1, pos: [6, 10, 10] },      // cold city moonlight through glass
    warm: { color: 0xffb347, intensity: 95 },                        // lounge lamp pool
    cool: { color: 0x39e6ff, intensity: 34 },                        // ceiling strip wash
    accent: { color: 0xff3fa4, intensity: 42 },                      // bar magenta
    fog: { color: 0x06070c, density: 0.012 },
    exposure: 1.1,
  },
  blackout_emergency: {
    hemi: { sky: 0x1a0a0a, ground: 0x050205, intensity: 0.4 },
    key: { color: 0x883333, intensity: 0.2, pos: [6, 10, 10] },
    warm: { color: 0xff4757, intensity: 30 },
    cool: { color: 0x220a14, intensity: 8 },
    accent: { color: 0xff2222, intensity: 110 },
    fog: { color: 0x040205, density: 0.03 },
    exposure: 0.9,
    pulse: { light: 'accent', speed: 2.2 },
  },
};

export class Lighting {
  /** @param {import('./stage.js').Stage} stage */
  constructor(stage) {
    this.stage = stage;
    this.hemi = new THREE.HemisphereLight(0x2a4a8a, 0x141020, 1.1);
    this.key = new THREE.DirectionalLight(0xbfd8ff, 1.1);
    this.key.position.set(6, 10, 10);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.left = -12; this.key.shadow.camera.right = 12;
    this.key.shadow.camera.top = 12; this.key.shadow.camera.bottom = -12;

    this.warm = new THREE.PointLight(0xffb347, 95, 11, 1.8);
    this.warm.position.set(-6.2, 2.0, -2.4);            // over the lounge lamp
    this.cool = new THREE.PointLight(0x39e6ff, 34, 14, 1.8);
    this.cool.position.set(-2, 2.75, 1);                // ceiling wash
    this.accent = new THREE.PointLight(0xff3fa4, 42, 12, 1.8);
    this.accent.position.set(4.2, 2.7, -3.2);           // bar glow

    stage.scene.add(this.hemi, this.key, this.warm, this.cool, this.accent);
    stage.scene.fog = new THREE.FogExp2(0x06070c, 0.016);

    this.presetId = 'neon_night';
    /** @type {LightPreset} */
    this._target = PRESETS.neon_night;
    this._fadeT = 1;
    this._fadeDur = 1;
    this._from = null;
    this._t = 0;
  }

  /** @param {string} id @param {number} [fadeSec] */
  apply(id, fadeSec = 1.2) {
    const preset = PRESETS[id];
    if (!preset) throw new Error(`unknown lighting preset: ${id}`);
    this._from = this._snapshot();
    this._target = preset;
    this.presetId = id;
    this._fadeT = 0;
    this._fadeDur = Math.max(0.01, fadeSec);
  }

  _snapshot() {
    return {
      hemi: { sky: this.hemi.color.getHex(), ground: this.hemi.groundColor.getHex(), intensity: this.hemi.intensity },
      key: { color: this.key.color.getHex(), intensity: this.key.intensity, pos: this.key.position.toArray() },
      warm: { color: this.warm.color.getHex(), intensity: this.warm.intensity },
      cool: { color: this.cool.color.getHex(), intensity: this.cool.intensity },
      accent: { color: this.accent.color.getHex(), intensity: this.accent.intensity },
      fog: { color: this.stage.scene.fog.color.getHex(), density: this.stage.scene.fog.density },
      exposure: this.stage.renderer.toneMappingExposure,
    };
  }

  /** @param {number} dt seconds */
  update(dt) {
    this._t += dt;
    if (this._fadeT < 1 && this._from) {
      this._fadeT = Math.min(1, this._fadeT + dt / this._fadeDur);
      const k = this._fadeT * this._fadeT * (3 - 2 * this._fadeT);
      const a = this._from, b = this._target;
      const lerpColor = (light, prop, from, to) => light[prop].setHex(from).lerp(new THREE.Color(to), k);
      lerpColor(this.hemi, 'color', a.hemi.sky, b.hemi.sky);
      lerpColor(this.hemi, 'groundColor', a.hemi.ground, b.hemi.ground);
      this.hemi.intensity = THREE.MathUtils.lerp(a.hemi.intensity, b.hemi.intensity, k);
      lerpColor(this.key, 'color', a.key.color, b.key.color);
      this.key.intensity = THREE.MathUtils.lerp(a.key.intensity, b.key.intensity, k);
      for (const name of ['warm', 'cool', 'accent']) {
        lerpColor(this[name], 'color', a[name].color, b[name].color);
        this[name].intensity = THREE.MathUtils.lerp(a[name].intensity, b[name].intensity, k);
      }
      this.stage.scene.fog.color.setHex(a.fog.color).lerp(new THREE.Color(b.fog.color), k);
      this.stage.scene.fog.density = THREE.MathUtils.lerp(a.fog.density, b.fog.density, k);
      this.stage.renderer.toneMappingExposure = THREE.MathUtils.lerp(a.exposure, b.exposure, k);
    }
    // pulse effect (emergency strobes etc.)
    const pulse = this._target.pulse;
    if (pulse && this._fadeT >= 1) {
      const base = this._target[pulse.light].intensity;
      this[pulse.light].intensity = base * (0.55 + 0.45 * Math.abs(Math.sin(this._t * pulse.speed)));
    }
  }
}
