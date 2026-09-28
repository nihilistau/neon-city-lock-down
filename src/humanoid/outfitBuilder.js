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
  // starting on the body's own top station would put both tube caps in one
  // plane (z-fighting at the outer hip) — lift the garment's a hair above it
  if (pts[0].y >= LEG_STATIONS[0][0] * h - 1e-6) {
    pts.unshift(pts[0].clone().setY(pts[0].y + 0.006 * h));
    radii.unshift({ ...radii[0] });
  }
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

/* ───────────────────────────── layout ──────────────────────────────────── */
// Every garment's vertical extent and shell offset, as FRACTIONS OF HEIGHT, is
// decided here — once per recipe — and the piece generators below only sweep what
// the layout says. v0.6 defined each piece's hem/waist on its own, and it showed:
//   * leggings had no trunk band at all (they started on the thigh), so any top
//     + leggings kit left the hips and crotch as bare skin;
//   * shorts overlapped the top's hem by 0.003·h (half a centimetre) and ended at
//     0.50·h — the leg stations skip from 0.500 to 0.430, so `leg: 0.44` built a
//     much shorter leg than it read;
//   * top and waistband shared one clearance, so the sliver they did share
//     z-fought;
//   * garment legs began at the 0.552·h station while the body's thigh starts at
//     0.590·h and flares far past the pelvis — the outer hip showed bare thigh
//     between the waistband and the garment leg.
// The invariants (test/unit/outfits.test.mjs checks all of them per recipe):
//   * a bottom always has a waistband from the crotch seam up to its rise, unless
//     a one-piece (dress/robe/towel) already covers the hips, and its leg tubes
//     start at the body's own thigh top;
//   * a top worn with a bottom is TUCKED: its hem drops to rise − TUCK_OVERLAP and
//     the waistband is sized to sit OVER it;
//   * trunk layers that share heights nest — each one's inner surface clears the
//     outer surface of everything under it by LAYER_GAP.

/** how far a top's hem runs under its bottom's waistband, fraction of height (~3.4 cm at 1.7 m) */
export const TUCK_OVERLAP = 0.02;
/** air between one layer's outer surface and the next layer's inner, fraction of height */
const LAYER_GAP = 0.001;
/** the bottom's waistband top (its rise) unless the recipe says otherwise */
const RISE = 0.615;
/** where a waistband starts, under the pelvis cap — the crotch seam */
const SEAT = 0.505;
/** the body's leg tube starts here (LEG_STATIONS[0]); the thighs flare well past
 *  the pelvis, so at the outer hip this IS the silhouette — a bottom's leg tubes
 *  must reach it or the thigh top shows between them and the waistband */
const THIGH_TOP = LEG_STATIONS[0][0];

/**
 * Per-piece defaults. `trunk`/`legs` give [low, high] extents (fractions of
 * height), `order` is the stacking order (0 = next to skin), `clear`/`thick` are
 * multipliers on the configured clearance/thickness.
 * @type {Record<string, {role:'top'|'bottom'|'onepiece'|'outer', order:number, clear:number, thick:number,
 *   trunk:(o:any)=>[number,number], legs:(o:any)=>[number,number]|null, legClear?:number,
 *   flare?:number, count:number}>}
 */
const SPEC = {
  top: { role: 'top', order: 0, clear: 1, thick: 1, count: 11, trunk: (o) => [o.hem ?? 0.612, 0.806], legs: () => null },
  shorts: {
    // knee-length: the lowest station this sweeps is 0.362·h, just above the knee
    role: 'bottom', order: 1, clear: 1, thick: 1, count: 7, legClear: 1.35,
    trunk: (o) => [SEAT, o.rise ?? RISE], legs: (o) => [o.leg ?? 0.35, THIGH_TOP],
  },
  leggings: {
    role: 'bottom', order: 1, clear: 1, thick: 1, count: 7, legClear: 1,
    trunk: (o) => [SEAT, o.rise ?? RISE], legs: () => [0.050, THIGH_TOP],
  },
  dress: { role: 'onepiece', order: 1, clear: 1, thick: 1, count: 18, flare: 0.11, trunk: (o) => [o.hem ?? 0.36, 0.802], legs: () => null },
  towel: { role: 'onepiece', order: 1, clear: 1.9, thick: 1.8, count: 12, flare: 0.04, trunk: (o) => [o.hem ?? 0.40, 0.806], legs: () => null },
  robe: { role: 'onepiece', order: 2, clear: 3.4, thick: 1.6, count: 16, flare: 0.09, trunk: (o) => [o.hem ?? 0.38, 0.842], legs: () => null },
  jacket: { role: 'outer', order: 2, clear: 2.1, thick: 1, count: 10, trunk: () => [0.590, 0.836], legs: () => null },
};

/** the leg stations a [low, high] request actually sweeps → the real covered span */
function legSpan(lo, hi) {
  const ys = LEG_STATIONS.map((s) => s[0]).filter((y) => y <= hi + 1e-9 && y >= lo - 1e-9);
  return ys.length >= 2 ? /** @type {[number,number]} */ ([Math.min(...ys), Math.max(...ys)]) : null;
}

/**
 * @typedef {{piece:string, role:string, trunk:[number,number]|null, legs:[number,number]|null,
 *   clear:number, thick:number, legClear:number, count:number, flare:number, coverLegs:boolean}} Layer
 */

/**
 * Resolve a recipe into per-piece layers (all fractions of height). Pure — no
 * geometry — so the coverage invariants can be tested against every recipe.
 * `legs` is leg coverage: a leg tube's real station span, or for a one-piece
 * the skirt from its hem up to the thigh root.
 * @param {{pieces:{piece:string, opts?:any}[]}} recipe
 * @returns {Layer[]}
 */
export function outfitLayout(recipe) {
  const pieces = recipe?.pieces || [];
  const c = CLEAR(), T = THICK();
  const specs = pieces.map((p) => {
    const s = SPEC[p.piece];
    if (!s) throw new Error(`unknown outfit piece: ${p.piece}`);
    return s;
  });
  const hasOnePiece = specs.some((s) => s.role === 'onepiece');
  const rises = pieces.filter((_, i) => specs[i].role === 'bottom').map((p) => p.opts?.rise ?? RISE);
  const rise = rises.length ? Math.min(...rises) : null;

  /** @type {Layer[]} */
  const layers = pieces.map((p, i) => {
    const s = specs[i], o = p.opts || {};
    /** @type {[number,number]|null} */
    let trunk = s.trunk(o);
    // under a one-piece the waistband would only z-fight the skirt that hides it
    if (s.role === 'bottom' && hasOnePiece) trunk = null;
    // tuck the top into the waistband
    if (s.role === 'top' && rise != null && !hasOnePiece) {
      trunk = [Math.min(trunk[0], rise - TUCK_OVERLAP), trunk[1]];
    }
    const lr = s.legs(o);
    // ...and its leg tops: the skirt is swept out to exactly legOuterX + clear
    // over the thigh top, so leggings reaching it there would share that surface.
    // Under a skirt the thigh top is already covered, so they keep their v0.6
    // top station (0.552·h) rather than running up along the skirt's surface.
    const legTop = s.role === 'bottom' && hasOnePiece ? LEG_STATIONS[1][0] : Infinity;
    let legs = lr ? legSpan(lr[0], Math.min(lr[1], legTop)) : null;
    const coverLegs = s.role === 'onepiece';
    if (coverLegs) legs = [trunk[0], THIGH_TOP];
    const clear = s.clear * c;
    return {
      piece: p.piece, role: s.role, trunk, legs, clear,
      thick: Math.min(s.thick * T, clear * 0.85),
      legClear: s.legClear ?? 1, count: s.count, flare: s.flare ?? 0, coverLegs,
    };
  });

  // nest the trunk shells, innermost first: a layer that shares heights with one
  // under it is pushed out until its inner surface clears that layer's outer one
  const idx = layers.map((_, i) => i).filter((i) => layers[i].trunk)
    .sort((a, b) => specs[a].order - specs[b].order || a - b);
  for (let n = 0; n < idx.length; n++) {
    const L = layers[idx[n]];
    for (let m = 0; m < n; m++) {
      const U = layers[idx[m]];
      if (Math.min(L.trunk[1], U.trunk[1]) <= Math.max(L.trunk[0], U.trunk[0])) continue;
      if (L.clear - L.thick < U.clear + LAYER_GAP) {
        // band() keeps thick ≤ 0.85·clear; once clear exceeds need + thick that
        // cap is slack, so need + thick is exactly enough
        const thick = specs[idx[n]].thick * T;
        L.clear = U.clear + LAYER_GAP + thick;
        L.thick = Math.min(thick, L.clear * 0.85);
      }
    }
  }
  return layers;
}

/** one trunk band from a layer — tops, one-pieces, jacket bodies and waistbands */
function trunkPiece(b, L) {
  const h = b.height;
  const yLo = L.trunk[0] * h, yHi = L.trunk[1] * h;
  const { outer, inner } = band(b, yLo, yHi, {
    count: L.count, clear: L.clear, thick: L.thick, flare: L.flare, coverLegs: L.coverLegs,
  });
  return skinTrunk(shellGeo(outer, inner, RADIAL()), h, yLo, yHi);
}

/**
 * Piece generators. Each sweeps bind-pose geometry (with skinning attributes)
 * from its resolved layer.
 * @type {Record<string, (b:any, j:any, L:Layer) => THREE.BufferGeometry>}
 */
const PIECES = {
  /** fitted top: chest → waist (tucked when worn with a bottom). It ends just
   *  under the collarbone rather than capping the shoulder — a top narrowing at
   *  the top edge would have to dip INSIDE the chest to do it. */
  top: (b, j, L) => trunkPiece(b, L),

  /** dress: chest → above the knee, flared */
  dress: (b, j, L) => trunkPiece(b, L),

  /** shorts: waistband → just above the knee */
  shorts: bottomPiece,

  /** leggings: waistband → ankle */
  leggings: bottomPiece,

  /** open jacket shell over the torso + upper arms */
  jacket(b, j, L) {
    const h = b.height;
    const parts = [trunkPiece(b, L)];
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

  /** loose robe: shoulders → above the knee, draped */
  robe: (b, j, L) => trunkPiece(b, L),

  /** towel wrap: chest → above the knee, snug */
  towel: (b, j, L) => trunkPiece(b, L),
};

/** shorts/leggings: the waistband (unless a one-piece covers it) + two leg tubes */
function bottomPiece(b, j, L) {
  const h = b.height;
  const parts = [];
  if (L.trunk) parts.push(trunkPiece(b, L));
  for (const side of ['L', 'R']) {
    const leg = L.legs && legPiece(b, j, side, L.legs[1] * h, L.legs[0] * h, L.legClear);
    if (leg) parts.push(leg);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

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
  const layout = outfitLayout(recipe);
  (recipe?.pieces || []).forEach((p, i) => {
    const gen = PIECES[p.piece];
    if (!gen) throw new Error(`unknown outfit piece: ${p.piece}`);
    const geo = gen(persona.body, rig.joints, layout[i]);
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
  });
  return meshes;
}

const FABRIC_FOR = {
  jacket: 'leather', dress: 'silk', robe: 'velvet',
  top: 'cotton', shorts: 'denim', leggings: 'denim', towel: 'cotton',
};

/** @param {string} piece */
export function fabricForPiece(piece) {
  return FABRIC_FOR[piece] || null;
}

/** @param {THREE.MeshPhysicalMaterial} mat @param {string} piece */
/**
 * Per-fabric texture cache.
 *
 * bindFabric used to build a NEW TextureLoader and a NEW THREE.Texture per
 * garment piece, per actor, per outfit state — and Wardrobe.layers caches every
 * outfit set forever, so those accumulated and were never freed. Five characters
 * across four outfits is ~50 textures of the same five images.
 * @type {Map<string, THREE.Texture>}
 */
const fabricTextures = new Map();
let fabricLoader = null;

/** @param {string} kind @returns {THREE.Texture|null} */
function fabricTexture(kind) {
  if (typeof Image === 'undefined') return null;
  let tex = fabricTextures.get(kind);
  if (!tex) {
    fabricLoader = fabricLoader || new THREE.TextureLoader();
    tex = fabricLoader.load(`/assets/fabrics/${kind}.jpg`);
    // NOT SRGBColorSpace: this drives roughness and normal, which are data
    // channels, not colour. Tagging them sRGB gamma-decodes the values.
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2.2, 2.2);
    fabricTextures.set(kind, tex);
  }
  return tex;
}

/**
 * Give a garment its weave.
 *
 * This used to assign the fabric photo to `mat.map` — the ALBEDO slot — while
 * `mat.color` kept the recipe colour. Three multiplies the two, so a #15222c
 * jacket times a dark-brown leather photo came out effectively black, and every
 * garment in the game lost its hue. The sources also aren't tileable and the UVs
 * are normalised per-piece, so the weave scale differed between a top and a pair
 * of leggings.
 *
 * Fabric is SURFACE, not colour: it drives roughness (where the weave catches
 * light) and a normal map (the relief). `mat.color` stays the authored colour.
 * @param {THREE.MeshPhysicalMaterial} mat @param {string} piece
 */
function bindFabric(mat, piece) {
  const kind = fabricForPiece(piece);
  if (!kind) return;
  const tex = fabricTexture(kind);
  if (!tex) return;
  mat.roughnessMap = tex;
  mat.bumpMap = tex;
  mat.bumpScale = 0.012;
  mat.needsUpdate = true;
}
