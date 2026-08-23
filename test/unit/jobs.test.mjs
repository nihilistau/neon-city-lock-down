// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_ACTIONS } from '../../src/sim/dayPlan.js';
import { JOB_DEST, jobDest } from '../../src/sim/jobs.js';
import { ZONES, FLOORS } from '../../data/zones.js';

test('every day-plan action has a spatial destination', () => {
  for (const a of DAY_ACTIONS) {
    const d = jobDest(a.id);
    assert.ok(d, `${a.id} has no JOB_DEST`);
    assert.ok(FLOORS[d.floor], `${a.id}: unknown floor ${d.floor}`);
    assert.ok(ZONES[d.zone], `${a.id}: unknown zone ${d.zone}`);
    assert.equal(ZONES[d.zone].floor, d.floor, `${a.id}: zone ${d.zone} is not on ${d.floor}`);
    assert.ok(d.durationMin >= 1);
  }
});

test('forage goes to the rooftop garden, repair to VOX core', () => {
  assert.equal(jobDest('forage').floor, 'rooftop');
  assert.equal(jobDest('repair').zone, 'vox_core');
  assert.equal(jobDest('train').zone, 'armoury');
  assert.equal(jobDest('rest').zone, 'bed_alcove');
});

test('JOB_DEST has no orphan ids', () => {
  const ids = new Set(DAY_ACTIONS.map((a) => a.id));
  for (const id of Object.keys(JOB_DEST)) {
    assert.ok(ids.has(id), `JOB_DEST.${id} is not a day-plan action`);
  }
});
