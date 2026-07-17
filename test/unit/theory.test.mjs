// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCALES, nextDegree, chordOn, mtof, wander } from '../../src/audio/music/theory.js';

test('scales have 7 degrees', () => {
  for (const [name, s] of Object.entries(SCALES)) {
    assert.equal(s.length, 7, `${name} should have 7 notes`);
    assert.equal(s[0], 0, `${name} starts on root`);
  }
});

test('nextDegree stays within the walk graph', () => {
  let deg = 0;
  const seq = [0.1, 0.5, 0.9, 0.3, 0.7, 0.99, 0.01];
  let i = 0;
  const rand = () => seq[i++ % seq.length];
  for (let n = 0; n < 30; n++) {
    deg = nextDegree(deg, rand);
    assert.ok(deg >= 0 && deg <= 6, `degree ${deg} out of range`);
  }
});

test('chordOn builds ascending triads', () => {
  const c = chordOn(SCALES.aeolian, 0);
  assert.equal(c.length, 3);
  assert.ok(c[1] > c[0] && c[2] > c[1]);
});

test('mtof: A4 = 440Hz', () => {
  assert.ok(Math.abs(mtof(69) - 440) < 0.01);
});

test('wander stays within two octaves', () => {
  let idx = 7;
  const rand = (() => { let i = 0; const s = [0.1, 0.9, 0.4, 0.6, 0.2]; return () => s[i++ % s.length]; })();
  for (let n = 0; n < 40; n++) {
    idx = wander(SCALES.dorian, idx, rand);
    assert.ok(idx >= 0 && idx < SCALES.dorian.length * 2);
  }
});
