// @ts-check
// src/scene3d/materials/pbr.js — the named surface library. Hybrid by design:
// a material is built from a Poly Haven set when the facade has one decoded,
// and from the canvas generators when it does not, so a missing asset costs
// looks, never a blank box. The library is the ONE place a set id is named,
// so it is also checked against the manifest here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './helpers/dom.mjs';

installFakeDom();
const THREE = await import('three');
const { PBR_LIBRARY, PBR_SET_IDS, pbrMaterial, setPbrAssets, _resetPbrLibrary, pbrTint } =
  await import('../../src/scene3d/materials/pbr.js');

const NAMES = ['concrete', 'concreteFloor', 'metal', 'metalDark', 'tile', 'marble', 'wood', 'fabric', 'bedding', 'rust'];
const t = () => new THREE.Texture();
/** a fake facade holding the given sets */
function facade(ids, { metal = [] } = {}) {
  const sets = {};
  for (const id of ids) {
    const orm = t();
    sets[id] = { map: t(), normalMap: t(), roughnessMap: orm, aoMap: orm, metalnessMap: metal.includes(id) ? orm : null };
  }
  return { peekPBR: (id) => sets[id] ?? null, sets };
}

test('the library has the spec’s ten names, each with a positive metres-per-repeat', () => {
  assert.deepEqual(Object.keys(PBR_LIBRARY).sort(), [...NAMES].sort());
  for (const n of NAMES) assert.ok(PBR_LIBRARY[n].metresPerRepeat > 0, n);
});

test('with no assets every material is procedural and tiles at repeat 1 (world UVs carry the density)', () => {
  _resetPbrLibrary();
  for (const n of NAMES) {
    const m = pbrMaterial(n);
    assert.equal(m.userData.source, 'procedural', n);
    assert.equal(m.userData.pbr, n);
    assert.equal(m.userData.metresPerRepeat, PBR_LIBRARY[n].metresPerRepeat);
    assert.ok(m.map?.isCanvasTexture, `${n} has a canvas albedo`);
    assert.equal(m.map.repeat.x, 1, `${n}: a repeating texture on top of world UVs would double the density`);
  }
});

test('identical requests share one material; a different tint or roughness does not', () => {
  _resetPbrLibrary();
  assert.equal(pbrMaterial('concrete'), pbrMaterial('concrete'));
  assert.notEqual(pbrMaterial('concrete'), pbrMaterial('concrete', { tint: '#1c1218' }));
  assert.notEqual(pbrMaterial('metal'), pbrMaterial('metal', { roughness: 0.35 }));
});

test('a loaded set wins, per material: its maps, ORM as roughness + AO, the tint lifted by gain', () => {
  _resetPbrLibrary();
  const f = facade(['metal_plate_02'], { metal: ['metal_plate_02'] });
  setPbrAssets(f);
  const m = pbrMaterial('metal');
  const set = f.sets.metal_plate_02;
  assert.equal(m.userData.source, 'pbr');
  assert.equal(m.map, set.map);
  assert.equal(m.normalMap, set.normalMap);
  assert.equal(m.roughnessMap, set.roughnessMap);
  assert.equal(m.aoMap, set.roughnessMap);
  assert.equal(m.metalnessMap, set.roughnessMap);
  assert.equal(m.metalness, 1, 'the metal channel carries metalness');
  assert.equal(m.roughness, 1, 'the ORM G channel carries roughness');
  assert.ok(m.color.equals(pbrTint(PBR_LIBRARY.metal.tint, PBR_LIBRARY.metal.gain)));
  assert.equal(pbrMaterial('wood').userData.source, 'procedural', 'a set the facade does not hold falls back on its own');
});

test('no metal channel: metalnessMap stays null and the scalar applies', () => {
  _resetPbrLibrary();
  setPbrAssets(facade(['plank_flooring_04']));
  const m = pbrMaterial('wood', { metalness: 0.2 });
  assert.equal(m.metalnessMap, null);
  assert.equal(m.metalness, 0.2);
});

test('bedding is procedural-only, even when every set is loaded', () => {
  _resetPbrLibrary();
  setPbrAssets(facade(PBR_SET_IDS));
  assert.equal(PBR_LIBRARY.bedding.set, null);
  assert.equal(pbrMaterial('bedding').userData.source, 'procedural');
});

test('pointing the library at a new facade drops materials built against the old one', () => {
  _resetPbrLibrary();
  const procedural = pbrMaterial('tile');
  setPbrAssets(facade(['floor_tiles_08']));
  assert.notEqual(pbrMaterial('tile'), procedural);
  assert.equal(pbrMaterial('tile').userData.source, 'pbr');
});

test('pbrTint lifts by gain in linear space and clamps at 1', () => {
  const c = pbrTint('#ffffff', 3);
  assert.deepEqual([c.r, c.g, c.b], [1, 1, 1]);
  const d = pbrTint('#101010', 2);
  assert.ok(d.r > new THREE.Color('#101010').r);
});

test('every set the library names is a pbr entry in assets/manifest.json', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../assets/manifest.json', import.meta.url), 'utf8'));
  for (const id of PBR_SET_IDS) {
    const e = manifest.entries.find((x) => x.id === id);
    assert.ok(e && e.kind === 'pbr', `${id} is not a pbr entry in the manifest`);
  }
});

test('an unknown name throws with the list of real ones', () => {
  assert.throws(() => pbrMaterial('velvet'), /unknown PBR material "velvet".*concrete/);
});

test('a spec’s balance tempers a scan’s own colour cast on a loaded set only', () => {
  // plank_flooring_04 averages 6:2:1 red:green:blue; times the wood tint's own
  // warmth the bar read as red lacquer. balance pulls the cast back per channel.
  _resetPbrLibrary();
  const spec = PBR_LIBRARY.wood;
  assert.ok(Array.isArray(spec.balance) && spec.balance.length === 3, 'wood carries a balance');
  setPbrAssets(facade(['plank_flooring_04']));
  const m = pbrMaterial('wood');
  const want = pbrTint(spec.tint, spec.gain);
  want.setRGB(Math.min(1, want.r * spec.balance[0]), Math.min(1, want.g * spec.balance[1]), Math.min(1, want.b * spec.balance[2]));
  assert.ok(m.color.equals(want));
  _resetPbrLibrary();
  assert.equal(pbrMaterial('wood').userData.source, 'procedural', 'the canvas fallback is the tint itself — no balance');
});
