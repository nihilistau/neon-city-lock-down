// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDLE_SPOKEN, BANTER_SPOKEN, Relationships } from '../../src/sim/ai/relationships.js';
import { newRunState } from '../../src/sim/world.js';
import { hourlyTick } from '../../src/sim/survival.js';
import { waypointPos, floorOf } from '../../src/sim/actors/nav.js';
import { crouchCover } from '../../src/sim/combat/cover.js';
import { rollLoot } from '../../src/sim/combat/loot.js';
import { buildRefugee } from '../../data/cast/refugee.js';

test('needle lines are spoken in first person, not narrated', () => {
  for (const by of Object.values(NEEDLE_SPOKEN)) {
    for (const pool of Object.values(by)) {
      for (const line of pool) {
        assert.equal(typeof line, 'string');
        assert.ok(!/\b(tells|asks|wonders aloud|mentions)\b/i.test(line), line);
      }
    }
  }
  assert.ok(NEEDLE_SPOKEN.lola.aria.length >= 1);
  assert.ok(BANTER_SPOKEN.length >= 3);
});

test('a relationship beat calls speak on the aggressor', () => {
  const spoken = [];
  const fake = (id, name, zone) => ({
    id, name, alive: true, present: true,
    stats: { tension: 20, happiness: 50, dominance: id === 'lola' ? 90 : 40 },
    memory: { relTo: () => ({ affinity: 10, grudge: 0 }) },
    applyStats() {},
    actor: { root: { visible: true }, face: { setExpression() {} } },
    queue: { zone, busy: false, playClip() {}, look() {} },
  });
  const rel = new Relationships({
    cast: () => ({ lola: fake('lola', 'Lola', 'lounge'), aria: fake('aria', 'Aria', 'lounge') }),
    brains: {},
    rng: { chance: () => true, next: () => 0.1, pick: (a) => a[0] },
    nowMinute: () => 10,
    speak: (c, text) => spoken.push({ id: c.id, text }),
  });
  rel._sinceBeat = 15;
  rel.tick();
  assert.ok(spoken.length >= 1, 'expected a spoken line');
  assert.equal(spoken[0].id, 'lola');
});

test('refugee factory is corporeal with a unique id and name', () => {
  const a = buildRefugee(0);
  const b = buildRefugee(1);
  assert.equal(a.corporeal, true);
  assert.notEqual(a.id, b.id);
  assert.ok(a.body.height > 1.5);
  assert.ok(a.name.length > 2);
});

test('a corporeal refugee in the cast eats; the refugees integer does not double-count', () => {
  const runA = newRunState(1);
  const runB = newRunState(1);
  runB.refugees = 1;
  const npc = { persona: { corporeal: true }, stats: {}, applyStats() {}, tickMinutes() {} };
  hourlyTick(runA, [npc]);
  hourlyTick(runB, [npc]);
  assert.equal(runA.resources.food, runB.resources.food, 'integer refugees must not add a second mouth once they have a body');
});

test('reception and rooftop waypoints live on their floor offsets, not penthouse origin', () => {
  const [rx] = waypointPos('reception');
  const [ox] = waypointPos('rooftop');
  assert.ok(rx > 900, `reception world x ${rx}`);
  assert.ok(ox > 100 && ox < 400, `rooftop world x ${ox}`);
  assert.equal(floorOf('reception'), 'ground');
  assert.equal(floorOf('vox_core'), 'fl27');
});

test('crouching adds cover even in the open', () => {
  assert.equal(crouchCover(0, false), 0);
  assert.ok(crouchCover(0, true) >= 0.2);
  assert.ok(crouchCover(0.5, true) > 0.5);
  assert.ok(crouchCover(1, true) <= 1);
});

test('loot roll always yields ammo and sometimes an item', () => {
  const always = { int: (a, b) => a, chance: () => true, pick: (a) => a[0] };
  const never = { int: (a, b) => b, chance: () => false, pick: (a) => a[0] };
  const yes = rollLoot(always);
  const no = rollLoot(never);
  assert.ok(yes.ammo >= 3);
  assert.ok(yes.item);
  assert.ok(no.ammo >= 3);
  assert.equal(no.item, null);
});
