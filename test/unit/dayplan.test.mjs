// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRunState } from '../../src/sim/world.js';
import { performAction, canAct, resetDayPlan, AP_PER_DAY } from '../../src/sim/dayPlan.js';
import { updateObjectives, objectiveState } from '../../src/sim/objectives.js';

const rng = { int: (a, b) => a, chance: () => false };

test('repair costs a part + AP and restores the weakest system', () => {
  const run = newRunState(1);
  run.systems.defence.hp = 40;      // weakest
  const parts0 = run.resources.parts, ap0 = run.dayPlan.ap;
  const r = performAction(run, 'repair', rng);
  assert.ok(r.ok);
  assert.equal(run.resources.parts, parts0 - 1);
  assert.equal(run.dayPlan.ap, ap0 - 1);
  assert.ok(run.systems.defence.hp >= 74, `defence ${run.systems.defence.hp}`);
});

test('actions are blocked when out of AP', () => {
  const run = newRunState(1);
  run.dayPlan.ap = 0;
  assert.equal(canAct(run, 'forage'), false);
  assert.equal(performAction(run, 'forage', rng).ok, false);
});

test('deal spends luxury, lowers threat, and counts toward ceasefire', () => {
  const run = newRunState(1);
  run.resources.luxury = 6; run.threat = 50;
  performAction(run, 'deal', rng);
  assert.equal(run.resources.luxury, 3);
  assert.ok(run.threat < 50);
  assert.equal(run.flags.dealt, 1);
});

test('train raises combat skill; caps out', () => {
  const run = newRunState(1);
  run.player.skill = 60;
  performAction(run, 'train', rng);
  assert.ok(run.player.skill > 60);
  run.player.skill = 92; run.dayPlan.ap = 4;
  assert.equal(canAct(run, 'train'), false, 'no training past the cap');
});

test('resetDayPlan refills the AP pool', () => {
  const run = newRunState(1);
  run.dayPlan.ap = 0;
  resetDayPlan(run);
  assert.equal(run.dayPlan.ap, AP_PER_DAY);
});

test('objectives complete once and grant a reward', () => {
  const run = newRunState(1);
  run.flags.dealt = 2;              // ceasefire condition met
  const parts0 = run.resources.parts;
  const done = updateObjectives(run, { day: 3, totalMinutes: 100 });
  assert.ok(done.some((o) => o.id === 'ceasefire'));
  assert.ok(run.objectives.done.includes('ceasefire'));
  // completing again yields nothing new
  const again = updateObjectives(run, { day: 3, totalMinutes: 200 });
  assert.equal(again.length, 0);
});

test('objectiveState reports live progress 0..1', () => {
  const run = newRunState(1);
  run.player.skill = 60;            // sharpshooter target 85
  const st = objectiveState(run, { day: 1, totalMinutes: 0 });
  const sharp = st.find((o) => o.id === 'sharpshooter');
  assert.equal(sharp.progress, 0);
  run.player.skill = 85;
  const st2 = objectiveState(run, { day: 1, totalMinutes: 0 });
  assert.equal(st2.find((o) => o.id === 'sharpshooter').progress, 1);
});
