// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveMood, animTempo } from '../../src/chars/mood.js';
import { defaultStats } from '../../src/chars/stats.js';

test('high tension → volatile', () => {
  const s = defaultStats(); s.tension = 95; s.happiness = 10;
  assert.equal(deriveMood(s).id, 'volatile');
});

test('high fear → afraid', () => {
  const s = defaultStats(); s.fear = 90; s.tension = 20; s.dominance = 10;
  assert.equal(deriveMood(s).id, 'afraid');
});

test('mood carries face + idle hints', () => {
  const s = defaultStats(); s.dominance = 90;
  const m = deriveMood(s);
  assert.ok(m.face);
  assert.ok(typeof m.idle === 'string');
});

test('animTempo: energy speeds up, tension tightens', () => {
  const base = { ...defaultStats(), energy: 50, tension: 20 };
  assert.ok(animTempo({ ...base, energy: 95 }) > animTempo(base));
  assert.ok(animTempo({ ...base, energy: 5 }) < animTempo(base));
  const t = animTempo({ ...base, energy: 100, tension: 100 });
  assert.ok(t >= 0.7 && t <= 1.6);
});
