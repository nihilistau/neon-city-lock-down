// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldDinner, markDinner, shouldSleep, markSleep, minutesUntil, nightScoreMul,
  DINNER_MINUTE, SLEEP_MINUTE,
} from '../../src/sim/livingBeats.js';
import { ACTIONS } from '../../src/sim/ai/actionCatalog.js';
import { interruptChance } from '../../src/sim/jobs.js';

const ids = () => ACTIONS.map((a) => a.id);

test('dinner fires once per calendar day', () => {
  const run = { flags: {} };
  const clock = { day: 1, minuteOfDay: DINNER_MINUTE };
  assert.equal(shouldDinner(run, clock), true);
  markDinner(run, clock);
  assert.equal(shouldDinner(run, clock), false);
  assert.equal(shouldDinner(run, { day: 2, minuteOfDay: DINNER_MINUTE }), true);
});

test('sleep fires once per calendar day', () => {
  const run = { flags: {} };
  const clock = { day: 2, minuteOfDay: SLEEP_MINUTE };
  assert.equal(shouldSleep(run, clock), true);
  markSleep(run, clock);
  assert.equal(shouldSleep(run, clock), false);
});

test('minutesUntil wraps past midnight', () => {
  assert.equal(minutesUntil({ minuteOfDay: 18 * 60 }, 19), 60);
  assert.equal(minutesUntil({ minuteOfDay: 23 * 60 }, 1), 2 * 60);
});

test('catalog includes shower, vanity, telescope, garden', () => {
  for (const id of ['shower', 'vanity', 'telescope', 'garden', 'sleep']) {
    assert.ok(ids().includes(id), `missing action ${id}`);
  }
});

test('late night multiplies sleep and damps dance', () => {
  assert.equal(nightScoreMul(2 * 60, 'sleep'), 3);
  assert.ok(nightScoreMul(2 * 60, 'dance') < 0.5);
  assert.equal(nightScoreMul(12 * 60, 'sleep'), 1);
  const sleep = ACTIONS.find((a) => a.id === 'sleep');
  const late = sleep.score({ id: 'lola', stats: { energy: 80 } }, { rest: 10 }, { minuteOfDay: 2 * 60 });
  const noon = sleep.score({ id: 'lola', stats: { energy: 80 } }, { rest: 10 }, { minuteOfDay: 12 * 60 });
  assert.ok(late > noon);
});

test('interruptChance only forage at high threat', () => {
  const yes = { next: () => 0, chance: () => true };
  const no = { next: () => 1, chance: () => false };
  assert.equal(interruptChance({ threat: 80 }, 'forage', yes), true);
  assert.equal(interruptChance({ threat: 10 }, 'forage', yes), false);
  assert.equal(interruptChance({ threat: 80 }, 'repair', yes), false);
  assert.equal(interruptChance({ threat: 80 }, 'forage', no), false);
});
