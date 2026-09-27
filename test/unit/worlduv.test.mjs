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

test('applyWorldUVsTo rewrites boxes, scaled boxes and cylinders with a metres-per-repeat material, once', () => {
  const tiled = new THREE.MeshStandardMaterial();
  tiled.userData.metresPerRepeat = 2;
  const root = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.2), tiled);
  const scaled = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), tiled);
  scaled.scale.set(3, 1, 1);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4), tiled);
  const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1), tiled);   // no projection for it: left alone
  root.add(wall, scaled, pipe, plain, ring);
  assert.equal(applyWorldUVsTo(root), 3);
  assert.equal(wall.geometry.userData.worldUV, 2);
  assert.ok(near(faceSpan(wall.geometry, [0, 0, 1], 0), 3));
  assert.ok(near(faceSpan(scaled.geometry, [0, 0, 1], 0), 1.5), 'a 1 m box scaled ×3 is 3 m wide: 1.5 repeats');
  assert.ok(near(faceSpan(scaled.geometry, [0, 0, 1], 1), 0.5), 'its unscaled height stays 1 m');
  assert.equal(pipe.geometry.userData.worldUV, 2);
  assert.equal(plain.geometry.userData.worldUV, undefined);
  assert.equal(ring.geometry.userData.worldUV, undefined);
  assert.equal(applyWorldUVsTo(root), 0, 'idempotent');
});

/** u/v span over the side wall of a CylinderGeometry (the torso vertices come first) */
function torsoSpan(geo, comp) {
  const { radialSegments, heightSegments } = geo.parameters;
  const uv = geo.getAttribute('uv');
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < (radialSegments + 1) * (heightSegments + 1); i++) {
    const v = comp === 0 ? uv.getX(i) : uv.getY(i);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi - lo;
}

test('a cylinder wraps once around its circumference at world scale, not once per object', () => {
  // the fireplace log, the stool, the lobby column: BoxGeometry-only UVs left
  // these on CylinderGeometry's 0..1, one texture stretched around a 4 cm pipe
  // and around a 2 m column alike
  const log = applyWorldUVs(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8), 1.8);
  const column = applyWorldUVs(new THREE.CylinderGeometry(0.3, 0.3, 4.4, 12), 2.5);
  assert.ok(near(torsoSpan(log, 0), (2 * Math.PI * 0.06) / 1.8), 'u = circumference / metres-per-repeat');
  assert.ok(near(torsoSpan(log, 1), 0.6 / 1.8), 'v = height / metres-per-repeat');
  assert.ok(near(torsoSpan(column, 0), (2 * Math.PI * 0.3) / 2.5));
  assert.ok(near(torsoSpan(column, 1), 4.4 / 2.5));
  // the caps project in plan: a 0.6 m-wide disc spans 0.6 m of texture
  const cap = applyWorldUVs(new THREE.CylinderGeometry(0.3, 0.3, 1, 12), 1);
  assert.ok(near(faceSpan(cap, [0, 1, 0], 0), 0.6));
  assert.ok(near(faceSpan(cap, [0, 1, 0], 1), 0.6));
});

test('a cylinder scaled on the mesh gets the density of its world size', () => {
  const tiled = new THREE.MeshStandardMaterial();
  tiled.userData.metresPerRepeat = 1;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 16), tiled);
  post.scale.set(1, 3, 1);
  applyWorldUVsTo(post);
  assert.ok(near(torsoSpan(post.geometry, 1), 3), '3 m tall after scaling: 3 repeats');
  assert.ok(near(torsoSpan(post.geometry, 0), Math.PI));
});

test('a sphere unrolls to its arc lengths', () => {
  const head = applyWorldUVs(new THREE.SphereGeometry(0.5, 12, 8), 1);
  const uv = head.getAttribute('uv'), pos = head.getAttribute('position');
  let umax = 0, vmax = 0;
  for (let i = 0; i < uv.count; i++) {
    vmax = Math.max(vmax, uv.getY(i));
    // the pole vertices carry a half-segment u offset; measure on the equator
    if (Math.abs(pos.getY(i)) < 1e-6) umax = Math.max(umax, uv.getX(i));
  }
  assert.ok(near(umax, Math.PI), 'equator = 2π·0.5 m');
  assert.ok(near(vmax, Math.PI / 2), 'pole to pole = π·0.5 m');
});

test('a uvRotate material gets U and V swapped, so plank boards run along the panel', () => {
  // the plank scan's boards run along V; box projection puts V up every side
  // face, so a counter front read as vertical slats
  const plain = new THREE.MeshStandardMaterial();
  plain.userData.metresPerRepeat = 1;
  const planks = plain.clone();
  planks.userData.uvRotate = true;
  const a = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 0.5), plain);
  const b = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 0.5), planks);
  applyWorldUVsTo(a);
  applyWorldUVsTo(b);
  assert.ok(near(faceSpan(a.geometry, [0, 0, 1], 0), 3) && near(faceSpan(a.geometry, [0, 0, 1], 1), 1));
  assert.ok(near(faceSpan(b.geometry, [0, 0, 1], 0), 1), 'u now runs up the face');
  assert.ok(near(faceSpan(b.geometry, [0, 0, 1], 1), 3), 'v, the board direction, runs along its 3 m');
  const ua = a.geometry.getAttribute('uv'), ub = b.geometry.getAttribute('uv');
  for (let i = 0; i < ua.count; i++) assert.ok(near(ub.getX(i), ua.getY(i)) && near(ub.getY(i), ua.getX(i)));
});
