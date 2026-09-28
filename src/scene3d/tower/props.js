// @ts-check
// Fitting a loaded model into the room. Kenney models come in arbitrary units
// and pivots, so every prop is baked to world geometry, stood on its own
// origin, centred, scaled uniformly to a real height in metres, and re-skinned
// with one library material (with world UVs, since Kenney's atlas UVs mean
// nothing to a tiled PBR texture).
import * as THREE from 'three';
import { applyWorldUVs } from '../materials/worldUV.js';

/**
 * @param {THREE.Object3D} model a fresh clone from the asset facade — read, never mutated
 * @param {number} height target height in metres
 * @param {THREE.Material} material
 * @returns {THREE.Group}
 */
export function fitProp(model, height, material) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const h = box.max.y - box.min.y;
  const s = h > 1e-6 ? height / h : 1;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const mpr = material.userData?.metresPerRepeat ?? 1;
  const out = new THREE.Group();
  model.traverse((o) => {
    const mesh = /** @type {THREE.Mesh} */ (o);
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    g.translate(-cx, -box.min.y, -cz);
    g.scale(s, s, s);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    applyWorldUVs(g, mpr);
    const m = new THREE.Mesh(g, material);
    m.castShadow = m.receiveShadow = true;
    out.add(m);
  });
  return out;
}
