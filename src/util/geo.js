// @ts-check
// BufferGeometry helpers: merging, skinning attributes, primitive + swept builders.
//
// Skinning note (why this file matters): the avatars are ONE merged, welded,
// vertex-skinned mesh. Before the v0.3 avatar pass `chainSkin` capped skinning at
// two influences with a LINEAR 50/50 band, which candy-wraps a limb at every
// elbow/knee — the volume pinches to nothing at ~90°. The body builder papered
// over that by pasting spheres at each joint, which then read as detached balls.
// The fix is here, not there: smooth (smoothstep) falloff, up to 4 influences,
// plus `blendBoneInfluence` so a deltoid/glute can be part-driven by the limb
// bone (a "tri-chain") instead of shearing off the torso.
import * as THREE from 'three';

/** Hermite smoothstep on an already-normalised 0..1 parameter. */
export function smooth01(u) {
  const t = u < 0 ? 0 : u > 1 ? 1 : u;
  return t * t * (3 - 2 * t);
}

/** Max bone influences we ever write. GPU skinning in three is vec4-based. */
export const MAX_INFLUENCES = 4;

/**
 * Merge BufferGeometries into one indexed geometry.
 * Attributes missing from a source geometry are zero-filled so a part without
 * (say) uv can no longer shift every following part's attribute stream — that
 * silent misalignment was a landmine as soon as a hand-built part skipped one.
 * @param {THREE.BufferGeometry[]} geos
 */
export function mergeGeometries(geos) {
  const itemSizes = { position: 3, normal: 3, uv: 2, skinIndex: 4, skinWeight: 4 };
  // union of attributes present anywhere, in a stable order
  const attrNames = Object.keys(itemSizes).filter((n) => geos.some((g) => g.getAttribute(n)));
  const merged = new THREE.BufferGeometry();
  /** @type {Record<string, number[]>} */
  const arrays = {};
  for (const name of attrNames) arrays[name] = [];
  const index = [];
  let vertOffset = 0;

  for (const geo of geos) {
    const pos = geo.getAttribute('position');
    if (!pos) continue;
    for (const name of attrNames) {
      const attr = geo.getAttribute(name);
      const size = itemSizes[name];
      const dst = arrays[name];
      if (attr) {
        for (let i = 0; i < attr.count * size; i++) dst.push(attr.array[i]);
      } else {
        for (let i = 0; i < pos.count * size; i++) dst.push(0);
      }
    }
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) index.push(geo.index.array[i] + vertOffset);
    } else {
      for (let i = 0; i < pos.count; i++) index.push(i + vertOffset);
    }
    vertOffset += pos.count;
  }

  for (const name of attrNames) {
    const ctor = name === 'skinIndex' ? Uint16Array : Float32Array;
    merged.setAttribute(name, new THREE.BufferAttribute(new ctor(arrays[name]), itemSizes[name]));
  }
  merged.setIndex(index);
  return merged;
}

/**
 * Fill skinIndex/skinWeight so every vertex follows `boneIndex` rigidly.
 * @param {THREE.BufferGeometry} geo @param {number} boneIndex
 */
export function rigidSkin(geo, boneIndex) {
  const n = geo.getAttribute('position').count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { idx[i * 4] = boneIndex; w[i * 4] = 1; }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  return geo;
}

/**
 * Write one vertex's (bone → weight) map into the skin attributes: cull dust,
 * keep the 4 heaviest, renormalise to sum 1.
 * @param {Map<number, number>} acc @param {Uint16Array} idx @param {Float32Array} w @param {number} i
 */
function writeInfluences(acc, idx, w, i) {
  const list = [...acc.entries()].filter(([, v]) => v > 1e-4).sort((a, b) => b[1] - a[1]);
  list.length = Math.min(list.length, MAX_INFLUENCES);
  let sum = 0;
  for (const [, v] of list) sum += v;
  const o = i * 4;
  idx[o] = idx[o + 1] = idx[o + 2] = idx[o + 3] = 0;
  w[o] = w[o + 1] = w[o + 2] = w[o + 3] = 0;
  if (sum <= 0) { w[o] = 1; return; }   // degenerate: pin to bone 0 rather than emit NaN
  for (let k = 0; k < list.length; k++) {
    idx[o + k] = list[k][0];
    w[o + k] = list[k][1] / sum;
  }
}

/**
 * Skin a geometry along a bone chain from a PRECOMPUTED per-vertex scalar
 * (arc length along a swept limb, or a world axis). Chain entries must be
 * ordered ASCENDING and contiguous: chain[s].to === chain[s+1].from.
 *
 * Each bone owns [from, to] at full weight and fades out over `band` beyond
 * each end with a smoothstep, so a vertex inside a band picks up 2 influences
 * and a vertex inside a SHORT segment (shorter than 2·band, e.g. a wrist or a
 * neck) picks up 3 — that third influence is what stops the candy-wrap.
 * @param {THREE.BufferGeometry} geo
 * @param {ArrayLike<number>} scalars per-vertex position along the chain
 * @param {{bone:number, from:number, to:number}[]} chain
 * @param {number} [band] blend half-width, in the scalar's units
 */
export function chainSkinScalars(geo, scalars, chain, band = 0.045) {
  const n = geo.getAttribute('position').count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  const last = chain.length - 1;
  const inv = band > 0 ? 1 / (2 * band) : 1e9;
  /** @type {Map<number, number>} */
  const acc = new Map();

  for (let i = 0; i < n; i++) {
    const t = scalars[i];
    acc.clear();
    let best = 0, bestW = -1;
    for (let s = 0; s <= last; s++) {
      const seg = chain[s];
      let v = 1;
      if (s > 0) v *= smooth01((t - (seg.from - band)) * inv);
      if (s < last) v *= smooth01(((seg.to + band) - t) * inv);
      if (v > bestW) { bestW = v; best = seg.bone; }
      if (v > 0) acc.set(seg.bone, (acc.get(seg.bone) || 0) + v);
    }
    if (acc.size === 0) acc.set(best, 1);
    writeInfluences(acc, idx, w, i);
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  return geo;
}

/**
 * Skin along a bone chain measured by a scalar function of vertex position
 * (default: vertex Y). Thin wrapper over {@link chainSkinScalars}.
 * @param {THREE.BufferGeometry} geo
 * @param {{bone:number, from:number, to:number}[]} chain
 * @param {number} [band] blend half-width in meters
 * @param {(x:number,y:number,z:number)=>number} [axisFn] vertex → scalar along the chain
 */
export function chainSkin(geo, chain, band = 0.045, axisFn) {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const getT = axisFn || ((x, y, z) => y);
  const scalars = new Float32Array(n);
  for (let i = 0; i < n; i++) scalars[i] = getT(pos.getX(i), pos.getY(i), pos.getZ(i));
  return chainSkinScalars(geo, scalars, chain, band);
}

/**
 * Blend an EXTRA bone into an already-skinned geometry — the "tri-chain".
 *
 * A deltoid skinned purely to the chest shears off the torso when the arm
 * lifts; a glute skinned purely to the thigh shears off the hips when the leg
 * swings. Mixing a fraction of the limb bone into the surrounding torso shell
 * (and vice versa) makes the mass deform WITH the limb, which is what let the
 * pasted joint spheres go away.
 *
 * @param {THREE.BufferGeometry} geo must already carry skinIndex/skinWeight
 * @param {number} boneIndex bone to mix in
 * @param {(x:number,y:number,z:number)=>number} weightFn vertex → 0..1 share for that bone
 */
export function blendBoneInfluence(geo, boneIndex, weightFn) {
  const pos = geo.getAttribute('position');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  if (!si || !sw) throw new Error('blendBoneInfluence: geometry is not skinned yet');
  const n = pos.count;
  const idx = /** @type {Uint16Array} */ (si.array);
  const w = /** @type {Float32Array} */ (sw.array);
  /** @type {Map<number, number>} */
  const acc = new Map();

  for (let i = 0; i < n; i++) {
    const share = weightFn(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (!(share > 0)) continue;
    const k = Math.min(1, share);
    acc.clear();
    const o = i * 4;
    for (let c = 0; c < 4; c++) if (w[o + c] > 0) acc.set(idx[o + c], (acc.get(idx[o + c]) || 0) + w[o + c] * (1 - k));
    acc.set(boneIndex, (acc.get(boneIndex) || 0) + k);
    writeInfluences(acc, idx, w, i);
  }
  si.needsUpdate = true;
  sw.needsUpdate = true;
  return geo;
}

/**
 * Capsule-ish limb segment between two points, tapered.
 * Returns geometry in bind-pose world space.
 * @param {THREE.Vector3} a start (proximal joint)
 * @param {THREE.Vector3} b end (distal joint)
 * @param {number} r0 radius at a @param {number} r1 radius at b
 * @param {number} [radial]
 */
export function limbGeo(a, b, r0, r1, radial = 16) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r1, r0, len, radial, 8, false);
  // cylinder is centered at origin along Y; move so -Y end sits at a, +Y at b... cylinder +Y = top = r1 end
  geo.translate(0, len / 2, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  geo.applyQuaternion(quat);
  geo.translate(a.x, a.y, a.z);
  return geo;
}

/**
 * Lathe profile body segment (elliptical after z-scale).
 * @param {Array<[number, number]>} profile  [y, radius] pairs bottom→top (world y)
 * @param {number} zScale flatten front-back
 * @param {number} [radial]
 */
export function latheGeo(profile, zScale = 0.74, radial = 24) {
  const pts = profile.map(([y, r]) => new THREE.Vector2(Math.max(0.001, r), y));
  const geo = new THREE.LatheGeometry(pts, radial);
  geo.scale(1, 1, zScale);
  geo.computeVertexNormals();
  return geo;
}

/** UV-sphere part, scaled+translated, in bind space. */
export function ballGeo(center, r, scale = { x: 1, y: 1, z: 1 }, seg = 18) {
  const geo = new THREE.SphereGeometry(r, seg, Math.max(12, Math.floor(seg * 0.8)));
  geo.scale(scale.x, scale.y, scale.z);
  geo.translate(center.x, center.y, center.z);
  return geo;
}

/**
 * Mirrored circumferential UV: 0 at the seam, 1 at the far side, 0 again at the
 * seam. A cylindrical u that wraps 0→1 leaves ONE quad spanning the whole
 * texture (a squashed band down the limb) once coincident seam verts are welded;
 * mirroring is seamless and, for the noise-y skin map, visually identical.
 */
function ringU(i, radial) {
  const t = (2 * i) / radial;
  return 1 - Math.abs(t - 1);
}

/**
 * @typedef {Object} Ring
 * @property {number} y            ring height (world y)
 * @property {number} rx           half-width  (x)
 * @property {number} [rz]         half-depth  (z), defaults to rx
 * @property {number} [cx]         ring centre x offset
 * @property {number} [cz]         ring centre z offset
 */

/**
 * Generalised lathe: a stack of elliptical rings with independent width, depth
 * and centre offset. Unlike LatheGeometry this can push the chin forward, flatten
 * the back of the skull and widen the shoulders on ONE continuous surface, which
 * is how the torso→neck→head stops reading as "ball on a stick".
 * @param {Ring[]} rings bottom→top
 * @param {number} [radial]
 * @param {{capBottom?:boolean, capTop?:boolean}} [opts]
 * @returns {{geo: THREE.BufferGeometry, ys: Float32Array}} ys = per-vertex ring height
 */
export function stackGeo(rings, radial = 20, opts = {}) {
  const pos = [], uv = [], index = [], ys = [];
  const nr = rings.length;
  for (let r = 0; r < nr; r++) {
    const ring = rings[r];
    const rz = ring.rz ?? ring.rx;
    const cx = ring.cx ?? 0, cz = ring.cz ?? 0;
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      pos.push(cx + ring.rx * Math.sin(a), ring.y, cz + rz * Math.cos(a));
      uv.push(ringU(i, radial), r / (nr - 1));
      ys.push(ring.y);
    }
  }
  for (let r = 0; r < nr - 1; r++) {
    for (let i = 0; i < radial; i++) {
      const a = r * radial + i, b = r * radial + ((i + 1) % radial);
      const c = a + radial, d = b + radial;
      // winding: rings run x=rx·sin(a), z=rz·cos(a) — i.e. CLOCKWISE seen from
      // +Y — so (a,b,c)/(b,d,c) is the outward-facing order. Getting this
      // backwards silently inverts every normal and the body lights inside-out.
      index.push(a, b, c, b, d, c);
    }
  }
  if (opts.capBottom !== false) {
    const c = pos.length / 3;
    pos.push(rings[0].cx ?? 0, rings[0].y, rings[0].cz ?? 0);
    uv.push(0.5, 0); ys.push(rings[0].y);
    for (let i = 0; i < radial; i++) index.push(c, (i + 1) % radial, i);
  }
  if (opts.capTop !== false) {
    const base = (nr - 1) * radial;
    const c = pos.length / 3;
    const top = rings[nr - 1];
    pos.push(top.cx ?? 0, top.y, top.cz ?? 0);
    uv.push(0.5, 1); ys.push(top.y);
    for (let i = 0; i < radial; i++) index.push(c, base + i, base + ((i + 1) % radial));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return { geo, ys: new Float32Array(ys) };
}

/**
 * Sweep a closed elliptical ring along a polyline — the continuous-limb builder.
 *
 * Frames are parallel-transported (each frame is the previous one rotated by the
 * minimal rotation between successive tangents) so the tube does not spin about
 * its own axis at a bend, which would twist the skin texture and the elliptical
 * cross-section at every knee.
 *
 * @param {THREE.Vector3[]} pts path points, ≥2
 * @param {{rx:number, rz?:number}[]} radii one per path point
 * @param {number} [radial]
 * @param {{capStart?:boolean, capEnd?:boolean, up?:THREE.Vector3}} [opts]
 * @returns {{geo: THREE.BufferGeometry, arc: Float32Array, total: number}}
 *          arc = per-vertex arc length from pts[0]; total = full path length
 */
export function tubeGeo(pts, radii, radial = 14, opts = {}) {
  const n = pts.length;
  if (n < 2) throw new Error('tubeGeo: need ≥2 path points');
  // cumulative arc length per path point
  const s = new Float32Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + pts[i].distanceTo(pts[i - 1]);
  const total = s[n - 1];

  // tangents (central differences at interior points)
  /** @type {THREE.Vector3[]} */
  const tan = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const t = b.clone().sub(a);
    if (t.lengthSq() < 1e-12) t.copy(pts[Math.min(n - 1, i + 1)]).sub(pts[Math.max(0, i - 1)]);
    tan.push(t.normalize());
  }

  // parallel-transported frame
  const up = opts.up ? opts.up.clone() : new THREE.Vector3(0, 0, 1);
  let nrm = up.clone().sub(tan[0].clone().multiplyScalar(up.dot(tan[0])));
  if (nrm.lengthSq() < 1e-8) nrm.set(1, 0, 0).sub(tan[0].clone().multiplyScalar(tan[0].x));
  nrm.normalize();
  let bin = new THREE.Vector3().crossVectors(tan[0], nrm).normalize();

  const pos = [], uv = [], index = [], arc = [];
  const q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      q.setFromUnitVectors(tan[i - 1], tan[i]);
      nrm.applyQuaternion(q).normalize();
      bin.crossVectors(tan[i], nrm).normalize();
      nrm.crossVectors(bin, tan[i]).normalize();
    }
    const rx = radii[i].rx, rz = radii[i].rz ?? radii[i].rx;
    const v = s[i] / (total || 1);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const ca = Math.cos(a) * rx, sa = Math.sin(a) * rz;
      pos.push(
        pts[i].x + nrm.x * ca + bin.x * sa,
        pts[i].y + nrm.y * ca + bin.y * sa,
        pts[i].z + nrm.z * ca + bin.z * sa
      );
      uv.push(ringU(k, radial), v);
      arc.push(s[i]);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k, b = i * radial + ((k + 1) % radial);
      index.push(a, b, a + radial, b, b + radial, a + radial);
    }
  }
  if (opts.capStart) {
    const c = pos.length / 3;
    pos.push(pts[0].x, pts[0].y, pts[0].z); uv.push(0.5, 0); arc.push(s[0]);
    for (let k = 0; k < radial; k++) index.push(c, (k + 1) % radial, k);
  }
  if (opts.capEnd) {
    const base = (n - 1) * radial;
    const c = pos.length / 3;
    pos.push(pts[n - 1].x, pts[n - 1].y, pts[n - 1].z); uv.push(0.5, 1); arc.push(s[n - 1]);
    for (let k = 0; k < radial; k++) index.push(c, base + k, base + ((k + 1) % radial));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return { geo, arc: new Float32Array(arc), total };
}

/**
 * Garment shell: an outer ring stack plus an inner one, joined at both hems.
 * Gives a garment a visible EDGE — a hem you can see the thickness of — instead
 * of a zero-width surface that needs DoubleSide and still reads as paint on the
 * skin. Both stacks must be bottom→top with matching lengths.
 * @param {Ring[]} outer @param {Ring[]} inner @param {number} [radial]
 */
export function shellGeo(outer, inner, radial = 18) {
  // inner surface runs top→bottom so its winding flips (it faces inward)
  const rings = [...outer, ...inner.slice().reverse()];
  const { geo } = stackGeo(rings, radial, { capBottom: false, capTop: false });
  // stackGeo already stitched outer-top → inner-top (that quad band IS the top
  // hem, since both rings sit at the same y). Only the bottom hem is left open.
  const idx = /** @type {number[]} */ (Array.from(geo.getIndex().array));
  const first = 0;                                 // outer bottom ring
  const lastInner = (rings.length - 1) * radial;   // inner bottom ring (reversed → last)
  for (let i = 0; i < radial; i++) {
    const a = first + i, b = first + ((i + 1) % radial);
    const c = lastInner + i, d = lastInner + ((i + 1) % radial);
    idx.push(a, c, b, b, c, d);   // faces -Y
  }
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Weld coincident vertices (within eps) and recompute smooth normals. Used after
 * merging body parts so the seams between limb segments / joint caps blend
 * instead of showing hard normal creases. Preserves position + skin attributes.
 * @param {THREE.BufferGeometry} geo indexed geometry
 * @param {number} [eps]
 */
export function weldGeometry(geo, eps = 1e-4) {
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex();
  if (!pos || !idx) return geo;
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const uv = geo.getAttribute('uv');
  const q = 1 / eps;
  /** @type {Map<string, number>} */
  const map = new Map();
  const remap = new Int32Array(pos.count);
  const keptPos = [], keptSI = [], keptSW = [], keptUV = [];
  let next = 0;
  for (let i = 0; i < pos.count; i++) {
    const kx = Math.round(pos.getX(i) * q), ky = Math.round(pos.getY(i) * q), kz = Math.round(pos.getZ(i) * q);
    // Include the skin binding in the key so two coincident verts bound to
    // DIFFERENT bones/weights are never welded into one (that discarded one
    // side's weights and pulled seam verts toward the wrong bone).
    let key = `${kx},${ky},${kz}`;
    if (si) key += `|${si.getX(i)},${si.getY(i)},${si.getZ(i)},${si.getW(i)}`;
    if (sw) key += `|${Math.round(sw.getX(i) * 100)},${Math.round(sw.getY(i) * 100)},${Math.round(sw.getZ(i) * 100)},${Math.round(sw.getW(i) * 100)}`;
    let vi = map.get(key);
    if (vi === undefined) {
      vi = next++;
      map.set(key, vi);
      keptPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (si) keptSI.push(si.getX(i), si.getY(i), si.getZ(i), si.getW(i));
      if (sw) keptSW.push(sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i));
      if (uv) keptUV.push(uv.getX(i), uv.getY(i));
    }
    remap[i] = vi;
  }
  const newIdx = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = remap[idx.getX(i)], b = remap[idx.getX(i + 1)], c = remap[idx.getX(i + 2)];
    // welding a fan apex collapses its ring of duplicates into one vertex, which
    // turns the surrounding triangles degenerate — drop them rather than ship
    // zero-area faces that pollute normals and the watertightness invariant.
    if (a === b || b === c || a === c) continue;
    newIdx.push(a, b, c);
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(keptPos), 3));
  if (si) out.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(keptSI), 4));
  if (sw) out.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(keptSW), 4));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(keptUV), 2));
  out.setIndex(new THREE.BufferAttribute(new Uint32Array(newIdx), 1));
  out.computeVertexNormals();
  return out;
}
