// @ts-check
// World-scale UVs: one texture repeat per N metres on every face, whatever the
// size of the box. BoxGeometry's own UVs run 0..1 across every face, so one
// texture stretched once over a 2.4 m counter and once over a 0.3 m shelf. Box
// projection from local vertex positions fixes the density; the per-material N
// lives on the material (`userData.metresPerRepeat`, set by materials/pbr.js).
import * as THREE from 'three';

/** Geometry types that are axis-aligned boxes. RoundedBoxGeometry extends BoxGeometry. */
const BOXY = new Set(['BoxGeometry', 'RoundedBoxGeometry']);

/**
 * PURE. Planar-project each vertex onto the plane its normal is most aligned
 * with. Signs flip on the negative faces so no face shows its texture mirrored.
 * @param {ArrayLike<number>} positions xyz triples (local space, metres)
 * @param {ArrayLike<number>} normals xyz triples
 * @param {number} metresPerRepeat
 * @param {ArrayLike<number>} [scale] the mesh's own xyz scale, so a scaled box
 *   gets the density of its WORLD size rather than of its unit geometry
 * @returns {Float32Array} uv pairs
 */
export function boxProjectUVs(positions, normals, metresPerRepeat, scale = [1, 1, 1]) {
  const n = positions.length / 3;
  const uv = new Float32Array(n * 2);
  const k = 1 / metresPerRepeat;
  const sx = Math.abs(scale[0]), sy = Math.abs(scale[1]), sz = Math.abs(scale[2]);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3] * sx, y = positions[i * 3 + 1] * sy, z = positions[i * 3 + 2] * sz;
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let u, v;
    if (ax >= ay && ax >= az) { u = nx > 0 ? -z : z; v = y; }      // ±X faces run along Z
    else if (ay >= az) { u = x; v = ny > 0 ? -z : z; }               // ±Y faces: plan view
    else { u = nz > 0 ? x : -x; v = y; }                             // ±Z faces run along X
    uv[i * 2] = u * k;
    uv[i * 2 + 1] = v * k;
  }
  return uv;
}

/**
 * Cylinder: the side wall unrolls to arc length × height, so a 4 cm pipe and a
 * 0.6 m column carry the same grain; the caps project in plan. CylinderGeometry
 * emits the side wall first — (radialSegments+1)·(heightSegments+1) vertices,
 * with its own u already running 0..1 around thetaLength (seam duplicated) —
 * then the caps, so the old u gives the angle without an atan2 seam.
 * @param {THREE.BufferGeometry & {parameters: any}} g
 * @param {number} k 1 / metresPerRepeat
 * @param {number[]} s mesh scale xyz
 */
function cylinderUVs(g, k, [sx, sy, sz]) {
  const pos = g.getAttribute('position'), old = g.getAttribute('uv');
  const { radialSegments, heightSegments, thetaLength } = g.parameters;
  const torso = (radialSegments + 1) * (heightSegments + 1);
  const sr = (Math.abs(sx) + Math.abs(sz)) / 2;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (i < torso) {
      const r = Math.hypot(x, z) * sr;   // per row, so a tapered cone keeps its density too
      uv[i * 2] = old.getX(i) * thetaLength * r * k;
      uv[i * 2 + 1] = y * Math.abs(sy) * k;
    } else {
      uv[i * 2] = x * Math.abs(sx) * k;
      uv[i * 2 + 1] = z * Math.abs(sz) * k;
    }
  }
  return uv;
}

/**
 * Sphere: its own u/v are angle fractions, so scale them by the arc lengths.
 * @param {THREE.BufferGeometry & {parameters: any}} g @param {number} k @param {number[]} s
 */
function sphereUVs(g, k, [sx, sy, sz]) {
  const old = g.getAttribute('uv');
  const { radius, phiLength, thetaLength } = g.parameters;
  const r = radius * (Math.abs(sx) + Math.abs(sy) + Math.abs(sz)) / 3;
  const uv = new Float32Array(old.count * 2);
  for (let i = 0; i < old.count; i++) {
    uv[i * 2] = old.getX(i) * phiLength * r * k;
    uv[i * 2 + 1] = old.getY(i) * thetaLength * r * k;
  }
  return uv;
}

/** Geometry types applyWorldUVs knows how to project. */
const PROJECTABLE = new Set([...BOXY, 'CylinderGeometry', 'SphereGeometry']);

/**
 * @param {THREE.BufferGeometry} geometry
 * @param {number} metresPerRepeat
 * @param {number[]} [scale] the owning mesh's scale (xyz); default unscaled
 * @param {boolean} [rotate] swap U and V (materials/pbr.js `rotate`: plank boards along the panel)
 */
export function applyWorldUVs(geometry, metresPerRepeat, scale = [1, 1, 1], rotate = false) {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  if (!pos || !nor || !(metresPerRepeat > 0)) return geometry;
  const g = /** @type {THREE.BufferGeometry & {parameters: any}} */ (geometry);
  const k = 1 / metresPerRepeat;
  const uv = g.type === 'CylinderGeometry' && g.getAttribute('uv') ? cylinderUVs(g, k, scale)
    : g.type === 'SphereGeometry' && g.getAttribute('uv') ? sphereUVs(g, k, scale)
      : boxProjectUVs(pos.array, nor.array, metresPerRepeat, scale);
  if (rotate) for (let i = 0; i < uv.length; i += 2) { const u = uv[i]; uv[i] = uv[i + 1]; uv[i + 1] = u; }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/**
 * Rewrite every eligible box, cylinder and sphere under `root`. Run once per
 * floor after it is built: it covers shells, furniture and inline architecture
 * alike, so no builder has to remember to call it. A scaled mesh is projected
 * at its scaled size. The scale is read once, at build: a geometry shared by
 * meshes of different scales takes the first one's (none in the tower do).
 * @param {THREE.Object3D} root
 * @returns {number} geometries rewritten
 */
export function applyWorldUVsTo(root) {
  let n = 0;
  root.traverse((o) => {
    const mesh = /** @type {THREE.Mesh} */ (o);
    if (!mesh.isMesh || /** @type {any} */ (mesh).isInstancedMesh || Array.isArray(mesh.material)) return;
    const mpr = /** @type {THREE.Material} */ (mesh.material)?.userData?.metresPerRepeat;
    const g = mesh.geometry;
    if (!mpr || g.userData.worldUV || !PROJECTABLE.has(g.type)) return;
    applyWorldUVs(g, mpr, mesh.scale.toArray(), mesh.material.userData.uvRotate === true);
    g.userData.worldUV = mpr;
    n++;
  });
  return n;
}
