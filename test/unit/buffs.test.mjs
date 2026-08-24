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

test('stim on a TRAINED player round-trips exactly — the clamp bug', () => {
  // Pinned at 92, not the 60 default: the bug only exists where the grant is
  // clamped. Skill 92 + 12 clamps to 100 (a grant of 8), and expiry used to
  // subtract the nominal 12 — leaving 88, four points BELOW where the stim
  // started. dayPlan training caps at 92, so this is a reachable state and
  // every stim above 88 quietly cost the player skill.
  const app = fakeApp();
  app.run.player.skill = 92;
  ITEMS.stim.use(app);
  assert.equal(app.run.player.skill, 100, 'the grant clamps at 100');
  assert.equal(app.run.flags.stimSkillBoost, 8, 'the RECORDED boost is what was actually applied');

  tickBuffs(app.run, 100);
  assert.equal(app.run.player.skill, 100, 'still active at the start minute');
  tickBuffs(app.run, app.run.flags.stimUntil);
  assert.equal(app.run.player.skill, 92, 'expiry must return skill to where the stim found it');
  assert.equal(app.run.flags.stimUntil, null);
  assert.equal(app.run.flags.stimSkillBoost, 0);
});

test('stim below the clamp still round-trips, and repeated stims never drift', () => {
  const app = fakeApp();
  for (const start of [60, 85, 88, 89, 95, 100]) {
    app.run.player.skill = start;
    app.run.flags.stimUntil = null;
    ITEMS.stim.use(app);
    assert.ok(app.run.player.skill <= 100, 'skill never exceeds 100');
    assert.ok(app.run.player.skill >= start, 'a stim never lowers skill');
    tickBuffs(app.run, app.run.flags.stimUntil);
    assert.equal(app.run.player.skill, start, `stim from ${start} must return to ${start}`);
  }
});

test('medkit heals the player and does not wipe NPC injuries', () => {
  const injured = { injuries: [{ part: 'arm', severity: 'wound' }] };
  const app = fakeApp({ cast: { lola: injured } });
  app.run.player.health = 40;
  ITEMS.medkit.use(app);
  assert.ok(app.run.player.health >= 85);
  assert.equal(injured.injuries.length, 1, 'NPC injuries stay until you treat them');
});
