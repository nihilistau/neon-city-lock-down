// @ts-check
// Outfit layers: separate skinned meshes bound to the character's skeleton,
// toggled per outfit state.
//
// v0.3 pass — garments are now derived from the BODY's own swept profile
// (bodyBuilder exports trunkRings/ARM_STATIONS/LEG_STATIONS) offset outward by a
// clearance, then given real thickness: an outer surface, an inner surface and a
// stitched hem you can see the edge of. Two things follow from that:
//   * nothing pokes through any more. The old recipes lathed their own profiles,
//     so a large `bust` clipped through `top` and the calf swell clipped through
//     `leggings` — the garment had no idea what shape it was covering.
//   * garments stop needing THREE.DoubleSide. A zero-thickness shell lit from
//     both sides is the single loudest "this is a texture, not cloth" cue.
import * as THREE from 'three';
import { mergeGeometries, chainSkin, rigidSkin, shellGeo, tubeGeo } from '../util/geo.js';
import { BONE_INDEX } from './skeleton.js';
import {
  trunkRings, sampleTrunk, alongByY, legOuterX, thighScaleOf, breastLobe,
  ARM_STATIONS, LEG_STATIONS,
} from './bodyBuilder.js';
import { cfg } from '../core/config.js';

/** default fabric clearance + thickness, as fractions of body height */
const CLEAR = () => cfg('humanoid.outfit.clearance', 0.0055);
const THICK = () => cfg('humanoid.outfit.thickness', 0.0032);
const RADIAL = () => cfg('humanoid.outfit.radial', 18);

/**
 * Sample the trunk into a garment band: `count` rings between yLo and yHi,
 * expanded off the skin. Returns outer + inner ring stacks for shellGeo.
 * @param {any} b body params
 * @param {number} yLo @param {number} yHi absolute metres
 * @param {{count?:number, clear?:number, thick?:number, flare?:number, coverLegs?:boolean}} [o]
 */
function band(b, yLo, yHi, o = {}) {
  const h = b.height;
  const rings = trunkRings(b);
  const count = o.count ?? 10;
  const clear = (o.clear ?? CLEAR()) * h;
  const thick = Math.min((o.thick ?? THICK()) * h, clear * 0.85);
  const lowest = rings[0];

  // The breast lobes are SEPARATE volumes from the trunk rings, so a garment
  // sampled from the rings alone gets a bust straight through it. Two steps:
  // push the band forward by the front overshoot (only the front moves, since rz
  // and cz grow together), then scale the ring until it actually CONTAINS the
  // lobe cross-section — the forward push alone still let the outer edge of the
  // lobe out through the side of the cup.
  const lobes = [breastLobe(b, 1), breastLobe(b, -1)].filter(Boolean);
  const bustY = 0.778 * h;
  const chest = sampleTrunk(rings, bustY);
  const bulge = lobes.length
    ? Math.max(0, (lobes[0].cz + lobes[0].az) - (chest.rz + chest.cz)) * 0.5 : 0;

  const outer = [], inner = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const y = yLo + (yHi - yLo) * t;
    let s;
    if (y < lowest.y) {
      // below the pelvis the trunk stack ends — flare the skirt outward instead
      // of collapsing to the crotch cap radius
      const base = sampleTrunk(rings, lowest.y);
      const drop = (lowest.y - y) / h;
      const f = 1 + (o.flare ?? 0) * drop * 8;
      s = { rx: base.rx * f, rz: base.rz * f, cx: base.cx, cz: base.cz * 0.4 };
    } else {
      s = sampleTrunk(rings, y);
    }
    const g = bulge > 0 ? Math.exp(-0.5 * (((y - bustY) / (0.040 * h)) ** 2)) : 0;
    let rx = s.rx + clear, rz = s.rz + bulge * g + clear;
    const cz = s.cz + bulge * g;
    if (o.coverLegs) rx = Math.max(rx, legOuterX(b, y) + clear);

    // containment: grow the ring uniformly until every lobe cross-section point
    // at this height satisfies ((x-cx)/rx)² + ((z-cz)/rz)² ≤ 1
    let grow = 1;
    for (const L of lobes) {
      const dy = (y - L.cy) / L.ay;
      if (Math.abs(dy) >= 1) continue;
      const k = Math.sqrt(1 - dy * dy);
      for (let a = 0; a < 16; a++) {
        const th = (a / 16) * Math.PI * 2;
        const px = L.cx + L.ax * k * Math.cos(th), pz = L.cz + L.az * k * Math.sin(th);
        grow = Math.max(grow, Math.hypot((px - s.cx) / rx, (pz - cz) / rz));
      }
    }
    if (grow > 1) { rx *= grow; rz *= grow; }

    outer.push({ y, rx: rx + (grow > 1 ? clear : 0), rz: rz + (grow > 1 ? clear : 0), cx: s.cx, cz });
    inner.push({ y, rx: rx - thick, rz: rz - thick, cx: s.cx, cz });
  }
  return { outer, inner };
}

/** Skin a trunk garment on the spine chain by vertex Y. */
function skinTrunk(geo, h, yLo, yHi) {
  return chainSkin(geo, [
    { bone: BONE_INDEX.hips, from: yLo - 0.2, to: 0.633 * h },
    { bone: BONE_INDEX.spine1, from: 0.633 * h, to: 0.700 * h },
    { bone: BONE_INDEX.spine2, from: 0.700 * h, to: 0.762 * h },
    { bone: BONE_INDEX.chest, from: 0.762 * h, to: yHi + 0.2 },
  ], 0.030 * h);
}

/**
 * Sweep a leg garment down the body's own leg stations, from yTop to yBottom.
 * Ends with a HEM FOLD: an extra ring at the same station with the inner radius,
 * so the cuff shows its thickness instead of ending in a flat disc.
 */
function legPiece(b, j, side, yTop, yBottom, clearMul = 1) {
  const h = b.height;
  const hip = j['thigh' + side], knee = j['shin' + side], ankle = j['foot' + side];
  const clear = CLEAR() * h * clearMul;
  const thick = Math.min(THICK() * h, clear * 0.8);
  const thighScale = thighScaleOf(b);
  const pts = [], radii = [];
  for (const [y, rx, rz, isThigh] of LEG_STATIONS) {
    const yy = y * h;
    if (yy > yTop || yy < yBottom) continue;
    const sc = b.build * (isThigh ? thighScale : 1);
    pts.push(yy > hip.y ? hip.clone().setY(yy) : alongByY(hip, knee, ankle, yy));
    radii.push({ rx: rx * h * sc + clear, rz: rz * h * sc + clear });
  }
  if (pts.length < 2) return null;
  // hem fold at the low end
  const lastP = pts[pts.length - 1], lastR = radii[radii.length - 1];
  pts.push(lastP.clone().setY(lastP.y - 0.004 * h));
  radii.push({ rx: lastR.rx, rz: lastR.rz });
  pts.push(lastP.clone().setY(lastP.y - 0.004 * h));
  radii.push({ rx: Math.max(0.004 * h, lastR.rx - thick), rz: Math.max(0.004 * h, lastR.rz - thick) });

  const t = tubeGeo(pts, radii, RADIAL(), { capStart: true, capEnd: true });
  // chain entries must ASCEND, and a leg runs downward — so measure on -y
  chainSkin(t.geo, [
    { bone: BONE_INDEX['thigh' + side], from: -2, to: -knee.y },
    { bone: BONE_INDEX['shin' + side], from: -knee.y, to: -ankle.y },
    { bone: BONE_INDEX['foot' + side], from: -ankle.y, to: 2 },
  ], 0.032 * h, (x, y) => -y);
  return t.geo;
}

/**
 * Piece generators. Each returns bind-pose geometry with skinning attributes.
 * @type {Record<string, (b:any, j:any, opts:any) => THREE.BufferGeometry>}
 */
const PIECES = {
  /** fitted top: chest → waist cover */
  top(b, j, opts) {
    const h = b.height;
    // ends just under the collarbone rather than capping the shoulder — a top
    // narrowing at the top edge would have to dip INSIDE the chest to do it
    const yLo = (opts.hem ?? 0.612) * h, yHi = 0.806 * h;
    const { outer, inner } = band(b, yLo, yHi, { count: 11 });
    const geo = shellGeo(outer, inner, RADIAL());
    return skinTrunk(geo, h, yLo, yHi);
  },

  /** dress: chest → above knee, flared */
  dress(b, j, opts) {
    const h = b.height;
    const yLo = (opts.hem ?? 0.36) * h, yHi = 0.802 * h;
    const { outer, inner } = band(b, yLo, yHi, { count: 18, flare: 0.11, coverLegs: true });
    const geo = shellGeo(outer, inner, RADIAL());
    return skinTrunk(geo, h, yLo, yHi);
  },

  /** shorts: hips → upper thigh */
  shorts(b, j, opts) {
    const h = b.height;
    const parts = [];
    const yLo = 0.505 * h, yHi = (opts.rise ?? 0.615) * h;
    const w = band(b, yLo, yHi, { count: 7 });
    parts.push(skinTrunk(shellGeo(w.outer, w.inner, RADIAL()), h, yLo, yHi));
    for (const side of ['L', 'R']) {
      const leg = legPiece(b, j, side, 0.560 * h, (opts.leg ?? 0.44) * h, 1.35);
      if (leg) parts.push(leg);
    }
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  },

  /** open jacket shell over the torso + upper arms */
  jacket(b, j) {
    const h = b.height;
    const parts = [];
    const yLo = 0.590 * h, yHi = 0.836 * h;
    const w = band(b, yLo, yHi, { count: 10, clear: CLEAR() * 2.1 });
    parts.push(skinTrunk(shellGeo(w.outer, w.inner, RADIAL()), h, yLo, yHi));
    // sleeves swept down the arm's own stations, so an elbow bend keeps volume
    for (const side of ['L', 'R']) {
      const sh = j['arm' + side], el = j['fore' + side];
      const dir = el.clone().sub(sh).normalize();
      const clear = CLEAR() * h * 2.2, thick = THICK() * h;
      const pts = [], radii = [];
      for (const [t, rx, rz] of ARM_STATIONS) {
        if (t < -0.02 || t > 0.150) continue;
        pts.push(sh.clone().addScaledVector(dir, t * h));
        radii.push({ rx: rx * h * b.build + clear, rz: rz * h * b.build + clear });
      }
      const lastP = pts[pts.length - 1], lastR = radii[radii.length - 1];
      pts.push(lastP.clone().addScaledVector(dir, 0.004 * h));
      radii.push({ ...lastR });
      pts.push(lastP.clone().addScaledVector(dir, 0.004 * h));
      radii.push({ rx: lastR.rx - thick, rz: lastR.rz - thick });   // cuff hem
      const sleeve = tubeGeo(pts, radii, Math.max(8, RADIAL() - 4), { capStart: true, capEnd: true, up: new THREE.Vector3(0, 0, 1) });
      rigidSkin(sleeve.geo, BONE_INDEX['arm' + side]);
      parts.push(sleeve.geo);
    }
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  },

  /** loose robe: shoulders → mid-thigh, draped */
  robe(b, j, opts) {
    const h = b.height;
    const yLo = (opts?.hem ?? 0.42) * h, yHi = 0.842 * h;
    const { outer, inner } = band(b, yLo, yHi, {
      count: 16, clear: CLEAR() * 3.4, thick: THICK() * 1.6, flare: 0.09, coverLegs: true,
    });
    const geo = shellGeo(outer, inner, RADIAL());
    return skinTrunk(geo, h, yLo, yHi);
  },

  /** towel wrap: chest → mid-thigh, snug */
  towel(b, j, opts) {
    const h = b.height;
    const yLo = (opts?.hem ?? 0.46) * h, yHi = 0.806 * h;
    const { outer, inner } = band(b, yLo, yHi, {
      count: 12, clear: CLEAR() * 1.9, thick: THICK() * 1.8, flare: 0.04, coverLegs: true,
    });
    const geo = shellGeo(outer, inner, RADIAL());
    return skinTrunk(geo, h, yLo, yHi);
  },

  /** thigh-high leggings */
  leggings(b, j) {
    const h = b.height;
    const parts = [];
    for (const side of ['L', 'R']) {
      const leg = legPiece(b, j, side, 0.575 * h, 0.050 * h, 1);
      if (leg) parts.push(leg);
    }
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  },
};

/** every piece id a recipe may name — used by data lint + the wardrobe */
export const PIECE_IDS = Object.keys(PIECES);

/**
 * Build one outfit layer set for a persona.
 * @param {any} persona
 * @param {{skeleton:THREE.Skeleton, joints:any}} rig
 * @param {{pieces: {piece:string, color:string, metalness?:number, roughness?:number, opts?:any}[]}} recipe
 * @returns {THREE.SkinnedMesh[]}
 */
export function buildOutfit(persona, rig, recipe) {
  const meshes = [];
  for (const p of recipe?.pieces || []) {
    const gen = PIECES[p.piece];
    if (!gen) throw new Error(`unknown outfit piece: ${p.piece}`);
    const geo = gen(persona.body, rig.joints, p.opts || {});
    geo.computeVertexNormals();
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(p.color),
      roughness: p.roughness ?? 0.75,
      metalness: p.metalness ?? 0.05,
      sheen: p.sheen ?? 0.35,               // cloth fresnel; reads under the IBL
      sheenRoughness: 0.9,
      envMapIntensity: cfg('humanoid.outfit.envMapIntensity', 0.7),
      // FrontSide: the garments are closed shells with real thickness now, so
      // DoubleSide would only cost fill rate and flatten the hems.
      side: THREE.FrontSide,
    });
    bindFabric(mat, p.piece);
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.castShadow = true;
    // explicit identity bindMatrix — reuse the bind-pose boneInverses computed
    // in buildSkeleton; binding without it re-ran calculateInverses() on the
    // already-posed shared skeleton and exploded every mesh sharing it.
    mesh.bind(rig.skeleton, new THREE.Matrix4());
    mesh.frustumCulled = false;
    meshes.push(mesh);
  }
  return meshes;
}

const FABRIC_FOR = {
  jacket: 'leather', dress: 'silk', robe: 'silk',
  top: 'cotton', shorts: 'cotton', leggings: 'cotton', towel: 'cotton',
};

/** @param {string} piece */
export function fabricForPiece(piece) {
  return FABRIC_FOR[piece] || null;
}

/** @param {THREE.MeshPhysicalMaterial} mat @param {string} piece */
function bindFabric(mat, piece) {
  const kind = fabricForPiece(piece);
  if (!kind || typeof Image === 'undefined') return;
  const loader = new THREE.TextureLoader();
  loader.load(`/assets/fabrics/${kind}.jpg`, (map) => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(2.2, 2.2);
    mat.map = map;
    mat.needsUpdate = true;
  });
}
