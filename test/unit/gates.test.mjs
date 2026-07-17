// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATE_LADDER, defaultGates, defaultConsent, gateCheck, canOffer,
  setGate, highestGranted, tierIndex,
} from '../../src/chars/gates.js';
import { defaultStats } from '../../src/chars/stats.js';

/** Build a fully-consenting, high-stat character for happy-path tests. */
function maxChar() {
  const stats = defaultStats();
  for (const k of Object.keys(stats)) stats[k] = 90;
  stats.fear = 0; stats.tension = 0;
  const gates = defaultGates();
  const consent = defaultConsent();
  for (const t of GATE_LADDER) { gates[t] = 'granted'; consent.ladder[t] = { given: true, at: 0 }; }
  return { stats, gates, consent };
}

test('ladder has 7 tiers in order', () => {
  assert.equal(GATE_LADDER.length, 7);
  assert.equal(GATE_LADDER[0], 'light_touch');
  assert.equal(GATE_LADDER[6], 'depraved');
  assert.ok(tierIndex('kiss') < tierIndex('intimate'));
});

test('fresh character: nothing above light_touch offerable', () => {
  const stats = defaultStats();
  const char = { stats, gates: defaultGates(), consent: defaultConsent() };
  assert.equal(canOffer(char, 'intimate', { explicitness: 'full' }), false);
});

test('gateCheck denies without consent even at full stats', () => {
  const char = maxChar();
  char.consent.ladder.kiss.given = false;
  const r = gateCheck(char, 'kiss', { explicitness: 'full' });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'no_consent');
});

test('gateCheck allows on the happy path', () => {
  const char = maxChar();
  assert.deepEqual(gateCheck(char, 'intimate', { explicitness: 'full' }), { allowed: true });
});

test('explicitness cap blocks tiers above the setting', () => {
  const char = maxChar();
  assert.equal(gateCheck(char, 'explicit', { explicitness: 'mature' }).reason, 'explicitness_cap');
  assert.equal(gateCheck(char, 'kiss', { explicitness: 'suggestive' }).allowed, true);
  assert.equal(gateCheck(char, 'touch', { explicitness: 'suggestive' }).reason, 'explicitness_cap');
});

test('consent withdrawal beats everything', () => {
  const char = maxChar();
  setGate(char, 'kiss', 'withdraw');
  assert.equal(gateCheck(char, 'kiss', { explicitness: 'full' }).reason, 'consent_withdrawn');
});

test('safeword blocks and also withdraws', () => {
  const char = maxChar();
  setGate(char, 'intimate', 'safeword');
  const r = gateCheck(char, 'light_touch', { explicitness: 'full' });
  assert.equal(r.reason, 'safeword');
  assert.equal(char.consent.withdrawn, true);
});

test('ladder integrity: cannot reach intimate if touch not granted', () => {
  const char = maxChar();
  char.gates.touch = 'offered';
  const r = gateCheck(char, 'intimate', { explicitness: 'full' });
  assert.equal(r.reason, 'lower_tier_locked');
  assert.equal(r.need, 'touch');
});

test('stat thresholds gate offers', () => {
  const stats = defaultStats();
  stats.trust = 40; stats.arousal = 20; stats.openness = 40;
  const char = { stats, gates: defaultGates(), consent: defaultConsent() };
  char.gates.light_touch = 'granted';
  // kiss needs arousal 25 — currently 20
  assert.equal(canOffer(char, 'kiss', { explicitness: 'full' }), false);
  stats.arousal = 30;
  assert.equal(canOffer(char, 'kiss', { explicitness: 'full' }), true);
});

test('setGate transitions are sanctioned only', () => {
  const stats = defaultStats();
  const char = { stats, gates: defaultGates(), consent: defaultConsent() };
  assert.equal(setGate(char, 'kiss', 'offer'), true);
  assert.equal(char.gates.kiss, 'offered');
  assert.equal(setGate(char, 'kiss', 'grant', 120), true);
  assert.equal(char.gates.kiss, 'granted');
  assert.equal(char.consent.ladder.kiss.given, true);
  assert.equal(char.consent.ladder.kiss.at, 120);
  assert.equal(setGate(char, 'kiss', 'revoke'), true);
  assert.equal(char.gates.kiss, 'revoked');
  assert.equal(char.consent.ladder.kiss.given, false);
});

test('highestGranted finds the top granted tier', () => {
  const gates = defaultGates();
  gates.light_touch = 'granted';
  gates.kiss = 'granted';
  gates.touch = 'offered';
  assert.equal(highestGranted(gates), 'kiss');
  assert.equal(highestGranted(defaultGates()), null);
});
