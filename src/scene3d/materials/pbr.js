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
import { patchReflectBoost, GLOSSY_REFLECT } from './reflectBoost.js';
import { concreteTex, tileTex, metalTex, woodTex, marbleTex, fabricTex, surfaced } from './texGen.js';

/**
 * @typedef {object} PbrSpec
 * @property {string|null} set  Poly Haven set id in assets/manifest.json; null = procedural only
 * @property {number} metresPerRepeat
 * @property {string} tint  the surface's mean colour. The fallback canvas is painted in it; a loaded
 *   set is divided by its own measured albedo so the scan averages to it too (see pbrColor)
 * @property {[number, number, number]} [albedo]  the set's measured mean LINEAR albedo (its _diff.jpg,
 *   decoded from sRGB). Required when `set` is non-null
 * @property {number} [scanRoughness]  mean of the set's ORM G channel. The authored roughness is a
 *   target mean, so a loaded set's scalar is `roughness / scanRoughness`
 * @property {number} [scanMetalness]  mean of the ORM B channel, for a set whose manifest entry has
 *   `hasMetal`; the authored metalness is a target mean the same way
 * @property {number} roughness  the surface's mean roughness (procedural: the scalar itself)
 * @property {number} metalness  the surface's mean metalness
 * @property {number} normalScale  normal strength for the fallback's Sobel-derived normal map
 * @property {number} [scanNormalScale]  normal strength for a loaded set's own normal map (default normalScale)
 * @property {boolean} [rotate]  swap U and V in the world-UV pass: the plank scan's boards run along V,
 *   and box projection puts V up the side faces, so without this every panel was vertical slats
 * @property {boolean} [glossy]  polished architecture (stone, tile, metal): mirrors the city harder
 *   than the scene's env intensity allows (materials/reflectBoost.js). Never skin, hair or cloth
 * @property {number} relief  Sobel strength for the fallback's derived normal map
 * @property {(tint:string) => THREE.CanvasTexture} canvas  the procedural albedo, at repeat 1
 */

// albedo / scanRoughness / scanMetalness are MEASURED from the 1K files in assets/pbr/ (mean over a
// 256x256 downsample; albedo decoded sRGB to linear). Re-measure if a set is re-fetched.
/** @type {Record<string, PbrSpec>} */
export const PBR_LIBRARY = {
  concrete: { set: 'smooth_concrete_floor', albedo: [0.092, 0.046, 0.022], scanRoughness: 0.68, metresPerRepeat: 2.5, tint: '#181c2a', roughness: 0.85, metalness: 0, normalScale: 0.8, relief: 1.6, canvas: (t) => concreteTex(t, 1) },
  concreteFloor: { set: 'concrete_floor_worn_001', albedo: [0.093, 0.094, 0.089], scanRoughness: 0.54, metresPerRepeat: 2.0, tint: '#12151f', roughness: 0.82, metalness: 0, normalScale: 0.8, relief: 1.6, canvas: (t) => concreteTex(t, 1) },
  metal: { set: 'metal_plate_02', albedo: [0.090, 0.066, 0.049], scanRoughness: 0.66, scanMetalness: 0.91, metresPerRepeat: 1.0, tint: '#2a3040', roughness: 0.4, metalness: 0.7, glossy: true, normalScale: 0.35, relief: 1.2, canvas: (t) => metalTex(t, 1) },
  metalDark: { set: 'painted_metal_shutter', albedo: [0.217, 0.229, 0.241], scanRoughness: 0.63, metresPerRepeat: 1.2, tint: '#151923', roughness: 0.5, metalness: 0.6, glossy: true, normalScale: 0.4, relief: 1.2, canvas: (t) => metalTex(t, 1) },
  // 6 m per repeat = 1.5 m slabs (the scan is 4x4): the penthouse reads as large polished stone,
  // not a kitchen. The scan's grout relief is deep, so its normal is damped; the canvas keeps 1.0
  tile: { set: 'floor_tiles_08', albedo: [0.248, 0.182, 0.130], scanRoughness: 0.51, metresPerRepeat: 6.0, tint: '#11141f', roughness: 0.35, metalness: 0.15, glossy: true, normalScale: 1.0, scanNormalScale: 0.35, relief: 2.2, canvas: (t) => tileTex(t, '#05060a', 4, 1) },
  // marble_01 is travertine BLOCKS, not veined marble: tables and the fireplace read as masonry and
  // lost their gloss. The canvas veining at roughness 0.25 is the look; procedural by choice
  marble: { set: null, metresPerRepeat: 1.5, tint: '#353b4a', roughness: 0.25, metalness: 0.1, glossy: true, normalScale: 0.25, relief: 0.9, canvas: (t) => marbleTex(t, 1) },
  wood: { set: 'plank_flooring_04', albedo: [0.055, 0.018, 0.009], scanRoughness: 0.40, rotate: true, metresPerRepeat: 1.8, tint: '#2b1e18', roughness: 0.7, metalness: 0, normalScale: 0.7, relief: 1.8, canvas: (t) => woodTex(t, 1) },
  fabric: { set: 'dirty_carpet', albedo: [0.037, 0.030, 0.019], scanRoughness: 0.81, metresPerRepeat: 0.8, tint: '#2c2434', roughness: 0.9, metalness: 0, normalScale: 0.6, relief: 1.1, canvas: (t) => fabricTex(t, 1) },
  // the quilt weave reads better than any carpet scan at bed scale; procedural by choice
  bedding: { set: null, metresPerRepeat: 0.6, tint: '#3a3348', roughness: 0.95, metalness: 0, normalScale: 0.6, relief: 1.1, canvas: (t) => fabricTex(t, 1) },
  rust: { set: 'rusty_metal_02', albedo: [0.413, 0.288, 0.136], scanRoughness: 0.42, metresPerRepeat: 1.2, tint: '#3a4038', roughness: 0.6, metalness: 0.5, normalScale: 0.5, relief: 1.0, canvas: (t) => metalTex(t, 1) },
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
 * The colour multiplier that makes a loaded set AVERAGE to `tint`: the tint in
 * linear space divided, per channel, by the scan's own mean albedo. A scan keeps
 * its detail (grain, grout, grime) but loses its cast, so a brown concrete scan
 * under a cool wall tint reads cool, and the clinic's pale tile reads pale: the
 * palette stays the one the canvases were designed in. Not clamped at 1 (a dark
 * scan needs a large multiplier); capped so no channel's mean exceeds 0.9.
 * @param {string} tint @param {[number, number, number]} albedo
 */
export function pbrColor(tint, albedo) {
  const c = new THREE.Color(tint);
  return c.setRGB(Math.min(c.r, 0.9) / albedo[0], Math.min(c.g, 0.9) / albedo[1], Math.min(c.b, 0.9) / albedo[2]);
}

/**
 * The shared material for a library surface. Identical requests return the
 * same instance (one program, better batching, and — from rc.1 — mergeable).
 *
 * SHARED: never mutate the returned material (colour, emissive, opacity...). Every
 * mesh on every floor drawing that surface would change with it. Clone it for a
 * one-off, or swap a per-mesh copy in and out the way the picker's hover glow
 * does (src/scene3d/picking.js setPickGlow).
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
      normalScale: new THREE.Vector2(spec.scanNormalScale ?? spec.normalScale, spec.scanNormalScale ?? spec.normalScale),
      roughnessMap: set.roughnessMap,
      aoMap: set.aoMap,
      metalnessMap: set.metalnessMap,
      color: pbrColor(tint, /** @type {[number, number, number]} */ (spec.albedo)),
      // the ORM channels carry the variation and the scalar multiplies them, so
      // authored / measured-mean makes the surface AVERAGE what was authored:
      // a 0.2 gloss floor override actually lands glossy
      roughness: Math.min(1, roughness / (spec.scanRoughness ?? 1)),
      metalness: set.metalnessMap ? Math.min(1, metalness / (spec.scanMetalness ?? 1)) : metalness,
    });
  } else {
    m = new THREE.MeshStandardMaterial({ ...surfaced(spec.canvas(tint), spec.relief, spec.normalScale), roughness, metalness });
  }
  m.name = `pbr:${name}`;
  m.userData.pbr = name;
  m.userData.source = set ? 'pbr' : 'procedural';
  m.userData.metresPerRepeat = spec.metresPerRepeat;
  if (spec.rotate) m.userData.uvRotate = true;   // read by materials/worldUV.js
  if (spec.glossy) patchReflectBoost(m, GLOSSY_REFLECT);
  cache.set(key, m);
  return m;
}
