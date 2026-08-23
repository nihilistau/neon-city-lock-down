// @ts-check
// Scene lighting: a fixed light kit whose parameters lerp between presets. The
// 11 presets + time-of-day keyframes are config data (config/lighting.yaml →
// data/lightingPresets.js); apply() reads the live values via cfg() so retints
// hot-reload. See docs/config/lighting.md.
import * as THREE from 'three';
import { PALETTE } from './materials/palette.js';
import { cfg } from '../core/config.js';
import { LIGHTING_PRESETS, TOD_KEYS } from '../../data/lightingPresets.js';
import { EnvBuilder } from './env.js';

/** Static default presets (back-compat export); live values come from cfg('lighting.presets'). */
export const PRESETS = LIGHTING_PRESETS;

// Scratch colour for every lerp target below. `Color.lerp` only READS its
// argument, so one reused instance is safe and correct. This used to be a fresh
// `new THREE.Color(to)` per call: 7 allocations per frame for the whole duration
// of any fade, plus one per frame FOREVER via the time-of-day path — which runs
// unconditionally while presetId === 'neon_night', i.e. essentially always.
const _lerpTo = new THREE.Color();
const presets = () => cfg('lighting.presets', LIGHTING_PRESETS);
// need ≥2 keyframes to interpolate; a malformed/empty config tod falls back to the default
const todKeys = () => { const t = cfg('lighting.tod', TOD_KEYS); return Array.isArray(t) && t.length >= 2 ? t : TOD_KEYS; };

export class Lighting {
  /** @param {import('./stage.js').Stage} stage */
  constructor(stage) {
    this.stage = stage;
    this.hemi = new THREE.HemisphereLight(0x2a4a8a, 0x141020, 1.1);
    this.key = new THREE.DirectionalLight(0xbfd8ff, 1.1);
    this.key.position.set(6, 10, 10);
    this.key.castShadow = true;
    const mapSize = cfg('render.shadowMapSize', 2048);
    this.key.shadow.mapSize.set(mapSize, mapSize);
    // The penthouse spans x -13.75..7.75; the old +/-12 frustum did not reach the
    // west-wing bed alcove, so nothing there cast or received a shadow at all.
    this.key.shadow.camera.left = -18; this.key.shadow.camera.right = 14;
    this.key.shadow.camera.top = 14; this.key.shadow.camera.bottom = -14;
    this.key.shadow.camera.near = 0.5;
    this.key.shadow.camera.far = 44;
    // no bias was set at all, which is what produced the acne + peter-panning
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.022;

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
    this._target = presets().neon_night;
    this._fadeT = 1;
    this._fadeDur = 1;
    this._from = null;
    this._t = 0;
    this._floorOffset = 0;
    this._floorFogMul = 1;
    this._floorFogHex = null;
    this._basePositions = {
      key: this.key.position.clone(),
      warm: this.warm.position.clone(),
      cool: this.cool.position.clone(),
      accent: this.accent.position.clone(),
    };
    /** @type {import('../core/clock.js').GameClock|null} set by the app for ToD */
    this.clock = null;

    // Image-based lighting, derived from each preset's own palette so a retint
    // also changes what the room's chrome, glass, skin and hair reflect.
    this.env = new EnvBuilder(stage.renderer);
    this._applyEnv('neon_night');
  }

  /**
   * Scale a preset's authored hemisphere intensity.
   *
   * The 10 presets were authored with NO environment map, so their hemisphere
   * light was standing in for all ambient bounce. Now that IBL supplies real
   * ambient, applying both double-counts it — the penthouse went flat and beige
   * and lost its noir contrast. Rather than re-author every preset (which would
   * throw away their hand-tuned relative balance), scale only the pure-ambient
   * term and leave the authored key/fill/accent alone.
   * @param {number} v
   */
  _hemi(v) {
    return v * cfg('lighting.hemiScale', 0.45);
  }

  /**
   * Swap in the prefiltered environment for a preset. Not cross-faded — PMREM
   * textures can't blend, and the reflection change reads as a natural cut.
   * @param {string} id
   */
  _applyEnv(id) {
    const p = presets()[id];
    if (!p) return;
    try {
      this.stage.scene.environment = this.env.get(id, {
        sky: p.fog?.color ?? 0x05070f,
        horizon: p.hemi?.sky ?? 0x1b2a55,
        ground: p.hemi?.ground ?? 0x07060a,
        signs: [p.cool?.color ?? 0x39e6ff, p.accent?.color ?? 0xff3fa4, p.warm?.color ?? 0xffb347],
        intensity: THREE.MathUtils.clamp(p.hemi?.intensity ?? 1, 0.12, 2),
      });
      // reflections should not overpower the authored key/fill balance
      this.stage.scene.environmentIntensity = cfg('lighting.envIntensity', 0.4);
      this.hemi.intensity = this._hemi(p.hemi?.intensity ?? this.hemi.intensity);
    } catch (err) {
      // IBL is an enhancement, never a boot blocker
      console.warn('[lighting] env map build failed', err);
    }
  }

  /**
   * Per-floor fog bias. Applied after preset/ToD so a basement reads denser
   * than the penthouse without rewriting lighting.yaml.
   * @param {string} floorId
   */
  setFloorLook(floorId) {
    const look = {
      penthouse: { mul: 1, hex: null },
      rooftop: { mul: 0.72, hex: 0x1a1024 },
      fl40: { mul: 1.28, hex: 0x1a080c },
      fl27: { mul: 1.18, hex: 0x061018 },
      fl12: { mul: 1.08, hex: 0x101820 },
      ground: { mul: 0.9, hex: 0x0a1018 },
      basement: { mul: 1.7, hex: 0x08070a },
    }[floorId] || { mul: 1, hex: null };
    this._floorFogMul = look.mul;
    this._floorFogHex = look.hex;
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
    const preset = presets()[id];
    if (!preset) throw new Error(`unknown lighting preset: ${id}`);
    this._from = this._snapshot();
    this._target = preset;
    this.presetId = id;
    this._fadeT = 0;
    this._fadeDur = Math.max(0.01, fadeSec);
    this._applyEnv(id);
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
      // `light[prop]` is never `_lerpTo`, so setHex-then-lerp cannot self-alias
      const lerpColor = (light, prop, from, to) => light[prop].setHex(from).lerp(_lerpTo.setHex(to), k);
      lerpColor(this.hemi, 'color', a.hemi.sky, b.hemi.sky);
      lerpColor(this.hemi, 'groundColor', a.hemi.ground, b.hemi.ground);
      this.hemi.intensity = this._hemi(THREE.MathUtils.lerp(a.hemi.intensity, b.hemi.intensity, k));
      lerpColor(this.key, 'color', a.key.color, b.key.color);
      this.key.intensity = THREE.MathUtils.lerp(a.key.intensity, b.key.intensity, k);
      for (const name of ['warm', 'cool', 'accent']) {
        lerpColor(this[name], 'color', a[name].color, b[name].color);
        this[name].intensity = THREE.MathUtils.lerp(a[name].intensity, b[name].intensity, k);
      }
      this.stage.scene.fog.color.setHex(a.fog.color).lerp(_lerpTo.setHex(b.fog.color), k);
      this.stage.scene.fog.density = THREE.MathUtils.lerp(a.fog.density, b.fog.density, k) * this._floorFogMul;
      this.stage.renderer.toneMappingExposure = THREE.MathUtils.lerp(a.exposure, b.exposure, k);
    }
    // time-of-day modulation (only the tod-aware baseline preset)
    if (this.presetId === 'neon_night' && this.clock && this._fadeT >= 1) {
      const f = this.clock.dayFraction;
      const TOD = todKeys();
      let a = TOD[0], b = TOD[TOD.length - 1];
      for (let i = 0; i < TOD.length - 1; i++) {
        if (f >= TOD[i].t && f <= TOD[i + 1].t) { a = TOD[i]; b = TOD[i + 1]; break; }
      }
      const k = b.t > a.t ? (f - a.t) / (b.t - a.t) : 0;
      this.key.color.setHex(a.key.color).lerp(_lerpTo.setHex(b.key.color), k);
      this.key.intensity = THREE.MathUtils.lerp(a.key.i, b.key.i, k);
      const neon = presets().neon_night;
      this.hemi.intensity = this._hemi(neon.hemi.intensity * THREE.MathUtils.lerp(a.hemi, b.hemi, k));
      this.stage.renderer.toneMappingExposure = neon.exposure * THREE.MathUtils.lerp(a.exp, b.exp, k);
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

    if (this._fadeT >= 1 && this.stage.scene.fog) {
      const base = this._target.fog?.density ?? this.stage.scene.fog.density;
      this.stage.scene.fog.density = base * this._floorFogMul;
      if (this._floorFogHex != null) this.stage.scene.fog.color.setHex(this._floorFogHex);
    }
  }
}
