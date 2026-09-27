// @ts-check
// vendor/three/addons — the contract tools/vendor-three.mjs writes down in
// VENDORED.json. The addons are third-party code copied into the repo by a
// tool, so the test checks the copy, not the tool: every file is the one that
// was recorded, nothing was dropped in by hand, every relative import resolves
// to a file that is actually vendored, and Node can import them the same way
// the browser's import map does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relativeImports, resolveRelative, isEsModuleSource } from '../../tools/lib/importScan.mjs';

const ROOT = new URL('../../', import.meta.url);
const ADDONS = new URL('vendor/three/addons/', ROOT);
const record = JSON.parse(readFileSync(new URL('VENDORED.json', ADDONS), 'utf8'));
const read = (rel) => readFileSync(new URL(rel, ADDONS));

/** @param {URL} dir @param {string} [prefix] @returns {string[]} */
function walk(dir, prefix = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...walk(new URL(`${e.name}/`, dir), `${prefix}${e.name}/`));
    else out.push(`${prefix}${e.name}`);
  }
  return out;
}
const onDisk = walk(ADDONS).filter((f) => f !== 'VENDORED.json').sort();
const isModule = (f) => f.endsWith('.js') && !f.startsWith('libs/draco/') && isEsModuleSource(read(f).toString('utf8'));

test('VENDORED.json pins the same three as the vendored core', () => {
  const core = readFileSync(new URL('vendor/three.core.js', ROOT), 'utf8');
  const rev = /const REVISION = '(\d+)'/.exec(core)?.[1];
  assert.equal(record.three, `0.${rev}.0`);
});

test('every recorded file is on disk with its recorded size and sha256', () => {
  for (const f of record.files) {
    const buf = read(f.file);
    assert.equal(buf.length, f.bytes, `${f.file}: size drifted`);
    assert.equal(createHash('sha256').update(buf).digest('hex'), f.sha256, `${f.file}: contents drifted — re-run tools/vendor-three.mjs`);
  }
});

test('every vendored file is recorded — nothing was dropped in by hand', () => {
  assert.deepEqual(onDisk, record.files.map((f) => f.file).sort());
});

test('the addons the asset pipeline and post stack need are all present', () => {
  for (const f of [
    'loaders/GLTFLoader.js', 'loaders/DRACOLoader.js', 'loaders/HDRLoader.js', 'loaders/LUTCubeLoader.js',
    'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js', 'libs/meshopt_decoder.module.js',
    'libs/draco/gltf/draco_decoder.js', 'libs/draco/gltf/draco_decoder.wasm', 'libs/draco/gltf/draco_wasm_wrapper.js',
    'postprocessing/SMAAPass.js', 'shaders/SMAAShader.js', 'postprocessing/LUTPass.js',
    'geometries/RoundedBoxGeometry.js',
  ]) assert.ok(onDisk.includes(f), `${f} is not vendored`);
});

test('every relative import of every vendored ES module resolves to a vendored file', () => {
  const missing = [];
  for (const f of onDisk.filter(isModule)) {
    for (const spec of relativeImports(read(f).toString('utf8'))) {
      const dep = resolveRelative(f, spec);
      if (!onDisk.includes(dep)) missing.push(`${f} → ${spec}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('Node resolves three/addons/* through the generated shims', async () => {
  const { RoundedBoxGeometry } = await import('three/addons/geometries/RoundedBoxGeometry.js');
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  assert.equal(typeof RoundedBoxGeometry, 'function');
  assert.equal(typeof mergeGeometries, 'function');
  for (const f of onDisk.filter(isModule)) {
    assert.ok(existsSync(new URL(`node_modules/three/addons/${f}`, ROOT)), `no Node shim for ${f}`);
  }
});
