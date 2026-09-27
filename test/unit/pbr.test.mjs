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
const { PBR_LIBRARY, PBR_SET_IDS, pbrMaterial, setPbrAssets, _resetPbrLibrary, pbrColor } =
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

test('a loaded set wins, per material: its maps, ORM as roughness + AO, the tint divided by the scan albedo', () => {
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
  const spec = PBR_LIBRARY.metal;
  assert.ok(Math.abs(m.metalness - Math.min(1, spec.metalness / spec.scanMetalness)) < 1e-9, 'metal channel x authored/measured');
  assert.ok(Math.abs(m.roughness - spec.roughness / spec.scanRoughness) < 1e-9, 'ORM G x authored/measured');
  assert.ok(m.color.equals(pbrColor(spec.tint, spec.albedo)));
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

test('pbrColor makes a scan AVERAGE its tint: tint / albedo per channel, unclamped, capped at a 0.9 mean', () => {
  const albedo = /** @type {[number, number, number]} */ ([0.09, 0.05, 0.02]);
  const c = pbrColor('#181c2a', albedo);
  const t = new THREE.Color('#181c2a');
  for (const [i, k] of /** @type {const} */ ([[0, 'r'], [1, 'g'], [2, 'b']])) {
    assert.ok(Math.abs(c[k] * albedo[i] - t[k]) < 1e-9, `${k}: mean = tint`);
  }
  assert.ok(c.b > 1, 'a dark scan needs more than 1 and gets it');
  const w = pbrColor('#ffffff', [0.5, 0.5, 0.5]);
  assert.ok(Math.abs(w.r * 0.5 - 0.9) < 1e-9, 'no channel mean past 0.9');
});

test('every loaded set carries its measured albedo and scan roughness', () => {
  for (const [name, spec] of Object.entries(PBR_LIBRARY)) {
    if (!spec.set) continue;
    assert.ok(Array.isArray(spec.albedo) && spec.albedo.length === 3 && spec.albedo.every((x) => x > 0 && x < 1), `${name}.albedo`);
    assert.ok(spec.scanRoughness > 0 && spec.scanRoughness <= 1, `${name}.scanRoughness`);
  }
});

test('an authored roughness override reaches a loaded material', () => {
  _resetPbrLibrary();
  setPbrAssets(facade(['floor_tiles_08']));
  const glossy = pbrMaterial('tile', { roughness: 0.2 });
  const plain = pbrMaterial('tile');
  assert.equal(glossy.userData.source, 'pbr');
  assert.ok(glossy.roughness < plain.roughness, 'the override is not swallowed by a fixed 1');
  assert.ok(Math.abs(glossy.roughness - 0.2 / PBR_LIBRARY.tile.scanRoughness) < 1e-9);
  assert.equal(glossy.normalScale.x, PBR_LIBRARY.tile.scanNormalScale, 'the scan uses its own normal strength');
});

test('marble is procedural by choice: the veins, not the travertine scan', () => {
  _resetPbrLibrary();
  setPbrAssets(facade(PBR_SET_IDS));
  assert.equal(PBR_LIBRARY.marble.set, null);
  assert.equal(pbrMaterial('marble').userData.source, 'procedural');
});

test('wood asks the world-UV pass to run its boards horizontally', () => {
  _resetPbrLibrary();
  assert.equal(pbrMaterial('wood').userData.uvRotate, true);
  assert.equal(pbrMaterial('concrete').userData.uvRotate, undefined);
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
