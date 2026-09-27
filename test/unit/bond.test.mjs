// @ts-check
// src/chars/bond.js — the relationship tier that replaced the intimacy ladder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOND_TIERS, bondScore, bondTier, bondAtLeast, bondIndex } from '../../src/chars/bond.js';
import { Character } from '../../src/chars/character.js';
import { on, resetBus } from '../../src/core/bus.js';
import * as THREE from 'three';
import lola from '../../data/cast/lola.js';

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

function stubChar(persona) {
  const actor = { root: { position: new THREE.Vector3() }, setTempo() {}, playClip() {}, setDowned() {},
    face: { setExpression() {} } };
  const queue = { hooks: {}, zone: null, clear() {}, goto() {} };
  return new Character(persona, /** @type {any} */ (actor), /** @type {any} */ (queue));
}

test('Character exposes bond and emits bond.changed once per real crossing', () => {
  resetBus();
  const c = stubChar(lola);
  c.stats.trust = 20; c.stats.loyalty = 20; c._refreshBond(true);
  assert.equal(c.bond, 'stranger');
  const seen = [];
  on('bond.changed', (e) => seen.push(e));
  c.applyStats({ trust: 30, loyalty: 30 }, 'test');     // → ally (unless receptivity dampens; see below)
  c.stats.trust = 40; c.stats.loyalty = 40; c._refreshBond();
  assert.equal(c.bond, 'ally');
  c.stats.trust = 33; c.stats.loyalty = 33; c._refreshBond();   // dip inside hysteresis
  assert.equal(c.bond, 'ally');
  assert.equal(seen.filter((e) => e.to === 'ally').length, 1);
  assert.ok(c.bondAtLeast('ally'));
  assert.ok(!c.bondAtLeast('trusted'));
});

test('serialize carries bond; restore ignores legacy gates/consent', () => {
  const c = stubChar(lola);
  c.stats.trust = 60; c.stats.loyalty = 60; c._refreshBond(true);
  const d = c.serialize();
  assert.equal(d.bond, 'trusted');
  assert.ok(!('gates' in d) && !('consent' in d));
  const c2 = stubChar(lola);
  c2.restore({ ...d, gates: { kiss: 'granted' }, consent: {} });
  assert.equal(c2.bond, 'trusted');
  assert.ok(!('gates' in c2));
});

test('ActorQueue refuses a minBond command the character has not reached', async () => {
  const { ActorQueue } = await import('../../src/sim/actors/actorQueue.js');
  const actor = { id: 'x', root: { position: new THREE.Vector3() } };
  const q = new ActorQueue(/** @type {any} */ (actor), /** @type {any} */ ({}), {
    bondCheck: (tier) => tier === 'ally',
  });
  assert.equal(q.push({ type: 'wait', args: [1], minBond: 'trusted' }), false);
  assert.equal(q.push({ type: 'wait', args: [1], minBond: 'ally' }), true);
  assert.equal(q.push({ type: 'wait', args: [1] }), true);
});
