// @ts-check
// assets/manifest.json — the record of every third-party file the game ships.
// The repo promises "clone && serve": no LFS, no setup step. That only holds
// while the assets stay small and legal, so the budget and the licence are
// checked here as well as in `npm run lint`, against the real files on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  validateManifest, totalBytes, verifyFiles, strayFiles, ASSET_BUDGET_BYTES,
} from '../../tools/lib/manifest.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const real = JSON.parse(readFileSync(join(ROOT, 'assets', 'manifest.json'), 'utf8'));
const SHA = 'a'.repeat(64);
const f = (path, role, bytes = 10, extra = {}) => ({ path, role, bytes, sha256: SHA, ...extra });
const pbr = (over = {}) => ({
  id: 'rock', kind: 'pbr', source: 'Poly Haven — rock', license: 'CC0',
  urls: { diff: 'https://dl.polyhaven.org/x.jpg' }, transform: {},
  files: [f('assets/pbr/rock/rock_diff.jpg', 'diff'), f('assets/pbr/rock/rock_nor.jpg', 'nor'), f('assets/pbr/rock/rock_orm.jpg', 'orm')],
  ...over,
});

test('the shipped manifest is valid, inside the budget, and matches the files on disk', async () => {
  assert.deepEqual(validateManifest(real), []);
  assert.deepEqual(await verifyFiles(real, ROOT), []);
  assert.deepEqual(await strayFiles(real, ROOT), [], 'a file under assets/{hdri,pbr,props,luts} that the manifest does not list');
});

test('the budget is 40 MiB and the shipped set fits it', () => {
  assert.equal(ASSET_BUDGET_BYTES, 40 * 1024 * 1024);
  const total = totalBytes(real);
  assert.ok(total <= ASSET_BUDGET_BYTES, `${(total / 1048576).toFixed(2)} MB is over the 40 MB asset budget`);
});

test('a well-formed entry passes', () => {
  assert.deepEqual(validateManifest({ entries: [pbr()] }), []);
});

test('rejects what would break the licence, the layout, or the fingerprint', () => {
  const cases = [
    [pbr({ license: 'CC-BY' }), /license must be one of CC0/],
    [pbr({ kind: 'fbx' }), /kind must be one of/],
    [pbr({ id: 'Rock Set' }), /id must match/],
    [pbr({ urls: { diff: 'http://insecure/x.jpg' } }), /must be an https URL/],
    [pbr({ files: [] }), /no files — run node tools\/fetch-assets\.mjs rock/],
    [pbr({ files: [f('assets/pbr/rock/rock_diff.jpg', 'diff'), f('assets/pbr/rock/rock_nor.jpg', 'nor')] }), /missing the orm map/],
    [pbr({ files: [f('assets/elsewhere/rock_diff.jpg', 'diff'), f('assets/pbr/rock/n.jpg', 'nor'), f('assets/pbr/rock/o.jpg', 'orm')] }), /must live under assets\/pbr\/rock\//],
    [pbr({ files: [{ path: 'assets/pbr/rock/a.jpg', role: 'diff', bytes: 1 }, f('assets/pbr/rock/n.jpg', 'nor'), f('assets/pbr/rock/o.jpg', 'orm')] }), /has no sha256/],
    [pbr({ files: [f('assets/pbr/rock/../x.jpg', 'diff'), f('assets/pbr/rock/n.jpg', 'nor'), f('assets/pbr/rock/o.jpg', 'orm')] }), /clean posix path/],
    [{ id: 'm', kind: 'gltf', source: 'Kenney', license: 'CC0', urls: {}, transform: {}, files: [f('assets/props/m/cup.glb', 'model')] }, /model file needs a name/],
  ];
  for (const [entry, re] of cases) {
    const errs = validateManifest({ entries: [entry] });
    assert.ok(errs.some((e) => re.test(e)), `expected ${re} in:\n${errs.join('\n')}`);
  }
});

test('duplicate ids and duplicate paths are caught', () => {
  const errs = validateManifest({ entries: [pbr(), pbr()] });
  assert.ok(errs.some((e) => /duplicate id/.test(e)));
  assert.ok(errs.some((e) => /listed twice/.test(e)));
});

test('over budget is an error, and a shared path is only counted once', () => {
  const big = pbr({ files: [f('assets/pbr/rock/rock_diff.jpg', 'diff', ASSET_BUDGET_BYTES), f('assets/pbr/rock/rock_nor.jpg', 'nor', 1), f('assets/pbr/rock/rock_orm.jpg', 'orm', 1)] });
  assert.ok(validateManifest({ entries: [big] }).some((e) => /exceeds the 40\.00 MB asset budget/.test(e)));
  assert.equal(totalBytes({ entries: [{ files: [f('a', 'x', 5), f('a', 'x', 5), f('b', 'x', 7)] }] }), 12);
});
