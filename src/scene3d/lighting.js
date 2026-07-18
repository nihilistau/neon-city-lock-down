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
  golden_hour: {
    hemi: { sky: 0x8a5a3a, ground: 0x241418, intensity: 1.2 },
    key: { color: 0xffa25c, intensity: 2.2, pos: [10, 5, 8] },
    warm: { color: 0xffb347, intensity: 60 },
    cool: { color: 0x6a86b0, intensity: 12 },
    accent: { color: 0xff7a4d, intensity: 24 },
    fog: { color: 0x1a1010, density: 0.010 },
    exposure: 1.15,
  },
  candlelit: {
    hemi: { sky: 0x1c1410, ground: 0x0a0604, intensity: 0.35 },
    key: { color: 0x443322, intensity: 0.15, pos: [6, 10, 10] },
    warm: { color: 0xff9a3c, intensity: 70 },
    cool: { color: 0x14100a, intensity: 3 },
    accent: { color: 0xcc6a2a, intensity: 16 },
    fog: { color: 0x080503, density: 0.02 },
    exposure: 1.0,
    pulse: { light: 'warm', speed: 9.5, depth: 0.12 },
  },
  dawn_grey: {
    hemi: { sky: 0x5a6a7e, ground: 0x1c2028, intensity: 1.2 },
    key: { color: 0xc8d4e2, intensity: 1.0, pos: [8, 8, 10] },
    warm: { color: 0xd8c8b8, intensity: 26 },
    cool: { color: 0x8aa0b8, intensity: 20 },
    accent: { color: 0x88788a, intensity: 10 },
    fog: { color: 0x10141a, density: 0.014 },
    exposure: 0.95,
  },
  storm: {
    hemi: { sky: 0x2a3442, ground: 0x0c1014, intensity: 0.8 },
    key: { color: 0x8a9ab0, intensity: 0.7, pos: [4, 12, 6] },
    warm: { color: 0xffb347, intensity: 60 },
    cool: { color: 0x39536b, intensity: 22 },
    accent: { color: 0x5a6e8c, intensity: 18 },
    fog: { color: 0x080b10, density: 0.022 },
    exposure: 0.95,
    pulse: { light: 'key', speed: 0.35, depth: 3.2, lightning: true },
  },
  club_pulse: {
    hemi: { sky: 0x2a1040, ground: 0x100518, intensity: 0.5 },
    key: { color: 0x6a3aa0, intensity: 0.4, pos: [6, 10, 10] },
    warm: { color: 0xff3fa4, intensity: 60 },
    cool: { color: 0x9d6bff, intensity: 60 },
    accent: { color: 0xff3fa4, intensity: 90 },
    fog: { color: 0x0a0512, density: 0.018 },
    exposure: 1.05,
    pulse: { light: 'accent', speed: 4.4 },
  },
  fireplace_warm: {
    hemi: { sky: 0x2a1a10, ground: 0x0e0806, intensity: 0.5 },
    key: { color: 0x554433, intensity: 0.2, pos: [6, 10, 10] },
    warm: { color: 0xff8833, intensity: 110 },
    cool: { color: 0x1a1208, intensity: 4 },
    accent: { color: 0xd06a2a, intensity: 20 },
    fog: { color: 0x0a0604, density: 0.016 },
    exposure: 1.05,
    pulse: { light: 'warm', speed: 7.3, depth: 0.15 },
  },
  security_red: {
    hemi: { sky: 0x2a1014, ground: 0x0a0406, intensity: 0.55 },
    key: { color: 0xaa4444, intensity: 0.45, pos: [6, 10, 10] },
    warm: { color: 0xff6a5c, intensity: 30 },
    cool: { color: 0x3a1a20, intensity: 10 },
    accent: { color: 0xff3040, intensity: 60 },
    fog: { color: 0x0c0508, density: 0.02 },
    exposure: 0.95,
  },
  morning_haze: {
    hemi: { sky: 0x8a8a7e, ground: 0x2a2822, intensity: 1.4 },
    key: { color: 0xfff2dc, intensity: 1.8, pos: [10, 7, 9] },
    warm: { color: 0xffe0b0, intensity: 30 },
    cool: { color: 0xb0c4d0, intensity: 16 },
    accent: { color: 0xc8b090, intensity: 12 },
    fog: { color: 0x1c1e1e, density: 0.024 },
    exposure: 1.1,
  },
};

/** time-of-day keyframes over dayFraction (0 = midnight) — modulates the key
 *  light + hemisphere when the active preset is tod-aware (neon_night). */
const TOD_KEYS = [
  { t: 0.00, key: { color: 0xbfd8ff, i: 1.1 }, hemi: 1.0, exp: 1.0 },
  { t: 0.22, key: { color: 0xbfd8ff, i: 1.0 }, hemi: 1.0, exp: 1.0 },
  { t: 0.28, key: { color: 0xffb0a0, i: 1.5 }, hemi: 1.4, exp: 1.05 },   // dawn
  { t: 0.42, key: { color: 0xf0f4ff, i: 2.6 }, hemi: 2.1, exp: 1.15 },   // morning
  { t: 0.58, key: { color: 0xffffff, i: 2.9 }, hemi: 2.3, exp: 1.18 },   // midday
  { t: 0.72, key: { color: 0xffc890, i: 2.0 }, hemi: 1.7, exp: 1.1 },    // late pm
  { t: 0.79, key: { color: 0xff9a5c, i: 1.6 }, hemi: 1.3, exp: 1.05 },   // dusk
  { t: 0.86, key: { color: 0xbfd8ff, i: 1.1 }, hemi: 1.0, exp: 1.0 },    // night
  { t: 1.00, key: { color: 0xbfd8ff, i: 1.1 }, hemi: 1.0, exp: 1.0 },
];

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

    stage.scene.add(this.hemi, this.key, this.key.target, this.warm, this.cool, this.accent);
    stage.scene.fog = new THREE.FogExp2(0x06070c, 0.016);

    this.presetId = 'neon_night';
    /** @type {LightPreset} */
    this._target = PRESETS.neon_night;
    this._fadeT = 1;
    this._fadeDur = 1;
    this._from = null;
    this._t = 0;
    this._floorOffset = 0;
    this._basePositions = {
      key: this.key.position.clone(),
      warm: this.warm.position.clone(),
      cool: this.cool.position.clone(),
      accent: this.accent.position.clone(),
    };
    /** @type {import('../core/clock.js').GameClock|null} set by the app for ToD */
    this.clock = null;
  }

  /** shift the light kit to another floor's world offset */
  setFloorOffset(offsetX) {
    this._floorOffset = offsetX;
    for (const name of ['key', 'warm', 'cool', 'accent']) {
      this[name].position.copy(this._basePositions[name]);
      this[name].position.x += offsetX;
    }
    if (this.key.target) {
      this.key.target.position.set(offsetX, 0, 0);
      this.key.target.updateMatrixWorld();
    }
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
    // time-of-day modulation (only the tod-aware baseline preset)
    if (this.presetId === 'neon_night' && this.clock && this._fadeT >= 1) {
      const f = this.clock.dayFraction;
      let a = TOD_KEYS[0], b = TOD_KEYS[TOD_KEYS.length - 1];
      for (let i = 0; i < TOD_KEYS.length - 1; i++) {
        if (f >= TOD_KEYS[i].t && f <= TOD_KEYS[i + 1].t) { a = TOD_KEYS[i]; b = TOD_KEYS[i + 1]; break; }
      }
      const k = b.t > a.t ? (f - a.t) / (b.t - a.t) : 0;
      this.key.color.setHex(a.key.color).lerp(new THREE.Color(b.key.color), k);
      this.key.intensity = THREE.MathUtils.lerp(a.key.i, b.key.i, k);
      this.hemi.intensity = PRESETS.neon_night.hemi.intensity * THREE.MathUtils.lerp(a.hemi, b.hemi, k);
      this.stage.renderer.toneMappingExposure =
        PRESETS.neon_night.exposure * THREE.MathUtils.lerp(a.exp, b.exp, k);
    }

    // pulse effects (strobes, candle flicker, lightning)
    const pulse = this._target.pulse;
    if (pulse && this._fadeT >= 1) {
      const base = this._target[pulse.light].intensity;
      if (pulse.lightning) {
        // rare flash bursts
        if (this._lightningT == null || this._t > this._lightningT) {
          this._lightningT = this._t + 4 + Math.random() * 9;
          this._lightningEnd = this._t + 0.25;
        }
        const flash = this._t < this._lightningEnd ? pulse.depth : 0;
        this[pulse.light].intensity = base * (1 + flash * Math.random());
      } else {
        const depth = pulse.depth ?? 0.45;
        this[pulse.light].intensity =
          base * (1 - depth + depth * Math.abs(Math.sin(this._t * pulse.speed)));
      }
    }
  }
}
