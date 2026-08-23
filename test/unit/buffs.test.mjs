// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRunState } from '../../src/sim/world.js';
import { ITEMS } from '../../data/items.js';
import { tickBuffs } from '../../src/sim/buffs.js';

function fakeApp(overrides = {}) {
  const run = newRunState(1);
  return { run, clock: { totalMinutes: 100 }, cast: {}, ...overrides };
}

test('stim buffs skill and morale instead of a missing stamina field', () => {
  const app = fakeApp();
  const before = app.run.player.skill;
  const msg = ITEMS.stim.use(app);
  assert.equal(typeof msg, 'string');
  assert.ok(app.run.player.skill > before, 'skill should rise');
  assert.ok(app.run.player.morale > 70, 'morale should rise');
  assert.equal(app.run.player.stamina, undefined, 'stamina is not a player field');
  assert.ok((app.run.flags.stimUntil ?? 0) > 100, 'stim stamps an expiry minute');
});

test('stim expires and removes the skill boost', () => {
  const app = fakeApp();
  const before = app.run.player.skill;
  ITEMS.stim.use(app);
  const boosted = app.run.player.skill;
  tickBuffs(app.run, 100);
  assert.equal(app.run.player.skill, boosted, 'still active at the start minute');
  tickBuffs(app.run, app.run.flags.stimUntil);
  assert.equal(app.run.player.skill, before, 'boost falls off at expiry');
  assert.equal(app.run.flags.stimUntil, null);
});

test('medkit heals the player and does not wipe NPC injuries', () => {
  const injured = { injuries: [{ part: 'arm', severity: 'wound' }] };
  const app = fakeApp({ cast: { lola: injured } });
  app.run.player.health = 40;
  ITEMS.medkit.use(app);
  assert.ok(app.run.player.health >= 85);
  assert.equal(injured.injuries.length, 1, 'NPC injuries stay until you treat them');
});
