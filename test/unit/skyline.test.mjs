// @ts-check
// The exterior: the HDRI dome replaces the flat skyline billboard when the
// HDRI loaded, the billboard remains the fallback, the preset grades the dome,
// and every tower reads the window texture at its own offset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './helpers/dom.mjs';

installFakeDom();
const THREE = await import('three');
const { World3D } = await import('../../src/scene3d/tower/zoneBuilder.js');

const rng = { next: () => 0.5, chance: () => false, int: (a) => a, pick: (a) => a[0], range: (a) => a };
const equirect = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
const facade = { peekPBR: () => null, peekGLTF: () => null, peekEquirect: (id) => (id === 'sky_2k' ? equirect : null) };
const build = (eq) => new World3D(/** @type {any} */ ({ scene: new THREE.Scene() }), /** @type {any} */ (rng), /** @type {any} */ (facade), { equirect: eq });

test('with the HDRI: one dome per exterior, textured with it', () => {
  const world = build('sky_2k');
  assert.equal(world.exteriors.length, 2, 'penthouse + rooftop');
  for (const ext of world.exteriors) {
    assert.ok(ext.dome?.visible);
    assert.equal(ext.dome.material.map, equirect);
    assert.equal(ext.dome.material.fog, false);
  }
});

test('without it: no dome — the skyline plate is the fallback', () => {
  for (const ext of build(null).exteriors) assert.equal(ext.dome, null);
});

test('setSkyTexture toggles live; setSkyGrade tints every dome', () => {
  const world = build('sky_2k');
  world.setSkyTexture(null);
  for (const ext of world.exteriors) assert.equal(ext.dome.visible, false);
  world.setSkyTexture(equirect);
  for (const ext of world.exteriors) assert.equal(ext.dome.visible, true);
  world.setSkyGrade(new THREE.Color(0.2, 0.1, 0.1));
  for (const ext of world.exteriors) assert.ok(ext.dome.material.color.equals(new THREE.Color(0.2, 0.1, 0.1)));
  const later = build(null);
  later.setSkyGrade(new THREE.Color(0.5, 0.5, 0.5));
  later.setSkyTexture(equirect);
  assert.ok(later.exteriors[0].dome.material.color.equals(new THREE.Color(0.5, 0.5, 0.5)), 'a dome created later picks up the current grade');
});

test('the towers are one instanced, emissive, per-instance-offset mesh per exterior', () => {
  const world = build(null);
  for (const ext of world.exteriors) {
    const towers = ext.group.children.find((o) => o.isInstancedMesh);
    assert.ok(towers, 'instanced towers');
    assert.equal(towers.geometry.getAttribute('aWinOffset').count, towers.count);
    assert.ok(towers.material.isMeshStandardMaterial);
    assert.ok(towers.material.emissiveMap);
    assert.equal(towers.material.customProgramCacheKey(), 'city-window-offsets');
  }
});
