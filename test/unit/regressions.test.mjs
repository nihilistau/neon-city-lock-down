// @ts-check
// Regression guards for bugs fixed in the v0.3.0 correctness pass. Each test
// fails against the pre-fix code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRunState } from '../../src/sim/world.js';
import { hourlyTick } from '../../src/sim/survival.js';
import { Gambits } from '../../src/games/gambits.js';
import { vox } from '../../data/cast/vox.js';
import { lola } from '../../data/cast/lola.js';

/** minimal Character stand-in for survival's cast loop */
function fakeChar(persona) {
  return {
    persona,
    stats: { happiness: 50, tension: 20 },
    applied: [],
    applyStats(d, src) { this.applied.push([d, src]); },
    ticked: 0,
    tickMinutes(m) { this.ticked += m; },
  };
}

test('survival does not count bodiless characters as mouths to feed', () => {
  const withVox = newRunState(1);
  const withoutVox = newRunState(1);
  const corporeal = [fakeChar(lola), fakeChar(lola), fakeChar(lola)];

  hourlyTick(withVox, [...corporeal, fakeChar(vox)]);
  hourlyTick(withoutVox, corporeal);

  // VOX is the tower itself; adding it must not increase consumption at all
  assert.equal(withVox.resources.food, withoutVox.resources.food);
  assert.equal(withVox.resources.water, withoutVox.resources.water);
});

test('a bodiless character still decays hourly but takes no ration penalty', () => {
  const run = newRunState(1);
  run.resources.food = 0;              // maximum shortage
  run.resources.water = 0;
  const voxChar = fakeChar(vox);
  const lolaChar = fakeChar(lola);

  hourlyTick(run, [lolaChar, voxChar]);

  assert.equal(voxChar.ticked, 60, 'VOX still ages');
  assert.equal(voxChar.applied.length, 0, 'VOX does not starve');
  assert.ok(lolaChar.applied.length > 0, 'corporeal cast do feel the shortage');
});

test('corporeal defaults to true, so ordinary cast still eat', () => {
  const a = newRunState(1);
  const b = newRunState(1);
  hourlyTick(a, [fakeChar(lola)]);
  hourlyTick(b, []);
  assert.ok(a.resources.food < b.resources.food, 'an extra mouth consumes more');
});

test('Gambits reads playerSkill live, so training improves social play', () => {
  let skill = 40;
  const g = new Gambits({ rng: { dice: () => 10 }, playerSkill: () => skill });
  assert.equal(g.playerSkill, 40);
  skill = 92;
  assert.equal(g.playerSkill, 92, 'was snapshotted at construction');
});

test('Gambits still accepts a plain number', () => {
  const g = new Gambits({ rng: { dice: () => 10 }, playerSkill: 65 });
  assert.equal(g.playerSkill, 65);
});

test('a fresh run has a live player dominance for the compliance clash term', () => {
  const run = newRunState(1);
  assert.equal(typeof run.player.dominance, 'number');
  assert.ok(run.player.dominance > 0 && run.player.dominance <= 100);
});
