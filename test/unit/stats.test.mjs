// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultStats, clamp, applyDelta, decayTick, compliance, couplingFactor, STAT_KEYS,
} from '../../src/chars/stats.js';

test('defaultStats has all 9 keys in range', () => {
  const s = defaultStats();
  assert.equal(Object.keys(s).length, 9);
  for (const k of STAT_KEYS) {
    assert.ok(k in s, `missing ${k}`);
    assert.ok(s[k] >= 0 && s[k] <= 100);
  }
});

test('clamp bounds values', () => {
  assert.equal(clamp(-5), 0);
  assert.equal(clamp(150), 100);
  assert.equal(clamp(42), 42);
});

test('applyDelta clamps at 100 and 0', () => {
  const s = defaultStats();
  s.happiness = 98;
  applyDelta(s, { happiness: 50 });
  assert.equal(s.happiness, 100);
  s.fear = 2;
  applyDelta(s, { fear: -50 });
  assert.equal(s.fear, 0);
});

test('applyDelta returns actually-applied deltas', () => {
  const s = defaultStats();
  s.trust = 99;
  const applied = applyDelta(s, { trust: 10 });
  assert.ok(applied.trust <= 1.01 && applied.trust >= 0);
});

test('personality receptivity scales incoming deltas', () => {
  const dom = defaultStats();
  const meek = defaultStats();
  applyDelta(dom, { dominance: 10 }, { receptivity: { dominance: 1.5 } });
  applyDelta(meek, { dominance: 10 }, { receptivity: { dominance: 0.5 } });
  assert.ok(dom.dominance > meek.dominance);
});

test('coupling: high tension suppresses trust gains', () => {
  const calm = defaultStats(); calm.tension = 0;
  const tense = defaultStats(); tense.tension = 90;
  assert.ok(couplingFactor(tense, 'trust', +10) < couplingFactor(calm, 'trust', +10));
});

test('the retired intimacy stats are gone', () => {
  for (const k of ['arousal', 'pleasure', 'horniness']) assert.ok(!STAT_KEYS.includes(/** @type {any} */ (k)));
});

test('coupling: intoxication (low sobriety) boosts openness gains', () => {
  const sober = defaultStats(); sober.sobriety = 100;
  const drunk = defaultStats(); drunk.sobriety = 20;
  assert.ok(couplingFactor(drunk, 'openness', +10) > couplingFactor(sober, 'openness', +10));
});

test('decayTick never pushes below rest for elevated stats', () => {
  const s = defaultStats();
  s.tension = 22;
  decayTick(s, 100);
  assert.ok(s.tension >= 21.9 && s.tension <= 22.1);
});

test('compliance rises with trust, falls with dominance clash', () => {
  const trusting = defaultStats(); trusting.trust = 90; trusting.openness = 80;
  const cold = defaultStats(); cold.trust = 5; cold.openness = 5;
  assert.ok(compliance(trusting) > compliance(cold));

  const dominant = defaultStats(); dominant.dominance = 95; dominant.trust = 50;
  const lowClash = compliance(dominant, 90);
  const highClash = compliance(dominant, 10);
  assert.ok(highClash < lowClash, 'more dominant NPC than player → lower compliance');
});
