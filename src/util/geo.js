// @ts-check
// BufferGeometry helpers: merging, skinning attributes, primitive builders.
import * as THREE from 'three';

/**
 * Merge non-indexed-compatible BufferGeometries sharing the same attribute set.
 * Supports position/normal/uv/skinIndex/skinWeight.
 * @param {THREE.BufferGeometry[]} geos
 */
export function mergeGeometries(geos) {
  const attrNames = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight'];
  const merged = new THREE.BufferGeometry();
  /** @type {Record<string, number[]>} */
  const arrays = {};
  const index = [];
  let vertOffset = 0;

  for (const g of geos) {
    const geo = g.index ? g : g; // keep indexed; we offset indices
    const pos = geo.getAttribute('position');
    for (const name of attrNames) {
      const attr = geo.getAttribute(name);
      if (!attr) continue;
      if (!arrays[name]) arrays[name] = [];
      for (let i = 0; i < attr.count * attr.itemSize; i++) arrays[name].push(attr.array[i]);
    }
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) index.push(geo.index.array[i] + vertOffset);
    } else {
      for (let i = 0; i < pos.count; i++) index.push(i + vertOffset);
    }
    vertOffset += pos.count;
  }

  const itemSizes = { position: 3, normal: 3, uv: 2, skinIndex: 4, skinWeight: 4 };
  for (const [name, arr] of Object.entries(arrays)) {
    const ctor = name === 'skinIndex' ? Uint16Array : Float32Array;
    const attr = new THREE.BufferAttribute(new ctor(arr), itemSizes[name]);
    merged.setAttribute(name, attr);
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
 * Skin a geometry along a bone chain measured by a scalar axis (default: vertex Y).
 * Chain entries must be ordered ASCENDING and contiguous: chain[s].to === chain[s+1].from.
 * Vertices blend linearly across `band` either side of each boundary (50/50 at the
 * boundary itself) — max 2 influences by construction.
 * @param {THREE.BufferGeometry} geo
 * @param {{bone:number, from:number, to:number}[]} chain
 * @param {number} [band] blend half-width in meters
 * @param {(x:number,y:number,z:number)=>number} [axisFn] vertex → scalar along the chain
 */
export function chainSkin(geo, chain, band = 0.045, axisFn) {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  const getT = axisFn || ((x, y, z) => y);

  for (let i = 0; i < n; i++) {
    const t = getT(pos.getX(i), pos.getY(i), pos.getZ(i));
    let seg = chain.length - 1;
    for (let s = 0; s < chain.length; s++) {
      if (t <= chain[s].to) { seg = s; break; }
    }
    const cur = chain[seg];
    let w0 = 1, otherBone = cur.bone;
    const dUp = seg + 1 < chain.length ? cur.to - t : Infinity;  // toward next boundary
    const dDn = seg > 0 ? t - cur.from : Infinity;               // toward previous boundary
    if (dUp < band && dUp <= dDn) {
      w0 = 0.5 + 0.5 * (dUp / band);          // 1 at band distance → 0.5 at boundary
      otherBone = chain[seg + 1].bone;
    } else if (dDn < band) {
      w0 = 0.5 + 0.5 * (dDn / band);
      otherBone = chain[seg - 1].bone;
    }
    idx[i * 4] = cur.bone; w[i * 4] = w0;
    idx[i * 4 + 1] = otherBone; w[i * 4 + 1] = 1 - w0;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
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
  const newIdx = new Uint32Array(idx.count);
  for (let i = 0; i < idx.count; i++) newIdx[i] = remap[idx.getX(i)];

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(keptPos), 3));
  if (si) out.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(keptSI), 4));
  if (sw) out.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(keptSW), 4));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(keptUV), 2));
  out.setIndex(new THREE.BufferAttribute(newIdx, 1));
  out.computeVertexNormals();
  return out;
}
