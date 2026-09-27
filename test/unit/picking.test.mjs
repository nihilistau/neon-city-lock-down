// @ts-check
// src/scene3d/picking.js — hover glow must never touch a SHARED material.
// Since the PBR library (src/scene3d/materials/pbr.js) every wall, shaft and
// piece of furniture draws one cached instance per surface, so glowing that
// instance in place lit up every other mesh on the floor that used it: hover
// the elevator and the whole penthouse's concrete turned cyan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { setPickGlow } from '../../src/scene3d/picking.js';

const shared = () => new THREE.MeshStandardMaterial({ color: 0x334455, emissive: 0x000000, emissiveIntensity: 1 });

test('glowing one mesh leaves a mesh that shares its material untouched', () => {
  const mat = shared();
  const a = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  const b = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  const target = new THREE.Group().add(a);
  setPickGlow(target, 0.5);
  assert.equal(b.material, mat, 'the bystander keeps the shared instance');
  assert.equal(mat.emissive.getHex(), 0x000000, 'the shared instance was not mutated');
  assert.equal(mat.emissiveIntensity, 1);
  assert.notEqual(a.material, mat, 'the hovered mesh glows on its own copy');
  assert.equal(/** @type {THREE.MeshStandardMaterial} */ (a.material).emissive.getHex(), 0x39e6ff);
  assert.equal(/** @type {THREE.MeshStandardMaterial} */ (a.material).emissiveIntensity, 0.5);
});

test('unhover hands the shared material back, and re-hover reuses one copy', () => {
  const mat = shared();
  const a = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  setPickGlow(a, 0.5);
  const glowCopy = a.material;
  setPickGlow(a, 0);
  assert.equal(a.material, mat, 'back on the shared instance, so it batches again');
  setPickGlow(a, 0.5);
  assert.equal(a.material, glowCopy, 'cloned once per mesh, not once per hover');
  assert.equal(mat.emissive.getHex(), 0x000000);
});

test('the glow copy follows changes made to the shared material between hovers', () => {
  const mat = shared();
  const a = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  setPickGlow(a, 0.5);
  setPickGlow(a, 0);
  mat.color.setHex(0xff0000);
  setPickGlow(a, 0.5);
  assert.equal(/** @type {THREE.MeshStandardMaterial} */ (a.material).color.getHex(), 0xff0000);
});

test('a material swapped in while hovered is not reverted on unhover', () => {
  const mat = shared();
  const a = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  setPickGlow(a, 0.5);
  const other = shared();
  a.material = other;    // e.g. a wardrobe change on a hovered hostile
  setPickGlow(a, 0);
  assert.equal(a.material, other);
});

test('releasing a target hands its shared materials back and disposes the glow copies', async () => {
  const { releasePickGlow, Picker } = await import('../../src/scene3d/picking.js');
  const mat = shared();
  const a = new THREE.Mesh(new THREE.BoxGeometry(), mat);
  const root = new THREE.Group().add(a);
  setPickGlow(root, 0.5);
  const copy = a.material;
  let disposed = 0;
  copy.addEventListener('dispose', () => disposed++);
  releasePickGlow(root);
  assert.equal(a.material, mat);
  assert.equal(disposed, 1, 'the per-mesh copy is freed with the target');
  assert.equal(a.userData.pickGlowMat, undefined);

  // a hostile removed while hovered: the picker lets go of it too
  const p = /** @type {any} */ (Object.create(Picker.prototype));
  const target = { mesh: root, id: 'h1', prompt: '' };
  p.hovered = target;
  setPickGlow(root, 0.5);
  p.release(root);
  assert.equal(p.hovered, null);
  assert.equal(a.material, mat);
});
