// @ts-check
// Parametric skinned body mesh: ONE merged, welded, vertex-skinned surface.
//
// v0.3 avatar pass — what changed and why:
//  * Limbs are SWEPT (rings lofted along the bone path with a keyed radius
//    profile) instead of capsule + pasted joint sphere. shoulder→elbow→wrist and
//    hip→knee→ankle are each one continuous surface, so there is nothing left to
//    "float". The spheres only ever existed to hide the 2-influence candy-wrap in
//    the old chainSkin; that is fixed in src/util/geo.js, so they are gone.
//  * Torso, neck and head are ONE ring stack, which is what kills the "ball on a
//    stick" head — the neck is a narrowing of the same surface, not a separate
//    cylinder butted against a sphere.
//  * Hands have a palm, a thumb and four fingers; feet have a heel, an arch and a
//    toe break (driven by the toeL/toeR bones, which nothing used before).
//  * Deltoids and glutes are tri-chained (see blendBoneInfluence) so they deform
//    with the limb instead of shearing off the torso.
//
// Only the body is vertex-skinned; the face decal + eyes attach to bones (face.js).
import * as THREE from 'three';
import {
  mergeGeometries, rigidSkin, chainSkinScalars, blendBoneInfluence,
  ballGeo, weldGeometry, stackGeo, tubeGeo, smooth01,
} from '../util/geo.js';
import { BONE_INDEX } from './skeleton.js';
import { cfg } from '../core/config.js';

/* ────────────────────────────── skin textures ───────────────────────────── */

/**
 * Skin canvases are IDENTICAL for identical tones — they are pure noise over a
 * base colour with no per-actor variation — but the old code regenerated a 256²
 * albedo (with a per-pixel JS grain loop) plus a 128² roughness canvas for every
 * actor. That runs on the combat hostile-spawn path, so every breach wave paid a
 * multi-hundred-millisecond hitch for textures that were bit-identical.
 * Cache by tone. Entries are marked shared so actor disposal leaves them alone.
 * @type {Map<string, {map: THREE.Texture, roughnessMap: THREE.Texture}>}
 */
const SKIN_CACHE = new Map();

/** Deterministic-ish value noise so cached maps stay stable per tone. */
function skinMaps(tone) {
  const hit = SKIN_CACHE.get(tone);
  if (hit) return hit;

  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = tone;
  ctx.fillRect(0, 0, size, size);
  // large soft blotches of warmth/cool so the flat tone breaks up under light
  const base = new THREE.Color(tone);
  for (let i = 0; i < 24; i++) {
    const warm = Math.random() < 0.5;
    const col = base.clone().offsetHSL(warm ? 0.01 : -0.01, 0.04, (Math.random() - 0.5) * 0.05);
    const g = ctx.createRadialGradient(
      Math.random() * size, Math.random() * size, 4,
      Math.random() * size, Math.random() * size, 30 + Math.random() * 60);
    g.addColorStop(0, `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},0.16)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // fine grain — tiled from a small noise patch instead of a 65k-iteration
  // per-pixel loop over the full canvas (same read, ~1/16 the work)
  const nSize = 64;
  const nc = document.createElement('canvas');
  nc.width = nc.height = nSize;
  const nctx = nc.getContext('2d');
  const img = nctx.createImageData(nSize, nSize);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 16;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 60;
  }
  nctx.putImageData(img, 0, 0);
  ctx.globalCompositeOperation = 'overlay';
  for (let y = 0; y < size; y += nSize) for (let x = 0; x < size; x += nSize) ctx.drawImage(nc, x, y);
  ctx.globalCompositeOperation = 'source-over';

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 2);

  // roughness map: brighter = rougher; skin varies subtly (shinier on high points)
  const rc = document.createElement('canvas');
  rc.width = rc.height = 128;
  const rctx = rc.getContext('2d');
  rctx.fillStyle = '#b0b0b0';
  rctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 40; i++) {
    rctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`;
    rctx.beginPath();
    rctx.arc(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 20, 0, Math.PI * 2);
    rctx.fill();
  }
  const roughnessMap = new THREE.CanvasTexture(rc);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(2, 2);

  // shared: Actor3D.dispose() must NOT free these or the next actor with the same
  // tone renders a disposed texture (black skin).
  map.userData.shared = roughnessMap.userData.shared = true;
  const entry = { map, roughnessMap };
  SKIN_CACHE.set(tone, entry);
  return entry;
}

/** Test/teardown hook: drop the cached skin canvases. */
export function clearSkinCache() {
  for (const { map, roughnessMap } of SKIN_CACHE.values()) { map.dispose(); roughnessMap.dispose(); }
  SKIN_CACHE.clear();
}

/* ─────────────────────────────── geometry ───────────────────────────────── */

/** Linear interpolation of a point along a two-segment polyline, keyed by y. */
export function alongByY(a, b, c, y) {
  const p = new THREE.Vector3();
  if (y >= b.y) {
    const t = (a.y - b.y) === 0 ? 0 : (a.y - y) / (a.y - b.y);
    return p.copy(a).lerp(b, THREE.MathUtils.clamp(t, 0, 1));
  }
  const t = (b.y - c.y) === 0 ? 0 : (b.y - y) / (b.y - c.y);
  return p.copy(b).lerp(c, THREE.MathUtils.clamp(t, 0, 1));
}

/**
 * Torso → neck → head as one ring stack. `bust`, `waist`, `hips`, `shoulderW`
 * and `build` all feed the ring radii, so every persona in data/cast/*.js still
 * drives the same silhouette knobs it always did.
 * Exported so outfitBuilder can derive garments from the SAME profile the skin
 * uses (offset outward by a clearance) — a garment authored against its own
 * independent lathe drifts out of sync the moment a body ratio changes, which is
 * how the old `top` ended up clipped by a large bust and the old `leggings` by
 * the calf.
 * @param {import('./skeleton.js').BodyParams} b
 */
export function trunkRings(b) {
  const h = b.height;
  const hipR = 0.096 * h * b.hips;
  const waistR = 0.074 * h * b.waist;
  const bustR = 0.086 * h;
  const sx = b.shoulderW / 2;              // metres
  const bustOut = 0.010 * h * b.bust;      // chest pushed forward by cup size

  /** @type {import('../util/geo.js').Ring[]} */
  return [
    // pelvis (bottom cap sits between the thighs)
    { y: 0.518 * h, rx: hipR * 0.58, rz: hipR * 0.50, cz: -0.004 * h },
    { y: 0.540 * h, rx: hipR * 0.90, rz: hipR * 0.74, cz: -0.008 * h },
    { y: 0.562 * h, rx: hipR * 1.00, rz: hipR * 0.80, cz: -0.010 * h },  // seat
    { y: 0.585 * h, rx: hipR * 0.98, rz: hipR * 0.76, cz: -0.006 * h },
    { y: 0.608 * h, rx: (hipR + waistR) * 0.48, rz: waistR * 0.78 },
    { y: 0.634 * h, rx: waistR, rz: waistR * 0.70 },                      // waist
    { y: 0.664 * h, rx: waistR * 1.05, rz: waistR * 0.74 },
    { y: 0.700 * h, rx: bustR * 0.95, rz: bustR * 0.70 },
    { y: 0.734 * h, rx: bustR * 1.00, rz: bustR * 0.74, cz: bustOut * 0.5 },
    { y: 0.768 * h, rx: bustR * 1.02, rz: bustR * 0.76, cz: bustOut },    // chest
    { y: 0.796 * h, rx: Math.max(bustR, sx * 0.72), rz: bustR * 0.74, cz: bustOut * 0.5 },
    { y: 0.818 * h, rx: sx * 0.90, rz: bustR * 0.70 },                    // shoulder shelf
    { y: 0.832 * h, rx: sx * 0.84, rz: bustR * 0.64 },
    { y: 0.845 * h, rx: sx * 0.50, rz: bustR * 0.52 },                    // trapezius slope
    { y: 0.856 * h, rx: 0.038 * h, rz: 0.038 * h, cz: -0.002 * h },       // neck base
    { y: 0.874 * h, rx: 0.033 * h, rz: 0.034 * h, cz: 0.001 * h },
    { y: 0.890 * h, rx: 0.032 * h, rz: 0.034 * h, cz: 0.005 * h },        // neck
    { y: 0.903 * h, rx: 0.038 * h, rz: 0.042 * h, cz: 0.014 * h },        // under the jaw
    { y: 0.919 * h, rx: 0.050 * h, rz: 0.052 * h, cz: 0.017 * h },        // chin / jawline
    { y: 0.934 * h, rx: 0.058 * h, rz: 0.059 * h, cz: 0.010 * h },        // mouth / cheek
    { y: 0.951 * h, rx: 0.061 * h, rz: 0.062 * h, cz: 0.005 * h },        // eye line (widest)
    { y: 0.968 * h, rx: 0.060 * h, rz: 0.061 * h, cz: 0.000 * h },        // brow / temple
    { y: 0.986 * h, rx: 0.054 * h, rz: 0.055 * h, cz: -0.004 * h },
    { y: 1.002 * h, rx: 0.042 * h, rz: 0.044 * h, cz: -0.007 * h },
    { y: 1.014 * h, rx: 0.024 * h, rz: 0.026 * h, cz: -0.008 * h },       // crown
  ];
}

/**
 * Arm sweep stations: `[offset from the shoulder along the arm, rx, rz]`, all in
 * fractions of body height (radii additionally scale by `build`). Exported so
 * sleeves can be swept down the same path as the skin.
 * @type {[number, number, number][]}
 */
export const ARM_STATIONS = [
  [-0.052, 0.030, 0.030], [-0.030, 0.044, 0.043], [-0.005, 0.052, 0.049],
  [0.030, 0.045, 0.043], [0.080, 0.039, 0.037], [0.130, 0.034, 0.033],
  [0.162, 0.030, 0.030],                                     // elbow
  [0.196, 0.033, 0.032], [0.240, 0.030, 0.028], [0.288, 0.024, 0.021],
  [0.310, 0.020, 0.017],                                     // wrist
  [0.325, 0.024, 0.011], [0.348, 0.026, 0.0105], [0.362, 0.023, 0.0095],
];

/**
 * Leg sweep stations: `[y, rx, rz, isThigh]` in fractions of body height. The
 * calf swell at y≈0.256 is exactly what the old straight-taper `leggings` recipe
 * poked through.
 * @type {[number, number, number, number][]}
 */
export const LEG_STATIONS = [
  [0.590, 0.046, 0.045, 1], [0.552, 0.062, 0.060, 1], [0.500, 0.060, 0.058, 1],
  [0.430, 0.054, 0.053, 1], [0.362, 0.045, 0.044, 1], [0.300, 0.037, 0.037, 0],
  [0.256, 0.042, 0.043, 0], [0.200, 0.038, 0.039, 0], [0.130, 0.028, 0.028, 0],
  [0.052, 0.020, 0.021, 0],
];

/** Thigh girth multiplier from the `hips` body param — shared with garments. */
export const thighScaleOf = (b) => 0.85 + 0.20 * b.hips;

/**
 * The breast lobe ellipsoid for one side (null when flat). Exported because it is
 * a SEPARATE volume from the trunk ring stack, so any garment sampled from the
 * rings alone has to be told about it or the bust goes straight through the top.
 * @param {import('./skeleton.js').BodyParams} b @param {number} m +1 = left
 */
export function breastLobe(b, m) {
  if (!(b.bust > 0.05)) return null;
  const h = b.height, r = 0.035 * h * b.bust;
  return {
    cx: m * 0.040 * h, cy: 0.778 * h, cz: 0.052 * h + 0.010 * h * b.bust,
    ax: r * 1.05, ay: r * 0.95, az: r * 0.92,
  };
}

/**
 * Outermost |x| the leg surface reaches at height `y` (0 above the leg). Garments
 * that drape over the hips need this: `hipW` is the thigh JOINT span and the
 * personas set it wide, so the thigh tops flare well past the pelvis rings and a
 * skirt sampled from the trunk alone is clipped straight through by them.
 * @param {import('./skeleton.js').BodyParams} b @param {number} y metres
 */
export function legOuterX(b, y) {
  const h = b.height, hx = b.hipW / 2, ts = thighScaleOf(b);
  const yf = y / h;
  if (yf > LEG_STATIONS[0][0] || yf < LEG_STATIONS[LEG_STATIONS.length - 1][0]) return 0;
  let rx = 0, isThigh = 1;
  for (let i = 1; i < LEG_STATIONS.length; i++) {
    if (yf >= LEG_STATIONS[i][0]) {
      const a = LEG_STATIONS[i - 1], c = LEG_STATIONS[i];
      const t = (a[0] - yf) / Math.max(1e-6, a[0] - c[0]);
      rx = a[1] + (c[1] - a[1]) * t;
      isThigh = t < 0.5 ? a[3] : c[3];
      break;
    }
  }
  // leg centres drift outward from hx at the hip to 1.1·hx at the ankle
  const centre = hx * (1 + 0.1 * Math.min(1, Math.max(0, (0.552 - yf) / 0.5)));
  return centre + rx * h * b.build * (isThigh ? ts : 1);
}

/**
 * Interpolate the trunk profile at an arbitrary height. Garments sample this so
 * their radii track the body's, whatever the persona's proportions.
 * @param {import('../util/geo.js').Ring[]} rings @param {number} y
 * @returns {{rx:number, rz:number, cx:number, cz:number}}
 */
export function sampleTrunk(rings, y) {
  const at = (r) => ({ rx: r.rx, rz: r.rz ?? r.rx, cx: r.cx ?? 0, cz: r.cz ?? 0 });
  if (y <= rings[0].y) return at(rings[0]);
  const last = rings[rings.length - 1];
  if (y >= last.y) return at(last);
  for (let i = 1; i < rings.length; i++) {
    if (y <= rings[i].y) {
      const a = at(rings[i - 1]), c = at(rings[i]);
      const t = (y - rings[i - 1].y) / Math.max(1e-6, rings[i].y - rings[i - 1].y);
      return {
        rx: a.rx + (c.rx - a.rx) * t, rz: a.rz + (c.rz - a.rz) * t,
        cx: a.cx + (c.cx - a.cx) * t, cz: a.cz + (c.cz - a.cz) * t,
      };
    }
  }
  return at(last);
}

/**
 * Build the skinned body geometry (bind-pose world space) for a persona.
 * @param {import('./skeleton.js').BodyParams} b
 * @param {Record<string, THREE.Vector3>} j joints
 * @returns {THREE.BufferGeometry}
 */
export function buildBodyGeometry(b, j) {
  const h = b.height;
  const B = BONE_INDEX;
  const parts = [];
  const radialTrunk = cfg('humanoid.body.radialTrunk', 20);
  const radialLimb = cfg('humanoid.body.radialLimb', 12);
  const band = cfg('humanoid.body.skinBand', 0.030) * h;

  /* ---- trunk: pelvis → waist → chest → shoulders → neck → head, one surface */
  const { geo: trunk, ys } = stackGeo(trunkRings(b), radialTrunk, {});
  chainSkinScalars(trunk, ys, [
    { bone: B.hips, from: 0.46 * h, to: 0.633 * h },
    { bone: B.spine1, from: 0.633 * h, to: 0.700 * h },
    { bone: B.spine2, from: 0.700 * h, to: 0.762 * h },
    { bone: B.chest, from: 0.762 * h, to: 0.845 * h },
    { bone: B.neck, from: 0.845 * h, to: 0.902 * h },
    { bone: B.head, from: 0.902 * h, to: 1.10 * h },
  ], band);

  // deltoid tri-chain: the shoulder shelf follows the arm. Without this the arm
  // shears out of a rigid chest shelf and you get the classic detached-ball
  // shoulder — the very artefact the pasted spheres were hiding.
  const sxAbs = Math.max(1e-4, b.shoulderW / 2);
  const deltoid = cfg('humanoid.body.deltoidBlend', 0.8);
  for (const [side, m] of /** @type {[string, number][]} */ ([['L', 1], ['R', -1]])) {
    blendBoneInfluence(trunk, B['arm' + side], (x, y) => {
      const lat = (x * m) / sxAbs;
      return deltoid
        * smooth01(lat * 1.4 - 0.35)                       // out toward the joint
        * smooth01((y - 0.775 * h) / (0.055 * h))          // up from the ribs
        * (1 - smooth01((y - 0.836 * h) / (0.024 * h)));   // …and STOP below the neck
    });
  }
  // glute/hip tri-chain: the seat deforms with the thigh instead of shearing.
  const hxAbs = Math.max(1e-4, b.hipW / 2);
  const glute = cfg('humanoid.body.gluteBlend', 0.55);
  for (const [side, m] of /** @type {[string, number][]} */ ([['L', 1], ['R', -1]])) {
    blendBoneInfluence(trunk, B['thigh' + side], (x, y, z) => {
      const lat = (x * m) / hxAbs;
      return glute
        * smooth01(lat * 1.6 - 0.5)
        * (1 - smooth01((y - 0.545 * h) / (0.055 * h)))
        * (0.55 + 0.45 * smooth01(-z / (0.03 * h)));       // biased to the rear
    });
  }
  // jaw: the chin mass rides the jaw bone so face.js can actually open a mouth.
  // Declared in skeleton.js since day one and driven by nothing until now.
  const jawShare = cfg('humanoid.body.jawBlend', 0.85);
  blendBoneInfluence(trunk, B.jaw, (x, y, z) => jawShare
    * smooth01((0.9375 * h - y) / (0.022 * h))
    * smooth01((y - 0.884 * h) / (0.020 * h))
    * smooth01((z + 0.006 * h) / (0.035 * h)));
  parts.push(trunk);

  /* ---- breasts: blended, not pasted. The base follows the chest and only the
     lobe follows breastL/R, so they move with the ribcage instead of orbiting it. */
  if (b.bust > 0.05) {
    const r = 0.035 * h * b.bust;
    for (const [side, m] of /** @type {[string, number][]} */ ([['L', 1], ['R', -1]])) {
      const lobe = breastLobe(b, m);
      const c = new THREE.Vector3(lobe.cx, lobe.cy, lobe.cz);
      const g = ballGeo(c, r, { x: 1.05, y: 0.95, z: 0.92 }, 12);
      rigidSkin(g, B.chest);
      blendBoneInfluence(g, B['breast' + side], (x, y, z) => {
        const d = Math.hypot(x - c.x, y - c.y, z - c.z) / r;
        return 0.85 * (1 - smooth01((d - 0.25) / 0.9));
      });
      parts.push(g);
    }
  }

  /* ---- arms: one swept surface from inside the deltoid to the knuckles ---- */
  const armAngle = Math.atan2(j.foreL.x - j.armL.x, j.armL.y - j.foreL.y);
  const buildScale = b.build;
  for (const [side, m] of /** @type {[string, number][]} */ ([['L', 1], ['R', -1]])) {
    const sh = j['arm' + side];
    const dir = new THREE.Vector3(m * Math.sin(armAngle), -Math.cos(armAngle), 0).normalize();
    // medial (palm-facing) direction, perpendicular to the arm — used to place
    // and curl the thumb/fingers so the hand isn't a flat paddle.
    const medial = new THREE.Vector3(-m, 0, 0).addScaledVector(dir, m * dir.x).normalize();
    const front = new THREE.Vector3(0, 0, 1);

    const stations = ARM_STATIONS;
    const pts = stations.map(([t]) => sh.clone().addScaledVector(dir, t * h));
    const radii = stations.map(([, rx, rz]) => ({ rx: rx * h * buildScale, rz: rz * h * buildScale }));
    const arm = tubeGeo(pts, radii, radialLimb, { capStart: true, capEnd: true, up: front });
    // arc-length skinning: the chain boundaries are the real joint distances, so
    // the elbow blend sits exactly on the elbow whatever the persona's build is.
    const s0 = 0.052 * h;   // arc from the tube start to the shoulder joint
    chainSkinScalars(arm.geo, arm.arc, [
      { bone: B['arm' + side], from: -0.05, to: s0 + 0.162 * h },
      { bone: B['fore' + side], from: s0 + 0.162 * h, to: s0 + 0.310 * h },
      { bone: B['hand' + side], from: s0 + 0.310 * h, to: arm.total + 0.05 },
    ], 0.026 * h);
    parts.push(arm.geo);

    /* fingers + thumb. The skeleton has handL/handR only, so these are SHAPED in
       bind pose and skinned rigidly to the hand — enough silhouette to read as a
       hand over the shoulder, without inventing 15 bones nothing would animate. */
    const palmEnd = sh.clone().addScaledVector(dir, 0.362 * h);
    const fingerSpec = [
      [-0.017, 0.052], [-0.006, 0.058], [0.005, 0.054], [0.015, 0.043],
    ];
    for (const [off, len] of fingerSpec) {
      const root = palmEnd.clone().addScaledVector(front, off * h).addScaledVector(dir, -0.004 * h);
      const fpts = [], frad = [];
      for (let k = 0; k <= 3; k++) {
        const t = k / 3;
        const p = root.clone()
          .addScaledVector(dir, t * len * h)
          .addScaledVector(medial, smooth01(t) * 0.014 * h);   // gentle curl
        fpts.push(p);
        frad.push({ rx: (0.0082 - 0.0028 * t) * h, rz: (0.0078 - 0.0026 * t) * h });
      }
      const f = tubeGeo(fpts, frad, 6, { capStart: true, capEnd: true, up: front });
      rigidSkin(f.geo, B['hand' + side]);
      parts.push(f.geo);
    }
    // thumb: off the radial side of the palm, angled forward
    const thumbRoot = sh.clone().addScaledVector(dir, 0.322 * h)
      .addScaledVector(front, 0.016 * h).addScaledVector(medial, 0.004 * h);
    const thumbDir = dir.clone().multiplyScalar(0.62).addScaledVector(front, 0.55).normalize();
    const tpts = [], trad = [];
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      tpts.push(thumbRoot.clone().addScaledVector(thumbDir, t * 0.048 * h));
      trad.push({ rx: (0.0105 - 0.0035 * t) * h, rz: (0.0095 - 0.0030 * t) * h });
    }
    const thumb = tubeGeo(tpts, trad, 6, { capStart: true, capEnd: true, up: front });
    rigidSkin(thumb.geo, B['hand' + side]);
    parts.push(thumb.geo);
  }

  /* ---- legs: hip → knee → ankle as one swept surface ---- */
  const thighScale = thighScaleOf(b);
  for (const side of ['L', 'R']) {
    const hip = j['thigh' + side], knee = j['shin' + side], ankle = j['foot' + side];
    const stations = LEG_STATIONS;
    const top = hip.clone(); top.y = 0.590 * h;
    const pts = stations.map(([y]) => (y > hip.y / h ? top.clone().setY(y * h) : alongByY(hip, knee, ankle, y * h)));
    const radii = stations.map(([, rx, rz, tw]) => ({
      rx: rx * h * b.build * (tw ? thighScale : 1),
      rz: rz * h * b.build * (tw ? thighScale : 1),
    }));
    const leg = tubeGeo(pts, radii, radialLimb + 2, { capStart: true, capEnd: true });
    const thighLen = leg.arc[Math.min(leg.arc.length - 1, (radialLimb + 2) * 5)];
    chainSkinScalars(leg.geo, leg.arc, [
      { bone: B['thigh' + side], from: -0.06, to: thighLen },
      { bone: B['shin' + side], from: thighLen, to: leg.total - 0.012 * h },
      { bone: B['foot' + side], from: leg.total - 0.012 * h, to: leg.total + 0.05 },
    ], 0.032 * h);
    parts.push(leg.geo);

    /* foot: heel → arch → ball → toe. Swept along +Z so it actually has a heel
       and a toe break; the toe segment rides toeL/toeR (previously dead bones). */
    const fx = ankle.x;
    const fStations = [
      [-0.062, 0.026, 0.021, 0.019], [-0.034, 0.028, 0.026, 0.024],
      [-0.002, 0.027, 0.025, 0.026], [0.038, 0.021, 0.019, 0.028],
      [0.075, 0.016, 0.013, 0.025], [0.100, 0.011, 0.009, 0.019],
    ];
    const fpts = fStations.map(([z, y]) => new THREE.Vector3(fx, y * h, z * h));
    const frad = fStations.map(([, , rx, rz]) => ({ rx: rx * h, rz: rz * h * b.build }));
    const foot = tubeGeo(fpts, frad, radialLimb, {
      capStart: true, capEnd: true, up: new THREE.Vector3(0, 1, 0),
    });
    const fz = new Float32Array(foot.geo.getAttribute('position').count);
    const fpos = foot.geo.getAttribute('position');
    for (let i = 0; i < fz.length; i++) fz[i] = fpos.getZ(i);
    chainSkinScalars(foot.geo, fz, [
      { bone: B['foot' + side], from: -0.2, to: 0.062 * h },
      { bone: B['toe' + side], from: 0.062 * h, to: 0.2 },
    ], 0.018 * h);
    parts.push(foot.geo);
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  // weld coincident verts + smooth normals so part seams stop reading as creases
  return weldGeometry(merged, 6e-4);
}

/* ────────────────────────────── skin material ───────────────────────────── */

/**
 * Cheap subsurface approximation: wrap the direct-light N·L term and feed the
 * extra (wrapped − hard) energy back as a tinted diffuse lobe. Real skin lets
 * light bleed a few millimetres under the surface, which is why an unlit cheek
 * still glows warm; without it a MeshPhysicalMaterial cheek terminates hard at
 * the terminator and reads as painted vinyl.
 *
 * Patched via onBeforeCompile string replacement, which is version-fragile — so
 * if the chunk ever stops matching we silently keep stock lighting rather than
 * shipping a shader that fails to compile.
 * @param {THREE.MeshPhysicalMaterial} mat @param {THREE.Color} tint
 */
function applySubsurface(mat, tint) {
  const strength = cfg('humanoid.skin.subsurface', 0.55);
  const wrap = cfg('humanoid.skin.subsurfaceWrap', 0.55);
  if (strength <= 0) return;
  const NEEDLE = 'void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {\n\tfloat dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;';
  const REPLACE = 'void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {\n\tfloat rawNL = dot( geometryNormal, directLight.direction );\n\tfloat dotNL = saturate( rawNL );\n\tfloat wrapNL = saturate( ( rawNL + sssWrap ) / ( 1.0 + sssWrap ) );\n\treflectedLight.indirectDiffuse += max( 0.0, wrapNL - dotNL ) * directLight.color * sssColor * sssStrength * BRDF_Lambert( material.diffuseColor );\n\tvec3 irradiance = dotNL * directLight.color;';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.sssStrength = { value: strength };
    shader.uniforms.sssWrap = { value: wrap };
    shader.uniforms.sssColor = { value: tint };
    shader.fragmentShader = 'uniform float sssStrength;\nuniform float sssWrap;\nuniform vec3 sssColor;\n' + shader.fragmentShader;
    if (shader.fragmentShader.indexOf(NEEDLE) < 0) return;   // three chunk moved — stay stock
    shader.fragmentShader = shader.fragmentShader.replace(NEEDLE, REPLACE);
  };
  // every skin material compiles the same patch — share one program
  mat.customProgramCacheKey = () => 'ncld_skin_sss';
}

/**
 * Build the visual rig: skinned body mesh + bone-attached hair.
 * @param {{ colors: {skin:string, hair:string}, body: import('./skeleton.js').BodyParams, hairStyle: string }} persona
 * @param {{ byName: Record<string, THREE.Bone>, skeleton: THREE.Skeleton, bones: THREE.Bone[], joints: Record<string, THREE.Vector3> }} rig
 */
export function buildBody(persona, rig) {
  const geo = buildBodyGeometry(persona.body, rig.joints);
  const { map, roughnessMap } = skinMaps(persona.colors.skin);
  const skin = new THREE.Color(persona.colors.skin);
  // Physical material with a soft sheen gives skin a subtle fresnel falloff at
  // grazing angles. Retuned for the procedural environment map added in
  // src/scene3d/env.js — with real reflections to catch, the old roughness 0.72 /
  // sheen 0.5 pair over-diffused and threw the IBL away.
  const mat = new THREE.MeshPhysicalMaterial({
    map, roughnessMap,
    roughness: cfg('humanoid.skin.roughness', 0.62),
    metalness: 0,
    sheen: cfg('humanoid.skin.sheen', 0.65),
    sheenRoughness: cfg('humanoid.skin.sheenRoughness', 0.72),
    sheenColor: skin.clone().offsetHSL(0, 0.12, 0.10),
    envMapIntensity: cfg('humanoid.skin.envMapIntensity', 0.7),
  });
  applySubsurface(mat, skin.clone().offsetHSL(-0.02, 0.35, -0.05));

  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.add(rig.bones[0]); // root bone
  // explicit identity bindMatrix → do NOT recompute skeleton.boneInverses (they
  // were set to the bind pose in buildSkeleton); geometry is authored in
  // bind-pose world space with the mesh at origin, so identity is correct.
  mesh.bind(rig.skeleton, new THREE.Matrix4());
  mesh.frustumCulled = false; // skinned bounds are wrong when posed; cheap cast anyway
  const hair = buildHair(persona, rig);
  if (hair) mesh.add(hair);
  return mesh;
}

/* ──────────────────────────────── hair ──────────────────────────────────── */

/** Style → [strand count, free-fall length (fraction of height), back sweep]. */
const HAIR_STYLES = {
  short: { strands: 52, fall: 0.010, width: 0.030, layers: 2 },
  bob: { strands: 62, fall: 0.075, width: 0.028, layers: 2 },
  long: { strands: 72, fall: 0.190, width: 0.026, layers: 3 },
  undercut: { strands: 40, fall: 0.006, width: 0.022, layers: 1 },
  ponytail: { strands: 70, fall: 0.220, width: 0.024, layers: 3 },
  slick: { strands: 48, fall: 0.022, width: 0.032, layers: 2 },
  pixie: { strands: 56, fall: 0.038, width: 0.026, layers: 2 },
};

/**
 * Hair as generated STRAND CARDS instead of three primitive shells (a sphere
 * cap, a back cap and a fringe wedge — the "cap-blob").
 *
 * Every strand grows from the crown whorl and flows outward: front azimuths stop
 * at the hairline (that's the fringe), side and back azimuths carry on past the
 * skull and fall free. The free length is skinned to hair1/hair2/hair3 — bones
 * skeleton.js has declared since day one and which NOTHING animated; the
 * animator now springs them from root motion so hair has secondary sway.
 *
 * @param {{ colors:{hair:string}, body: import('./skeleton.js').BodyParams, hairStyle: string }} persona
 * @param {{ byName: Record<string, THREE.Bone>, skeleton: THREE.Skeleton, joints: Record<string, THREE.Vector3> }} rig
 * @returns {THREE.SkinnedMesh|null}
 */
export function buildHair(persona, rig) {
  const h = persona.body.height;
  const B = BONE_INDEX;
  const style = HAIR_STYLES[persona.hairStyle] || HAIR_STYLES.short;
  // config strand count is an OVERRIDE: 0 (the default) means "use the style's"
  const strandCfg = Math.round(cfg('humanoid.hair.strands', 0));
  const strandCount = strandCfg > 0 ? Math.max(8, strandCfg) : style.strands;
  const fall = cfg('humanoid.hair.fallScale', 1) * style.fall * h;
  const cardW = style.width * h;

  // scalp ellipsoid, a hair's thickness outside the skull rings in trunkRings()
  const C = new THREE.Vector3(0, 0.9585 * h, 0.004 * h);
  const A = new THREE.Vector3(0.0655 * h, 0.0715 * h, 0.0665 * h);
  const STEPS = 7;

  const pos = [], uv = [], index = [], freeT = [];
  let vBase = 0;
  const p = new THREE.Vector3(), nrm = new THREE.Vector3(), tang = new THREE.Vector3();
  const prev = new THREE.Vector3(), sideV = new THREE.Vector3();

  /** ellipsoid surface point at azimuth u (0 = front/+Z) and polar v (0 = crown) */
  const surf = (u, v, out) => out.set(
    A.x * Math.sin(v) * Math.sin(u),
    A.y * Math.cos(v),
    A.z * Math.sin(v) * Math.cos(u)
  ).add(C);

  for (let layer = 0; layer < style.layers; layer++) {
    const lift = 0.0026 * h * layer;           // stack layers outward for volume
    for (let s = 0; s < strandCount; s++) {
      const jitter = (s * 0.618033988749895) % 1;      // golden-ratio scatter, no RNG
      const u = ((s + 0.5) / strandCount) * Math.PI * 2 - Math.PI + (jitter - 0.5) * 0.06;
      const front = Math.cos(u);                        // +1 dead ahead, -1 behind
      // front strands stop at the brow (fringe); side/back strands run to the nape
      const vEnd = front > 0.45 ? 0.62 + 0.42 * (1 - front) : 1.55 + 0.42 * (-front);
      const v0 = 0.16 + 0.05 * jitter;
      const strandFall = front > 0.45 ? fall * 0.12 : fall * (0.55 + 0.45 * (0.5 - 0.5 * front));

      let freeLen = 0;
      prev.set(NaN, NaN, NaN);
      for (let k = 0; k <= STEPS; k++) {
        const t = k / STEPS;
        // first ~72% of the card hugs the skull, the rest falls free
        const onScalp = Math.min(1, t / 0.72);
        const v = v0 + (vEnd - v0) * onScalp;
        surf(u, v, p);
        // outward offset: layering + a little extra as the strand thickens
        nrm.set((p.x - C.x) / (A.x * A.x), (p.y - C.y) / (A.y * A.y), (p.z - C.z) / (A.z * A.z)).normalize();
        p.addScaledVector(nrm, lift + 0.0018 * h);
        if (t > 0.72) {
          const ft = (t - 0.72) / 0.28;
          const d = ft * strandFall;
          freeLen = ft;
          p.y -= d;
          p.z -= d * 0.22;                              // drift back off the neck
          p.x *= 1 - 0.10 * ft;                         // gather toward the spine
        }
        if (k > 0) tang.copy(p).sub(prev).normalize();
        else { surf(u, v0 + 0.01, tang); tang.sub(p).normalize().negate(); }
        prev.copy(p);
        sideV.crossVectors(tang, nrm).normalize();

        const taper = (0.35 + 0.65 * Math.sin(Math.min(1, v) * Math.PI * 0.9)) * (1 - 0.55 * t * t);
        const w = cardW * taper * 0.5;
        const bulge = w * 0.45;
        // 3 verts per step: a shallow curved card catches a highlight from both
        // sides, where a flat 2-vert ribbon vanishes edge-on.
        for (const [so, no] of [[-1, 0], [0, 1], [1, 0]]) {
          pos.push(
            p.x + sideV.x * so * w + nrm.x * no * bulge,
            p.y + sideV.y * so * w + nrm.y * no * bulge,
            p.z + sideV.z * so * w + nrm.z * no * bulge
          );
          uv.push((so + 1) / 2, t);
          freeT.push(freeLen);
        }
        if (k > 0) {
          const a = vBase + (k - 1) * 3, c = vBase + k * 3;
          index.push(a, a + 1, c, a + 1, c + 1, c, a + 1, a + 2, c + 1, a + 2, c + 2, c + 1);
        }
      }
      vBase = pos.length / 3;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // skin by "how far into the free fall am I" rather than by world Y: the scalp
  // part of a strand must stay welded to the skull even though it shares a Y
  // band with the falling part behind it.
  chainSkinScalars(geo, new Float32Array(freeT), [
    { bone: B.head, from: -1, to: 0.02 },
    { bone: B.hair1, from: 0.02, to: 0.36 },
    { bone: B.hair2, from: 0.36, to: 0.68 },
    { bone: B.hair3, from: 0.68, to: 1.6 },
  ], 0.16);

  const hairCol = new THREE.Color(persona.colors.hair);
  const mat = new THREE.MeshPhysicalMaterial({
    color: hairCol,
    // Root cause of the "blinking lights on their heads", found by measuring peak
    // luminance in the head region and toggling one contributor at a time: hiding
    // the hair dropped blown-white pixels from ~17200 to ~80, while hiding the
    // eyes/face changed nothing. The specular clips to pure white BEFORE bloom,
    // and bloom then smears it across the whole head.
    //
    // The lobe sweep was unambiguous: ANY clearcoat or anisotropy on strand hair,
    // even at 0.08/0.1, reintroduced the blowout (9938 hot px), because a tight
    // reflection lobe on backlit thin strands concentrates a 95-candela point
    // light past clipping. sheen (a retroreflective term) does the same on the
    // grazing back-of-head view. A slightly rough dielectric with a whisper of
    // sheen and NO clearcoat/anisotropy measured clean (~82 hot px) and still
    // reads as hair. These are the measured values.
    roughness: cfg('humanoid.hair.roughness', 0.80),
    metalness: 0,
    clearcoat: 0, clearcoatRoughness: 1,
    sheen: cfg('humanoid.hair.sheen', 0.12), sheenColor: hairCol.clone().offsetHSL(0, 0.05, 0.32),
    side: THREE.DoubleSide,
    envMapIntensity: cfg('humanoid.hair.envMapIntensity', 0.12),
  });
  // anisotropy stays OFF: the sweep proved it is a primary blowout driver on
  // strands. Kept as config so it can be re-enabled deliberately, default 0.
  if ('anisotropy' in mat) { mat.anisotropy = cfg('humanoid.hair.anisotropy', 0); mat.anisotropyRotation = Math.PI / 2; }

  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = true;
  // same identity-bindMatrix contract as the body: never let three re-run
  // calculateInverses() on the live, posed skeleton (see skeleton.js).
  mesh.bind(rig.skeleton, new THREE.Matrix4());
  mesh.frustumCulled = false;
  mesh.name = 'hair';
  return mesh;
}
