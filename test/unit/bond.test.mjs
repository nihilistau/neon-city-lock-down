// @ts-check
// src/chars/bond.js — the relationship tier that replaced the intimacy ladder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOND_TIERS, bondScore, bondTier, bondAtLeast, bondIndex } from '../../src/chars/bond.js';

const s = (trust, loyalty) => ({ trust, loyalty });

test('tiers are ordered stranger < ally < trusted < loyal', () => {
  assert.deepEqual(BOND_TIERS, ['stranger', 'ally', 'trusted', 'loyal']);
  assert.ok(bondIndex('ally') < bondIndex('trusted'));
  assert.equal(bondIndex('nonsense'), -1);
});

test('score is the mean of trust and loyalty', () => {
  assert.equal(bondScore(s(40, 30)), 35);
});

test('entry thresholds with no previous tier', () => {
  assert.equal(bondTier(s(34, 34)), 'stranger');
  assert.equal(bondTier(s(35, 35)), 'ally');
  assert.equal(bondTier(s(55, 55)), 'trusted');
  assert.equal(bondTier(s(75, 75)), 'loyal');
  assert.equal(bondTier(s(100, 100)), 'loyal');
});

test('hysteresis: a held tier survives small dips, drops only below entry-5', () => {
  assert.equal(bondTier(s(34, 34), 'ally'), 'ally');   // 34 ≥ 30
  assert.equal(bondTier(s(31, 31), 'ally'), 'ally');
  assert.equal(bondTier(s(29, 29), 'ally'), 'stranger');
  assert.equal(bondTier(s(51, 51), 'trusted'), 'trusted');
  assert.equal(bondTier(s(49, 49), 'trusted'), 'ally');
});

test('hysteresis never promotes: rising still needs the full entry score', () => {
  assert.equal(bondTier(s(54, 54), 'ally'), 'ally');
  assert.equal(bondTier(s(55, 55), 'ally'), 'trusted');
});

test('a large fall can skip tiers', () => {
  assert.equal(bondTier(s(10, 10), 'loyal'), 'stranger');
});

test('bondAtLeast compares against the (hysteresis-aware) tier', () => {
  assert.equal(bondAtLeast(s(40, 40), 'ally'), true);
  assert.equal(bondAtLeast(s(40, 40), 'trusted'), false);
  assert.equal(bondAtLeast(s(33, 33), 'ally', 'ally'), true);
  assert.equal(bondAtLeast(s(0, 0), 'stranger'), true);
});
