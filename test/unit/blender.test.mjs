// @ts-check
// tools/blender/ — the headless Blender runner. findBlender() is pure and runs
// everywhere; the round-trips (inspect, convert with a LOD, preview) need a real
// Blender and SKIP with a message where there is none (CI), so the suite stays
// green there and proves the scripts on a machine that has it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBlender, runBlender } from '../../tools/blender/run.mjs';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..', '..'));
const SAMPLE = join(ROOT, 'assets', 'props', 'kenney_furniture', 'box_closed.glb');
const BLENDER = findBlender();
const skip = BLENDER ? false : 'Blender not found (set BLENDER_EXE) — skipping the Blender round-trips';
const SLOW = { timeoutMs: 120_000 };

test('findBlender() returns an existing path or null', () => {
  assert.ok(BLENDER === null || (typeof BLENDER === 'string' && existsSync(BLENDER)), String(BLENDER));
});

test('findBlender(): BLENDER_EXE wins when it exists, is skipped when it does not', () => {
  const exists = (/** @type {string} */ p) => p === '/opt/b/blender' || p === '/usr/bin/blender';
  const base = { platform: 'linux', exists, pathDirs: ['/usr/bin'], globRoots: [] };
  assert.equal(findBlender({ ...base, env: { BLENDER_EXE: '/opt/b/blender' } }), '/opt/b/blender');
  assert.equal(findBlender({ ...base, env: { BLENDER_EXE: '/nope/blender' } }), '/usr/bin/blender', 'falls through to PATH');
  assert.equal(findBlender({ ...base, env: {}, pathDirs: [], exists: () => false }), null);
});

test('findBlender(): the highest installed "Blender N.M" under a Program Files root', () => {
  const root = 'C:\\Program Files\\Blender Foundation';
  const found = findBlender({
    platform: 'win32', env: {}, pathDirs: [], defaults: [],
    globRoots: [root],
    listDir: (d) => (d === root ? ['Blender 4.2', 'Blender 5.10', 'Blender 5.2', 'notes.txt'] : []),
    exists: (p) => p.endsWith('blender.exe'),
  });
  assert.equal(found, win32.join(root, 'Blender 5.10', 'blender.exe'));
});

test('runBlender: a script that raises throws with the stderr tail', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ncld-blender-'));
  try {
    const script = join(dir, 'boom.py');
    writeFileSync(script, 'raise RuntimeError("kaboom-from-python")\n');
    await assert.rejects(runBlender(script, {}, SLOW), /kaboom-from-python/);
    const quiet = join(dir, 'quiet.py');
    writeFileSync(quiet, 'print("no result line")\n');
    await assert.rejects(runBlender(quiet, {}, SLOW), /@@RESULT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('inspect → convert --lod 0.5 → inspect → preview on a Kenney GLB', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ncld-blender-'));
  try {
    const info = await runBlender('inspect', { in: SAMPLE }, SLOW);
    assert.ok(info.tris > 0, `input tris ${info.tris}`);
    assert.ok(info.objects.some((/** @type {any} */ o) => o.type === 'MESH' && o.tris > 0));
    assert.equal(info.bounds.min.length, 3);
    assert.ok(info.bounds.max[1] > info.bounds.min[1], 'non-empty bounds');
    assert.ok(Array.isArray(info.armatures) && Array.isArray(info.actions));

    const out = join(dir, 'box_lod.glb');
    const conv = await runBlender('convert', { in: SAMPLE, out, lod: 0.5 }, SLOW);
    assert.ok(existsSync(out));
    assert.equal(conv.bytes, statSync(out).size);
    assert.ok(conv.tris > 0 && conv.tris <= info.tris, `lod tris ${conv.tris} vs ${info.tris}`);
    assert.equal(readFileSync(out).subarray(0, 4).toString('latin1'), 'glTF');

    const again = await runBlender('inspect', { in: out }, SLOW);
    assert.ok(again.tris > 0 && again.tris <= info.tris, 'the exported GLB carries the decimated mesh');

    const png = join(dir, 'box.png');
    const prev = await runBlender('preview', { in: SAMPLE, out: png }, SLOW);
    assert.ok(existsSync(png));
    assert.deepEqual([...readFileSync(png).subarray(1, 4)], [0x50, 0x4e, 0x47], 'a PNG');
    assert.equal(prev.size, 512);
    assert.match(prev.engine, /EEVEE|WORKBENCH/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
