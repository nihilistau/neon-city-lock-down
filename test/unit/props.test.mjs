// @ts-check
// Kenney clutter: opt-in data, fitted to a real height, re-skinned with the
// room's own PBR materials, and simply ABSENT when the model did not load —
// never replaced by a placeholder, so ?noassets=1 shows the v0.6 room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './helpers/dom.mjs';

installFakeDom();
const THREE = await import('three');
const { fitProp } = await import('../../src/scene3d/tower/props.js');
const { PROP_DRESSING } = await import('../../data/propDressing.js');
const { World3D } = await import('../../src/scene3d/tower/zoneBuilder.js');
const { assetsForFloor } = await import('../../src/scene3d/tower/floorAssets.js');
const { PBR_LIBRARY, pbrMaterial } = await import('../../src/scene3d/materials/pbr.js');
const { checkPropRefs } = await import('../../tools/lib/manifest.mjs');

const rng = { next: () => 0.5, chance: () => false, int: (a) => a, pick: (a) => a[0], range: (a) => a };
/** a stand-in Kenney model: 2 x 4 x 1 units, offset, under a scaled parent */
function model() {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(0.5);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
  mesh.position.set(5, 3, 0);
  inner.add(mesh);
  root.add(inner);
  return root;
}

test('fitProp: fitted height, base on y=0, centred, re-skinned, source untouched', () => {
  const src = model();
  const before = src.children[0].children[0].geometry.getAttribute('position').array.slice();
  const skin = pbrMaterial('metal');
  const prop = fitProp(src, 0.5, skin);
  const box = new THREE.Box3().setFromObject(prop);
  assert.ok(Math.abs(box.max.y - box.min.y - 0.5) < 1e-6, 'fitted to 0.5 m');
  assert.ok(Math.abs(box.min.y) < 1e-6, 'stands on its origin');
  assert.ok(Math.abs((box.min.x + box.max.x) / 2) < 1e-6 && Math.abs((box.min.z + box.max.z) / 2) < 1e-6, 'centred');
  prop.traverse((o) => {
    if (!o.isMesh) return;
    assert.equal(o.material, skin);
    assert.ok(o.geometry.getAttribute('uv'), 'world UVs for the tiled skin');
    assert.equal(o.castShadow, true);
  });
  assert.deepEqual(src.children[0].children[0].geometry.getAttribute('position').array, before, 'the cached model is never mutated');
});

test('dressing appears only where its model loaded, and a solid prop becomes a collider', () => {
  const loaded = new Set(['kenney_furniture/books', 'kenney_industrial/tank']);
  const facade = { peekPBR: () => null, peekEquirect: () => null, peekGLTF: (ref) => (loaded.has(ref) ? model() : null) };
  const stage = { scene: new THREE.Scene() };
  const plain = new World3D(/** @type {any} */ ({ scene: new THREE.Scene() }), /** @type {any} */ (rng));
  const world = new World3D(/** @type {any} */ (stage), /** @type {any} */ (rng), /** @type {any} */ (facade));
  const dressed = (floor) => { const out = []; world.floorGroups[floor].traverse((o) => { if (o.userData.dressing) out.push(o.userData.dressing); }); return out; };
  assert.deepEqual(dressed('penthouse'), PROP_DRESSING.filter((p) => p.floor === 'penthouse' && loaded.has(p.asset)).map((p) => p.asset));
  assert.deepEqual(dressed('fl40'), [], 'the laptop did not load, so there is no laptop — and no placeholder');
  const solidTanks = PROP_DRESSING.filter((p) => p.floor === 'rooftop' && p.solid && loaded.has(p.asset)).length;
  assert.equal(world.collidersByFloor.rooftop.length, plain.collidersByFloor.rooftop.length + solidTanks);
});

test('assetsForFloor asks for each floor’s own dressing', () => {
  const refs = (f) => assetsForFloor(f).filter((x) => x.kind === 'gltf').map((x) => x.id);
  assert.deepEqual(refs('penthouse'), PROP_DRESSING.filter((p) => p.floor === 'penthouse').map((p) => p.asset));
  assert.deepEqual(refs('fl27'), []);
});

test('every dressing entry names a real model and a real skin', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../assets/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(checkPropRefs(manifest, PROP_DRESSING, Object.keys(PBR_LIBRARY)), []);
  const bad = checkPropRefs(manifest, [{ asset: 'kenney_furniture/sofa_xl', floor: 'penthouse', skin: 'velvet' }], Object.keys(PBR_LIBRARY));
  assert.equal(bad.length, 2);
});
