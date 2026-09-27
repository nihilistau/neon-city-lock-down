// @ts-check
// The named surface library every shell and furniture piece draws from.
//
// HYBRID. A material is built from a Poly Haven PBR set when the asset pipeline
// has one decoded (src/assets/assets.js), and from the canvas generators in
// texGen.js when it does not — a missing file, `?noassets=1`, or a Node test all
// get the procedural surface the game shipped with, never an untextured box.
//
// Every material carries `userData.metresPerRepeat`. src/scene3d/materials/
// worldUV.js rewrites box UVs to one repeat per that many metres, so a 2.4 m
// counter and a 0.3 m shelf show their grain at the same scale — which is also
// why every texture here tiles at repeat 1.
import * as THREE from 'three';
import { concreteTex, tileTex, metalTex, woodTex, marbleTex, fabricTex, surfaced } from './texGen.js';

/**
 * @typedef {object} PbrSpec
 * @property {string|null} set  Poly Haven set id in assets/manifest.json; null = procedural only
 * @property {number} metresPerRepeat
 * @property {string} tint  the canvas tint for the fallback; × gain, the colour multiplier on a loaded set
 * @property {number} gain  linear lift for `tint` on a loaded set. A photographed albedo averages
 *   ~0.2-0.5 linear while the canvas swatch IS the final colour, so the bare tint would crush a
 *   loaded set to black
 * @property {[number, number, number]} [balance]  per-channel multiplier on a loaded set's colour,
 *   for a scan whose own cast fights the tint (the fallback canvas IS the tint, so it never needs one)
 * @property {number} roughness  fallback roughness (a loaded set takes it from its ORM map)
 * @property {number} metalness  metalness; ignored when the set has a metal channel
 * @property {number} normalScale
 * @property {number} relief  Sobel strength for the fallback's derived normal map
 * @property {(tint:string) => THREE.CanvasTexture} canvas  the procedural albedo, at repeat 1
 */

/** @type {Record<string, PbrSpec>} */
export const PBR_LIBRARY = {
  concrete: { set: 'smooth_concrete_floor', metresPerRepeat: 2.5, tint: '#181c2a', gain: 18, roughness: 0.85, metalness: 0, normalScale: 0.8, relief: 1.6, canvas: (t) => concreteTex(t, 1) },
  concreteFloor: { set: 'concrete_floor_worn_001', metresPerRepeat: 2.0, tint: '#12151f', gain: 13, roughness: 0.82, metalness: 0, normalScale: 0.8, relief: 1.6, canvas: (t) => concreteTex(t, 1) },
  metal: { set: 'metal_plate_02', metresPerRepeat: 1.0, tint: '#2a3040', gain: 14, roughness: 0.4, metalness: 0.7, normalScale: 0.35, relief: 1.2, canvas: (t) => metalTex(t, 1) },
  metalDark: { set: 'painted_metal_shutter', metresPerRepeat: 1.2, tint: '#151923', gain: 4.5, roughness: 0.5, metalness: 0.6, normalScale: 0.4, relief: 1.2, canvas: (t) => metalTex(t, 1) },
  tile: { set: 'floor_tiles_08', metresPerRepeat: 2.4, tint: '#11141f', gain: 5, roughness: 0.35, metalness: 0.15, normalScale: 1.0, relief: 2.2, canvas: (t) => tileTex(t, '#05060a', 4, 1) },
  marble: { set: 'marble_01', metresPerRepeat: 1.5, tint: '#353b4a', gain: 3, roughness: 0.25, metalness: 0.1, normalScale: 0.25, relief: 0.9, canvas: (t) => marbleTex(t, 1) },
  // the plank scan averages 6:2:1 red:green:blue; with the tint's own warmth on top it read as red
  // lacquer, so the balance pulls it back to brown (gain re-matched to the tint's luminance)
  wood: { set: 'plank_flooring_04', metresPerRepeat: 1.8, tint: '#2b1e18', gain: 40, balance: [0.6, 1.2, 1.6], roughness: 0.7, metalness: 0, normalScale: 0.7, relief: 1.8, canvas: (t) => woodTex(t, 1) },
  fabric: { set: 'dirty_carpet', metresPerRepeat: 0.8, tint: '#2c2434', gain: 33, roughness: 0.9, metalness: 0, normalScale: 0.6, relief: 1.1, canvas: (t) => fabricTex(t, 1) },
  // the quilt weave reads better than any carpet scan at bed scale; procedural by choice
  bedding: { set: null, metresPerRepeat: 0.6, tint: '#3a3348', gain: 1, roughness: 0.95, metalness: 0, normalScale: 0.6, relief: 1.1, canvas: (t) => fabricTex(t, 1) },
  rust: { set: 'rusty_metal_02', metresPerRepeat: 1.2, tint: '#3a4038', gain: 3, roughness: 0.6, metalness: 0.5, normalScale: 0.5, relief: 1.0, canvas: (t) => metalTex(t, 1) },
};

/** Every Poly Haven set the library can use — World3D preloads these before building. */
export const PBR_SET_IDS = [...new Set(Object.values(PBR_LIBRARY).map((s) => s.set).filter((s) => typeof s === 'string'))];

/** @type {Map<string, THREE.MeshStandardMaterial>} */
const cache = new Map();
/** @type {{peekPBR:(id:string) => any}|null} */
let assets = null;

/**
 * Point the library at an asset facade (World3D does this before it builds).
 * Clears the cache: a material built against the old source must not leak into
 * a world built against the new one.
 * @param {{peekPBR:(id:string) => any}|null} facade
 */
export function setPbrAssets(facade) {
  if (facade === assets) return;
  assets = facade;
  cache.clear();
}

/** Test hook: forget the facade and every cached material. */
export function _resetPbrLibrary() {
  assets = null;
  cache.clear();
}

/**
 * `tint` × `gain` in linear space, clamped to 1.
 * @param {string} tint @param {number} gain
 */
export function pbrTint(tint, gain) {
  const c = new THREE.Color(tint).multiplyScalar(gain);
  return c.setRGB(Math.min(1, c.r), Math.min(1, c.g), Math.min(1, c.b));
}

/**
 * @param {THREE.Color} c @param {[number, number, number]|undefined} b
 */
function balanced(c, b) {
  if (!b) return c;
  return c.setRGB(Math.min(1, c.r * b[0]), Math.min(1, c.g * b[1]), Math.min(1, c.b * b[2]));
}

/**
 * The shared material for a library surface. Identical requests return the
 * same instance (one program, better batching, and — from rc.1 — mergeable).
 * @param {string} name a PBR_LIBRARY key
 * @param {{tint?:string, roughness?:number, metalness?:number}} [o]
 * @returns {THREE.MeshStandardMaterial}
 */
export function pbrMaterial(name, o = {}) {
  const spec = PBR_LIBRARY[name];
  if (!spec) throw new Error(`unknown PBR material "${name}" (have: ${Object.keys(PBR_LIBRARY).join(', ')})`);
  const tint = o.tint ?? spec.tint;
  const roughness = o.roughness ?? spec.roughness;
  const metalness = o.metalness ?? spec.metalness;
  const key = `${name}|${tint}|${roughness}|${metalness}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const set = spec.set ? assets?.peekPBR(spec.set) ?? null : null;
  /** @type {THREE.MeshStandardMaterial} */
  let m;
  if (set) {
    m = new THREE.MeshStandardMaterial({
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(spec.normalScale, spec.normalScale),
      roughnessMap: set.roughnessMap,
      aoMap: set.aoMap,
      metalnessMap: set.metalnessMap,
      color: balanced(pbrTint(tint, spec.gain), spec.balance),
      roughness: 1,                               // the ORM G channel IS the roughness; the scalar multiplies it
      metalness: set.metalnessMap ? 1 : metalness,
    });
  } else {
    m = new THREE.MeshStandardMaterial({ ...surfaced(spec.canvas(tint), spec.relief, spec.normalScale), roughness, metalness });
  }
  m.name = `pbr:${name}`;
  m.userData.pbr = name;
  m.userData.source = set ? 'pbr' : 'procedural';
  m.userData.metresPerRepeat = spec.metresPerRepeat;
  cache.set(key, m);
  return m;
}
