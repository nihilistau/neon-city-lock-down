// @ts-check
// src/scene3d/materials/worldUV.js — texel density that does not depend on
// object size. BoxGeometry maps its 0..1 UVs across every face, so the same
// texture stretched once over a 2.4 m counter and once over a 0.3 m shelf: the
// wood grain on the shelf was eight times finer. Box-projecting from the
// vertex positions gives one repeat per N metres everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { boxProjectUVs, applyWorldUVs, applyWorldUVsTo } from '../../src/scene3d/materials/worldUV.js';

/** span of one UV component over the vertices whose normal equals `n` */
function faceSpan(geo, n, comp) {
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < nor.count; i++) {
    if (nor.getX(i) !== n[0] || nor.getY(i) !== n[1] || nor.getZ(i) !== n[2]) continue;
    const v = comp === 0 ? uv.getX(i) : uv.getY(i);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi - lo;
}
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('a 2.4 m counter and a 0.3 m shelf get the same texel density', () => {
  const counter = applyWorldUVs(new THREE.BoxGeometry(2.4, 1, 0.6), 1.2);
  const shelf = applyWorldUVs(new THREE.BoxGeometry(0.3, 0.04, 0.25), 1.2);
  assert.ok(near(faceSpan(counter, [0, 0, 1], 0), 2.0), '2.4 m at 1.2 m per repeat = 2 repeats');
  assert.ok(near(faceSpan(shelf, [0, 0, 1], 0), 0.25));
  assert.ok(near(faceSpan(counter, [0, 0, 1], 0) / 2.4, faceSpan(shelf, [0, 0, 1], 0) / 0.3), 'repeats per metre match');
});

test('each face projects along its own plane', () => {
  const g = applyWorldUVs(new THREE.BoxGeometry(2, 3, 4), 1);
  assert.ok(near(faceSpan(g, [0, 1, 0], 0), 2), 'top: u runs along X');
  assert.ok(near(faceSpan(g, [0, 1, 0], 1), 4), 'top: v runs along Z');
  assert.ok(near(faceSpan(g, [1, 0, 0], 0), 4), 'side: u runs along Z');
  assert.ok(near(faceSpan(g, [1, 0, 0], 1), 3), 'side: v runs up Y');
  assert.ok(near(faceSpan(g, [0, 0, -1], 1), 3));
});

test('halving metres-per-repeat doubles the repeats', () => {
  const a = applyWorldUVs(new THREE.BoxGeometry(1, 1, 1), 1);
  const b = applyWorldUVs(new THREE.BoxGeometry(1, 1, 1), 0.5);
  assert.ok(near(faceSpan(b, [0, 0, 1], 0), 2 * faceSpan(a, [0, 0, 1], 0)));
});

test('boxProjectUVs on raw arrays', () => {
  const uv = boxProjectUVs(new Float32Array([1, 2, 3]), new Float32Array([0, 0, 1]), 2);
  assert.deepEqual([...uv], [0.5, 1]);
});

test('applyWorldUVs is a no-op without normals or with a bad scale', () => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const before = g.getAttribute('uv');
  applyWorldUVs(g, 0);
  assert.equal(g.getAttribute('uv'), before);
  g.deleteAttribute('normal');
  applyWorldUVs(g, 1);
  assert.equal(g.getAttribute('uv'), before);
});

test('applyWorldUVsTo rewrites unscaled boxes with a metres-per-repeat material, once', () => {
  const tiled = new THREE.MeshStandardMaterial();
  tiled.userData.metresPerRepeat = 2;
  const root = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.2), tiled);
  const scaled = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), tiled);
  scaled.scale.set(3, 1, 1);   // local-space projection would misreport its size
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4), tiled);
  const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  root.add(wall, scaled, pipe, plain);
  assert.equal(applyWorldUVsTo(root), 1);
  assert.equal(wall.geometry.userData.worldUV, 2);
  assert.ok(near(faceSpan(wall.geometry, [0, 0, 1], 0), 3));
  assert.equal(scaled.geometry.userData.worldUV, undefined);
  assert.equal(pipe.geometry.userData.worldUV, undefined);
  assert.equal(plain.geometry.userData.worldUV, undefined);
  assert.equal(applyWorldUVsTo(root), 0, 'idempotent');
});
