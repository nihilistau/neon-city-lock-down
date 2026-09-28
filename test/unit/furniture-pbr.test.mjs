// @ts-check
// The tower on the PBR library. Hero furniture is bevelled — a hard 90° box
// edge catches no highlight, which is most of why the old furniture read as
// untextured boxes — but colliders and sockets must not move by a millimetre:
// the FP collision, the actor queue and the bed scene all address them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './helpers/dom.mjs';

installFakeDom();
const THREE = await import('three');
const { RoundedBoxGeometry } = await import('three/addons/geometries/RoundedBoxGeometry.js');
const { FURNITURE } = await import('../../src/scene3d/tower/furniture.js');
const { World3D } = await import('../../src/scene3d/tower/zoneBuilder.js');
const { assetsForFloor } = await import('../../src/scene3d/tower/floorAssets.js');
const { PBR_SET_IDS } = await import('../../src/scene3d/materials/pbr.js');
const { FLOORS } = await import('../../data/zones.js');

const rounded = (group) => { let n = 0; group.traverse((o) => { if (o.isMesh && o.geometry instanceof RoundedBoxGeometry) n++; }); return n; };
const rng = { next: () => 0.5, chance: () => false, int: (a) => a, pick: (a) => a[0], range: (a) => a };

test('hero pieces are bevelled', () => {
  assert.ok(rounded(FURNITURE.couch().group) >= 7, 'seat, back, arms and cushions');
  assert.ok(rounded(FURNITURE.bed().group) >= 4, 'platform, mattress, pillows, headboard');
  assert.ok(rounded(FURNITURE.coffee_table().group) >= 1);
  assert.ok(rounded(FURNITURE.bar_counter().group) >= 2);
  assert.ok(rounded(FURNITURE.sink_counter().group) >= 2);
  assert.equal(rounded(FURNITURE.weapon_rack().group), 0, 'clutter stays crisp');
});

test('bevelling moved no collider and no socket', () => {
  assert.deepEqual(FURNITURE.couch().colliders, [{ min: [-1.15, 0, -0.5], max: [1.15, 0.9, 0.5] }]);
  assert.deepEqual(FURNITURE.bed().colliders, [{ min: [-1.0, 0, -1.2], max: [1.0, 0.6, 1.15] }]);
  assert.deepEqual(FURNITURE.coffee_table().colliders, [{ min: [-0.6, 0, -0.31], max: [0.6, 0.42, 0.31] }]);
  const s = FURNITURE.bed().sockets;
  assert.deepEqual(Object.keys(s).sort(), ['lie_center', 'lie_left', 'lie_right', 'seat0', 'seat1']);
  assert.deepEqual(s.seat1.position.toArray(), [-0.7, 0.5, 0.85]);
});

test('furniture surfaces come from the library', () => {
  const couch = FURNITURE.couch().group;
  const names = new Set();
  couch.traverse((o) => { if (o.isMesh) names.add(o.material.userData.pbr); });
  assert.ok(names.has('fabric'));
  assert.ok(names.has('metalDark'));
});

test('assetsForFloor asks for every PBR set the library uses', () => {
  const list = assetsForFloor('penthouse');
  assert.deepEqual(list.filter((x) => x.kind === 'pbr').map((x) => x.id).sort(), [...PBR_SET_IDS].sort());
});

test('the built tower has world-scale UVs on its walls and slabs', () => {
  const stage = { scene: new THREE.Scene() };
  const world = new World3D(/** @type {any} */ (stage), /** @type {any} */ (rng));
  let tagged = 0;
  world.floorGroups.penthouse.traverse((o) => { if (o.isMesh && o.geometry.userData.worldUV) tagged++; });
  assert.ok(tagged > 20, `only ${tagged} penthouse geometries got world UVs`);
});

test('World3D.create preloads each floor before building it', async () => {
  const stage = { scene: new THREE.Scene() };
  const built = () => stage.scene.children.filter((c) => c.name.startsWith('floor_')).length;
  const seen = [];
  const facade = {
    preload: async () => { seen.push(built()); },
    peekPBR: () => null, peekGLTF: () => null, peekEquirect: () => null,
  };
  const world = await World3D.create(/** @type {any} */ (stage), /** @type {any} */ (rng), /** @type {any} */ (facade));
  assert.equal(seen.length, Object.keys(FLOORS).length);
  assert.deepEqual(seen, seen.map((_, i) => i), 'preload N runs before floor N is built');
  assert.equal(world.activeFloor, 'penthouse');
  assert.ok(world.furnitureGroups.penthouse.length > 5);
});

test('the sky floors also preload the HDRI equirect', () => {
  const eq = (f) => assetsForFloor(f, { equirect: 'shanghai_bund_2k' }).filter((x) => x.kind === 'equirect').map((x) => x.id);
  assert.deepEqual(eq('penthouse'), ['shanghai_bund_2k']);
  assert.deepEqual(eq('rooftop'), ['shanghai_bund_2k']);
  assert.deepEqual(eq('fl27'), [], 'an interior floor has no sky to show');
  assert.deepEqual(assetsForFloor('penthouse').filter((x) => x.kind === 'equirect'), [], 'hdri off → none');
});
