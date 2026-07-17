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

test('high arousal + horniness low tension → sultry', () => {
  const s = defaultStats(); s.arousal = 85; s.horniness = 80; s.tension = 5;
  assert.equal(deriveMood(s).id, 'sultry');
});

test('mood carries face + idle hints', () => {
  const s = defaultStats(); s.dominance = 90;
  const m = deriveMood(s);
  assert.ok(m.face);
  assert.ok(typeof m.idle === 'string');
});

test('animTempo scales with arousal and energy', () => {
  const drained = defaultStats(); drained.arousal = 0; drained.energy = 0;
  const charged = defaultStats(); charged.arousal = 100; charged.energy = 100;
  assert.ok(animTempo(charged) > animTempo(drained));
  assert.ok(animTempo(drained) >= 0.6);
});
