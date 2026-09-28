// @ts-check
// src/assets/assets.js — the facade's contract. Everything the game draws from
// the asset pipeline has a procedural twin, and this is the seam between them:
// every load resolves to null (never rejects) on a missing id, a missing file
// or a throwing decoder, warns ONCE per asset, and `enabled: false` (the
// ?noassets=1 switch) never touches a loader at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAssets } from '../../src/assets/assets.js';

const pbrFiles = (id) => ['diff', 'nor', 'orm'].map((role) => ({ path: `assets/pbr/${id}/${id}_${role}.jpg`, role }));
const MANIFEST = {
  entries: [
    { id: 'rock', kind: 'pbr', hasMetal: false, files: pbrFiles('rock') },
    { id: 'steel', kind: 'pbr', hasMetal: true, files: pbrFiles('steel') },
    { id: 'gone', kind: 'pbr', hasMetal: false, files: pbrFiles('gone') },
    { id: 'city_2k', kind: 'hdri', files: [{ path: 'assets/hdri/city_2k.hdr', role: 'hdr' }] },
    { id: 'pack', kind: 'gltf', files: [{ path: 'assets/props/pack/cup.glb', role: 'model', name: 'cup' }] },
    { id: 'grade', kind: 'lut', files: [{ path: 'assets/luts/grade.cube', role: 'cube' }] },
  ],
};

function make({ enabled = true, missing = ['/gone/'], manifest = MANIFEST } = {}) {
  const calls = [];
  const logs = [];
  const miss = (url) => missing.some((m) => url.includes(m));
  const hit = (url) => { calls.push(url); if (miss(url)) throw new Error(`404 ${url}`); };
  /** @type {import('../../src/assets/assets.js').AssetLoaders} */
  const loaders = {
    texture: async (url) => { hit(url); const t = new THREE.Texture(); t.name = url; return t; },
    hdr: async (url) => { hit(url); return new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType); },
    gltf: async (url) => {
      hit(url);
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
      return { scene };
    },
    lut: async (url) => { hit(url); return { texture3D: new THREE.Data3DTexture(new Uint8Array(32), 2, 2, 2) }; },
    pmrem: (eq) => { const t = new THREE.Texture(); t.userData.from = eq; return t; },
  };
  const assets = createAssets({
    loaders, enabled, log: (m) => logs.push(m),
    fetchJson: async () => { if (!manifest) throw new Error('HTTP 404'); return manifest; },
  });
  return { assets, calls, logs };
}

test('a PBR set: sRGB on the albedo only, repeat wrapping, ORM shared by roughness + AO', async () => {
  const { assets } = make();
  await assets.init();
  const set = await assets.loadPBR('rock');
  assert.ok(set);
  assert.equal(set.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(set.normalMap.colorSpace, THREE.NoColorSpace, 'normals are data — an sRGB decode flattens them');
  assert.equal(set.roughnessMap.colorSpace, THREE.NoColorSpace);
  assert.equal(set.roughnessMap, set.aoMap);
  assert.equal(set.map.wrapS, THREE.RepeatWrapping);
  assert.equal(set.metalnessMap, null, 'no metal channel → the material keeps its metalness scalar');
  assert.equal((await assets.loadPBR('steel')).metalnessMap, (await assets.loadPBR('steel')).roughnessMap);
});

test('an id missing from the manifest resolves to null and warns once', async () => {
  const { assets, logs, calls } = make();
  await assets.init();
  assert.equal(await assets.loadPBR('nope'), null);
  assert.equal(await assets.loadPBR('nope'), null);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /nope/);
  assert.equal(calls.length, 0, 'never requests a file the manifest does not list — a 404 is a console error in the browser');
});

test('a file that fails to load resolves to null, warns once, and is not retried', async () => {
  const { assets, logs, calls } = make();
  await assets.init();
  assert.equal(await assets.loadPBR('gone'), null);
  const before = calls.length;
  assert.equal(await assets.loadPBR('gone'), null);
  assert.equal(calls.length, before, 'the failed promise is cached');
  assert.equal(logs.length, 1);
});

test('enabled:false (?noassets=1) never calls a loader and resolves everything to null', async () => {
  const { assets, calls, logs } = make({ enabled: false });
  await assets.init();
  assert.equal(assets.enabled, false);
  assert.equal(await assets.loadPBR('rock'), null);
  assert.equal(await assets.loadEquirect('city_2k'), null);
  assert.equal(await assets.loadGLTF('pack/cup'), null);
  assert.equal(await assets.loadLUT('grade'), null);
  assert.equal(calls.length, 0);
  assert.equal(logs.length, 1, 'one line says the pipeline is off');
});

test('peek* is null until preloaded, then synchronous', async () => {
  const { assets } = make();
  await assets.init();
  assert.equal(assets.peekPBR('rock'), null);
  await assets.preload([{ kind: 'pbr', id: 'rock' }, { kind: 'equirect', id: 'city_2k' }, { kind: 'gltf', id: 'pack/cup' }, { kind: 'lut', id: 'grade' }]);
  assert.ok(assets.peekPBR('rock')?.map);
  assert.ok(assets.peekEquirect('city_2k'));
  assert.ok(assets.peekGLTF('pack/cup'));
  assert.ok(assets.peekLUT('grade')?.texture3D);
});

test('every loadGLTF / peekGLTF returns its own clone', async () => {
  const { assets } = make();
  await assets.init();
  const a = await assets.loadGLTF('pack/cup');
  const b = await assets.loadGLTF('pack/cup');
  const c = assets.peekGLTF('pack/cup');
  assert.ok(a && b && c);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.equal(a.children.length, 1);
  assert.equal(await assets.loadGLTF('pack/saucer'), null, 'a model name the pack does not have');
});

test('a throwing model clone resolves loadGLTF to null (never rejects) and warns once', async () => {
  const logs = [];
  const assets = createAssets({
    loaders: {
      texture: async (url) => new THREE.Texture(),
      hdr: async (url) => new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType),
      gltf: async (url) => {
        const scene = new THREE.Group();
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
        return { scene };
      },
      lut: async (url) => ({ texture3D: new THREE.Data3DTexture(new Uint8Array(32), 2, 2, 2) }),
      clone: () => { throw new Error('boom'); },
    },
    log: (m) => logs.push(m),
    fetchJson: async () => MANIFEST,
  });
  await assets.init();
  await assert.doesNotReject(async () => {
    const r = await assets.loadGLTF('pack/cup');
    assert.equal(r, null);
  });
  assert.equal(await assets.loadGLTF('pack/cup'), null);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /pack\/cup/);
});

test('a throwing model clone makes peekGLTF resolve to null (never throws) and warns once', async () => {
  const logs = [];
  const assets = createAssets({
    loaders: {
      texture: async (url) => new THREE.Texture(),
      hdr: async (url) => new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType),
      gltf: async (url) => {
        const scene = new THREE.Group();
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
        return { scene };
      },
      lut: async (url) => ({ texture3D: new THREE.Data3DTexture(new Uint8Array(32), 2, 2, 2) }),
      clone: () => { throw new Error('boom'); },
    },
    log: (m) => logs.push(m),
    fetchJson: async () => MANIFEST,
  });
  await assets.init();
  await assets.preload([{ kind: 'gltf', id: 'pack/cup' }]);
  assert.equal(logs.length, 1, 'the failed load-time clone already warned once');
  assert.doesNotThrow(() => {
    assert.equal(assets.peekGLTF('pack/cup'), null);
  });
  assert.equal(logs.length, 1, 'peekGLTF reuses the same warn-once key');
});

test('loadEquirect marks the mapping; loadHDRI hands back the PMREM texture', async () => {
  const { assets } = make();
  await assets.init();
  const eq = await assets.loadEquirect('city_2k');
  assert.equal(eq.mapping, THREE.EquirectangularReflectionMapping);
  const pm = await assets.loadHDRI('city_2k');
  assert.equal(pm.userData.from, eq);
});

test('setAnisotropy reaches textures that are already loaded', async () => {
  const { assets } = make();
  await assets.init();
  const set = await assets.loadPBR('rock');
  assets.setAnisotropy(8);
  assert.equal(set.map.anisotropy, 8);
  assert.equal(set.normalMap.anisotropy, 8);
  const later = await assets.loadPBR('steel');
  assert.equal(later.map.anisotropy, 8, 'and to textures loaded after');
  assert.ok(assets.textures().includes(set.map));
});

test('loadTexture fetches one map of an entry by role', async () => {
  const { assets } = make();
  await assets.init();
  const t = await assets.loadTexture('rock', 'diff');
  assert.match(t.name, /rock_diff\.jpg$/);
  assert.equal(t.colorSpace, THREE.SRGBColorSpace);
  assert.equal(await assets.loadTexture('rock', 'height'), null);
});

test('a manifest that fails to load degrades every asset to null', async () => {
  const { assets, logs, calls } = make({ manifest: null });
  await assets.init();
  assert.equal(await assets.loadPBR('rock'), null);
  assert.equal(calls.length, 0);
  assert.ok(logs.some((l) => /manifest/.test(l)));
});

test('a manifest request that never answers times out: init settles, every asset degrades to null', async () => {
  const logs = [];
  const assets = createAssets({
    loaders: null, log: (m) => logs.push(m), manifestTimeoutMs: 20,
    fetchJson: () => new Promise(() => {}),
  });
  await assets.init();   // would hang forever without the timeout
  assert.equal(await assets.loadPBR('rock'), null);
  assert.ok(logs.some((l) => /manifest unavailable.*timed out/.test(l)), logs.join('\n'));
});

test('the default fetchJson aborts a hung fetch after the timeout and never rejects', async () => {
  const realFetch = globalThis.fetch;
  /** @type {AbortSignal|undefined} */
  let seen;
  globalThis.fetch = /** @type {any} */ ((_url, init) => { seen = init?.signal; return new Promise(() => {}); });
  try {
    const logs = [];
    const assets = createAssets({ loaders: null, log: (m) => logs.push(m), manifestTimeoutMs: 20 });
    await assets.init();
    assert.ok(seen, 'the manifest fetch carries an AbortSignal');
    assert.ok(logs.some((l) => /manifest unavailable/.test(l)));
    assert.equal(await assets.loadLUT('grade'), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});
