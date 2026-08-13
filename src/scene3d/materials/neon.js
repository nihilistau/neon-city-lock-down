// @ts-check
// Real neon runs: an emissive glass tube wrapped in an additive halo sleeve,
// with optional light spill onto nearby surfaces.
//
// WHY THIS EXISTS
// The old trim was `BoxGeometry(w, 0.04, 0.05)` — a 4cm x 5cm slab. At any
// distance that is a sub-pixel-thin quad, so it shimmered on and off between
// frames and read as a z-fighting artifact slicing across the screen rather
// than as a light source. A tube has a silhouette that survives minification,
// and the halo sleeve gives the eye the soft falloff that sells "this thing is
// glowing" even before bloom touches it.
import * as THREE from 'three';

/**
 * UnrealBloomPass threshold (see postfx.js). The bloom pass runs on linear HDR
 * BEFORE OutputPass, so a surface only blooms when emissive x emissiveIntensity
 * clears this. Anything below it is just a coloured tube that never glows.
 */
export const BLOOM_THRESHOLD = 0.86;

/** Core brightness. Comfortably over threshold so the tube always has a hot centre. */
const CORE_INTENSITY = 2.4;
/** Halo opacity — additive, so this stacks with the core rather than hiding it. */
const HALO_OPACITY = 0.16;
/** Halo radius as a multiple of the tube radius. */
const HALO_SCALE = 3.4;

/**
 * Additive halo sleeves are OFF by default, and should stay that way while the
 * bloom pass is enabled.
 *
 * They double-count the glow: UnrealBloomPass already produces the soft falloff
 * the sleeve is faking, but the sleeve puts its contribution into the linear HDR
 * buffer *before* bloom reads it. Every run then stacks additively, bloom
 * amplifies the sum, and with enough runs on screen the whole frame washes to
 * white — which is exactly what happened, and why raising the bloom threshold
 * did not help (the input was already enormous, so even a small pass fraction
 * was overwhelming).
 *
 * Emissive core + bloom is the correct pairing. Only turn a halo on for a run
 * that must glow with bloom disabled.
 */
const HALO_DEFAULT = false;

/** @type {Map<string, THREE.CylinderGeometry>} */
const geoCache = new Map();
/** @type {Map<string, THREE.Material>} */
const matCache = new Map();

/** Unit-length tube along +Y, scaled per instance so one geometry serves every run. */
function tubeGeo(radius, segments) {
  const key = `${radius}:${segments}`;
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = new THREE.CylinderGeometry(radius, radius, 1, segments, 1, true)));
  return g;
}

function coreMat(color, intensity) {
  const key = `core:${color}:${intensity}`;
  let m = matCache.get(key);
  if (!m) {
    matCache.set(key, (m = new THREE.MeshStandardMaterial({
      // near-black base so the tube reads as dark glass when the power is out,
      // and so ONLY the emissive term drives the bloom
      color: 0x0b0b10,
      emissive: new THREE.Color(color),
      emissiveIntensity: intensity,
      roughness: 0.25,
      metalness: 0,
    })));
  }
  return m;
}

function haloMat(color) {
  const key = `halo:${color}`;
  let m = matCache.get(key);
  if (!m) {
    matCache.set(key, (m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: HALO_OPACITY,
      blending: THREE.AdditiveBlending,
      // additive + depthWrite would punch a hole in everything drawn after it
      depthWrite: false,
      side: THREE.BackSide,   // seen from outside, so render the far wall of the sleeve
    })));
  }
  return m;
}

/**
 * Add a neon run to `parent`.
 *
 * @param {THREE.Object3D} parent
 * @param {Object} o
 * @param {number} o.length run length along `axis`, in metres
 * @param {'x'|'y'|'z'} [o.axis] which world axis the tube runs along
 * @param {number} [o.x] @param {number} [o.y] @param {number} [o.z] centre of the run
 * @param {number} o.color
 * @param {number} [o.radius] tube radius; 0.03 reads as a slim architectural strip
 * @param {number} [o.intensity] emissive intensity — must exceed BLOOM_THRESHOLD to bloom
 * @param {boolean} [o.halo] additive glow sleeve. OFF by default — see HALO_DEFAULT;
 *   it double-counts with the bloom pass and washes the frame out.
 * @param {{distance?:number, power?:number}|null} [o.light] real PointLight spill, or null
 * @returns {THREE.Group} the run, already added to `parent`
 */
export function neonRun(parent, {
  length, axis = 'x', x = 0, y = 0, z = 0, color,
  radius = 0.03, intensity = CORE_INTENSITY, halo = HALO_DEFAULT, light = null,
}) {
  const run = new THREE.Group();
  run.position.set(x, y, z);
  // geometry is built along +Y; rotate the whole run instead of making per-axis geometry
  if (axis === 'x') run.rotation.z = Math.PI / 2;
  else if (axis === 'z') run.rotation.x = Math.PI / 2;

  const core = new THREE.Mesh(tubeGeo(radius, 8), coreMat(color, intensity));
  core.scale.y = length;
  // a light source does not occlude itself into the shadow map
  core.castShadow = false;
  core.receiveShadow = false;
  run.add(core);

  if (halo) {
    const sleeve = new THREE.Mesh(tubeGeo(radius * HALO_SCALE, 8), haloMat(color));
    // slightly shorter so the sleeve's open ends don't flare past the tube ends
    sleeve.scale.y = length * 0.995;
    sleeve.castShadow = sleeve.receiveShadow = false;
    // draw after opaque geometry so the additive blend sees the finished frame
    sleeve.renderOrder = 2;
    run.add(sleeve);
  }

  if (light) {
    // Forward renderer: every light here is added shader cost on every lit
    // material, so call sites opt in deliberately rather than getting one free
    // with each run. Lights parented into a floor group are skipped entirely
    // while that floor is hidden, so only the active floor ever pays.
    const pl = new THREE.PointLight(color, light.power ?? 6, light.distance ?? 4.5, 2);
    pl.castShadow = false;
    run.add(pl);
  }

  parent.add(run);
  return run;
}
