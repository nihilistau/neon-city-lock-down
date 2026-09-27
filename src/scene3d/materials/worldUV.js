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
 * @returns {Float32Array} uv pairs
 */
export function boxProjectUVs(positions, normals, metresPerRepeat) {
  const n = positions.length / 3;
  const uv = new Float32Array(n * 2);
  const k = 1 / metresPerRepeat;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
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
 * @param {THREE.BufferGeometry} geometry
 * @param {number} metresPerRepeat
 */
export function applyWorldUVs(geometry, metresPerRepeat) {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  if (!pos || !nor || !(metresPerRepeat > 0)) return geometry;
  geometry.setAttribute('uv', new THREE.BufferAttribute(boxProjectUVs(pos.array, nor.array, metresPerRepeat), 2));
  return geometry;
}

/**
 * Rewrite every eligible box under `root`. Run once per floor after it is
 * built: it covers shells, furniture and inline architecture alike, so no
 * builder has to remember to call it.
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
    if (!mpr || g.userData.worldUV || !BOXY.has(g.type)) return;
    // local-space projection would misreport a scaled mesh's size
    if (Math.abs(mesh.scale.x - 1) + Math.abs(mesh.scale.y - 1) + Math.abs(mesh.scale.z - 1) > 1e-6) return;
    applyWorldUVs(g, mpr);
    g.userData.worldUV = mpr;
    n++;
  });
  return n;
}
