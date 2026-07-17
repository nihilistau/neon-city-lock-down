// @ts-check
// Pose/clip runtime. Clips are authored as sparse euler-degree keyframes per bone
// (see data/poses/*). At load they compile to quaternion tracks for cheap sampling.
import * as THREE from 'three';

/** @type {Map<string, CompiledClip>} */
export const clipRegistry = new Map();

const _e = new THREE.Euler();

/**
 * @typedef {Object} ClipDef
 * @property {string} id
 * @property {number} [duration]   seconds; 0/undefined = static pose
 * @property {'loop'|'hold'|'pingpong'} [loop]
 * @property {boolean} [tempoScaled] playback rate scales with arousal/energy
 * @property {Record<string, [number,number,number]>} [bones]  static eulers (deg)
 * @property {Record<string, Array<[number, [number,number,number]]>>} [tracks] keyed eulers (deg)
 * @property {Array<[number, [number,number,number]]>} [hipsPos] hips position offset keys (meters)
 */

export class CompiledClip {
  /** @param {ClipDef} def */
  constructor(def) {
    this.id = def.id;
    this.duration = def.duration || 0;
    this.loop = def.loop || (this.duration > 0 ? 'loop' : 'hold');
    this.tempoScaled = !!def.tempoScaled;
    /** @type {Map<string, {times:number[], quats:THREE.Quaternion[]}>} */
    this.tracks = new Map();
    /** @type {{times:number[], vecs:THREE.Vector3[]}|null} */
    this.hipsPos = null;

    const toQuat = (deg) => {
      _e.set(
        THREE.MathUtils.degToRad(deg[0]),
        THREE.MathUtils.degToRad(deg[1]),
        THREE.MathUtils.degToRad(deg[2]),
        'XYZ'
      );
      return new THREE.Quaternion().setFromEuler(_e);
    };

    if (def.bones) {
      for (const [bone, deg] of Object.entries(def.bones)) {
        this.tracks.set(bone, { times: [0], quats: [toQuat(deg)] });
      }
    }
    if (def.tracks) {
      for (const [bone, keys] of Object.entries(def.tracks)) {
        this.tracks.set(bone, {
          times: keys.map((k) => k[0]),
          quats: keys.map((k) => toQuat(k[1])),
        });
      }
    }
    if (def.hipsPos) {
      this.hipsPos = {
        times: def.hipsPos.map((k) => k[0]),
        vecs: def.hipsPos.map((k) => new THREE.Vector3(...k[1])),
      };
    }
  }

  /** wrap time by loop mode → sample position in [0, duration] */
  wrap(t) {
    if (this.duration <= 0) return 0;
    switch (this.loop) {
      case 'hold': return Math.min(t, this.duration);
      case 'pingpong': {
        const c = t % (this.duration * 2);
        return c < this.duration ? c : this.duration * 2 - c;
      }
      default: return t % this.duration;
    }
  }

  /**
   * Sample a bone track into `out`. Returns false if the clip has no track for it.
   * @param {string} bone @param {number} t @param {THREE.Quaternion} out
   */
  sample(bone, t, out) {
    const track = this.tracks.get(bone);
    if (!track) return false;
    const { times, quats } = track;
    if (times.length === 1) { out.copy(quats[0]); return true; }
    const tt = this.wrap(t);
    let i = 0;
    while (i < times.length - 1 && times[i + 1] < tt) i++;
    const t0 = times[i], t1 = times[i + 1] ?? this.duration;
    const q0 = quats[i], q1 = quats[i + 1] ?? quats[0];
    let f = t1 > t0 ? (tt - t0) / (t1 - t0) : 0;
    f = f * f * (3 - 2 * f); // smoothstep easing between keys
    out.copy(q0).slerp(q1, f);
    return true;
  }

  /** @param {number} t @param {THREE.Vector3} out @returns {boolean} */
  sampleHips(t, out) {
    if (!this.hipsPos) return false;
    const { times, vecs } = this.hipsPos;
    if (times.length === 1) { out.copy(vecs[0]); return true; }
    const tt = this.wrap(t);
    let i = 0;
    while (i < times.length - 1 && times[i + 1] < tt) i++;
    const t0 = times[i], t1 = times[i + 1] ?? this.duration;
    let f = t1 > t0 ? (tt - t0) / (t1 - t0) : 0;
    f = f * f * (3 - 2 * f);
    out.copy(vecs[i]).lerp(vecs[i + 1] ?? vecs[0], f);
    return true;
  }
}

/**
 * Register clip definitions (called by data modules at import).
 * @param {ClipDef[]} defs
 */
export function registerClips(defs) {
  for (const def of defs) {
    if (clipRegistry.has(def.id)) throw new Error(`duplicate clip id: ${def.id}`);
    clipRegistry.set(def.id, new CompiledClip(def));
  }
}

/** @param {string} id */
export function getClip(id) {
  const c = clipRegistry.get(id);
  if (!c) throw new Error(`unknown clip: ${id}`);
  return c;
}
