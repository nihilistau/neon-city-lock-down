// @ts-check
// tools/lib/lut.mjs — the neon-noir colour grade, authored as code because the
// project has no grading tools. A .cube LUT is a lookup table the GPU samples
// with the pixel's own colour, so two properties matter more than the look:
// the table must be in the order LUTCubeLoader reads (red fastest), and the
// grade must be monotone in brightness, or a gradient bands and inverts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neonNoir, cubeText, parseCube, LUT_SIZE, GRADES } from '../../tools/lib/lut.mjs';

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('the .cube header and row count', () => {
  const text = cubeText({ title: 'neon_noir', size: 5, grade: neonNoir });
  const lines = text.trim().split('\n');
  assert.equal(lines[0], 'TITLE "neon_noir"');
  assert.equal(lines[1], 'LUT_3D_SIZE 5');
  assert.equal(lines[2], 'DOMAIN_MIN 0.0 0.0 0.0');
  assert.equal(lines[3], 'DOMAIN_MAX 1.0 1.0 1.0');
  assert.equal(parseCube(text).rows.length, 125);
  assert.ok(text.endsWith('\n'));
});

test('red varies fastest, then green, then blue — the order LUTCubeLoader reads', () => {
  const { rows } = parseCube(cubeText({ title: 'id', size: 2, grade: (c) => c }));
  assert.deepEqual(rows[0], [0, 0, 0]);
  assert.deepEqual(rows[1], [1, 0, 0]);
  assert.deepEqual(rows[2], [0, 1, 0]);
  assert.deepEqual(rows[4], [0, 0, 1]);
  assert.deepEqual(rows[7], [1, 1, 1]);
});

test('every graded value stays inside 0..1', () => {
  for (const row of parseCube(cubeText({ title: 'n', size: 9, grade: neonNoir })).rows) {
    for (const v of row) assert.ok(v >= 0 && v <= 1, `${v} out of range`);
  }
});

test('black stays black and white stays white — the grade tints, it does not fog', () => {
  assert.ok(Math.max(...neonNoir([0, 0, 0])) < 0.05);
  assert.ok(Math.min(...neonNoir([1, 1, 1])) > 0.93);
});

test('a grey ramp never gets darker as it gets brighter (no banding inversions)', () => {
  let prev = -1;
  for (let i = 0; i <= 64; i++) {
    const v = i / 64;
    const l = luma(neonNoir([v, v, v]));
    assert.ok(l >= prev - 1e-9, `luma dipped at ${v}: ${l} < ${prev}`);
    prev = l;
  }
});

test('split tone: teal in the shadows, warm-magenta in the highlights', () => {
  const [sr, , sb] = neonNoir([0.1, 0.1, 0.1]);
  assert.ok(sb > sr, 'shadows lean blue-green');
  const [hr, hg] = neonNoir([0.85, 0.85, 0.85]);
  assert.ok(hr > hg, 'highlights lean warm');
});

test('the shipped defaults', () => {
  assert.equal(LUT_SIZE, 33);
  assert.equal(GRADES.neonNoir, neonNoir);
});
