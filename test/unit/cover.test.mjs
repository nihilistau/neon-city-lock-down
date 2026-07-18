// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverBetween, findCoverSpot } from '../../src/sim/combat/cover.js';
import { hitChance, WEAPONS } from '../../src/sim/combat/resolver.js';

const box = (x0, z0, x1, z1, top = 1.0) => ({
  min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: top, z: z1 },
});

test('defender right behind a couch gets cover from the far side', () => {
  const couch = box(-1, 0, 1, 0.6, 0.9);           // slab between defender and attacker
  const c = coverBetween({ x: 0, z: 1.2 }, { x: 0, z: -6 }, [couch]);
  assert.ok(c >= 0.6, `expected strong cover, got ${c}`);
});

test('no cover when the obstacle is far from the defender', () => {
  const couch = box(-1, -4.6, 1, -4, 0.9);          // near the ATTACKER, not the defender
  const c = coverBetween({ x: 0, z: 1.2 }, { x: 0, z: -6 }, [couch]);
  assert.equal(c, 0);
});

test('no cover when attacker has a clear flank', () => {
  const couch = box(-1, 0, 1, 0.6, 0.9);
  const c = coverBetween({ x: 0, z: 1.2 }, { x: 8, z: 1.2 }, [couch]); // shooting along the open side
  assert.equal(c, 0);
});

test('low obstacles give partial cover; walls give none (too tall)', () => {
  const crate = box(-0.5, 0, 0.5, 0.5, 0.7);
  const wall = box(-0.5, 0, 0.5, 0.5, 3.0);
  assert.ok(coverBetween({ x: 0, z: 1 }, { x: 0, z: -5 }, [crate]) > 0.3);
  assert.equal(coverBetween({ x: 0, z: 1 }, { x: 0, z: -5 }, [wall]), 0);
});

test('findCoverSpot lands on the far side from the threat', () => {
  const couch = box(-1, 0, 1, 0.6, 0.95);
  const spot = findCoverSpot([couch], { x: 0, z: -6 }, { x: 0, z: 2 });
  assert.ok(spot, 'found a spot');
  assert.ok(spot.z > 0.6, `spot should be past the couch away from threat, z=${spot.z}`);
  // and that spot actually provides cover against the threat
  const c = coverBetween(spot, { x: 0, z: -6 }, [couch]);
  assert.ok(c >= 0.6);
});

test('cover reduces hitChance', () => {
  const base = { weapon: WEAPONS.smg, skill: 60, distance: 6 };
  assert.ok(hitChance({ ...base, cover: 0.65 }) < hitChance(base));
});
