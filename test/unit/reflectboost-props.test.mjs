// @ts-check
// Interactive props clone their materials (zoneBuilder, so the hover glow can't
// touch shared ones). The vanity mirror and shower glass are interactive, so
// their reflection boost has to survive that clone in a real built world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './helpers/dom.mjs';

installFakeDom();
const THREE = await import('three');
const { World3D } = await import('../../src/scene3d/tower/zoneBuilder.js');

const rng = { next: () => 0.5, chance: () => false, int: (a) => a, pick: (a) => a[0], range: (a) => a };

test('the cloned vanity mirror and shower glass keep their reflection boost', () => {
  const world = new World3D(/** @type {any} */ ({ scene: new THREE.Scene() }), /** @type {any} */ (rng));
  const prop = (id) => world.props.find((p) => p.id === id)?.mesh;
  const mirror = /** @type {any} */ (prop('vanity_table')?.getObjectByName('vanity_mirror'));
  assert.ok(mirror, 'vanity mirror built');
  let glass = null;
  prop('shower_pod')?.traverse((o) => { if (/** @type {any} */ (o).material?.transparent) glass = o; });
  assert.ok(glass, 'shower glass built');
  for (const mesh of [mirror, /** @type {any} */ (glass)]) {
    assert.equal(mesh.material.userData.reflectBoost, 2.5);
    assert.equal(mesh.material.customProgramCacheKey(), 'reflect-boost', `${mesh.name || 'glass'} still patched after the prop clone`);
  }
});
