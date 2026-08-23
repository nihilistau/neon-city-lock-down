// @ts-check
// Player-aimed shots must land when the ray hits a body. Cover cuts damage;
// it must never convert a mesh-hit into a miss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAimedShot, resolveAttack } from '../../src/sim/combat/resolver.js';
import { CONFIG_DEFAULTS } from '../../data/configDefaults.js';
import { ITEMS } from '../../data/items.js';
import { SFX_IDS } from '../../src/audio/sfx/synthKit.js';

const weapon = { id: 'sidearm', damage: [10, 10], accuracy: 0.5, range: 9 };
const rng = { chance: () => false, range: (a, b) => (a + b) / 2 };

test('aimed shot on a mesh always hits', () => {
  const res = resolveAimedShot({ weapon, cover: 0, rng });
  assert.equal(res.hit, true);
  assert.equal(res.damage, 10);
});

test('full cover cuts aimed damage but still hits', () => {
  const open = resolveAimedShot({ weapon, cover: 0, rng });
  const covered = resolveAimedShot({ weapon, cover: 1, rng });
  assert.equal(covered.hit, true);
  assert.ok(covered.damage < open.damage, `cover should cut damage (${covered.damage} !< ${open.damage})`);
  assert.ok(covered.glancing, 'full cover reads as a glancing hit');
});

test('NPC dice resolution can still miss (aimed path is player-only)', () => {
  const missRng = { chance: () => false, range: (a, b) => a };
  const res = resolveAttack({ weapon, skill: 10, distance: 20, cover: 0.8 }, missRng);
  assert.equal(res.hit, false);
});

test('fists are their own melee weapon, not a shiv alias', () => {
  assert.equal(ITEMS.fists.weaponKey, 'fists');
  assert.ok(CONFIG_DEFAULTS.combat.weapons.fists, 'config has a fists row');
  assert.ok(CONFIG_DEFAULTS.combat.weapons.fists.range <= 1.2);
  assert.ok(CONFIG_DEFAULTS.combat.magSize.fists >= 1);
});

test('combat SFX recipes include reload and impact hits', () => {
  for (const id of ['reload', 'hit_flesh', 'hit_cover']) {
    assert.ok(SFX_IDS.includes(id), `missing sfx recipe: ${id}`);
  }
});
