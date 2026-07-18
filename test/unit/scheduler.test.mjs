// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../../src/sim/scheduler.js';
import { newRunState } from '../../src/sim/world.js';

// mock rng: chance always true, weighted picks the first (deterministic fire)
const rng = { chance: () => true, weighted: (pool) => pool[0] };
const clock = (m) => ({ day: 5, minuteOfDay: ((m % 1440) + 1440) % 1440, phase: 'night', totalMinutes: m });
// full run state so event weight() functions (which read systems/resources) work
const freshRun = (over = {}) => Object.assign(newRunState(1), { threat: 50, ...over });

test('no random event fires within MIN_GAP of the previous event ending', () => {
  const s = new Scheduler(rng);
  const run = freshRun({ lastEventEndMinute: 1000 });
  let fired = null;
  for (let m = 1001; m < 1000 + 150; m++) {         // MIN_GAP window
    const r = s.tick(run, clock(m));
    if (r) { fired = m; break; }
  }
  assert.equal(fired, null, `nothing should fire before minute ${1000 + 150}`);
});

test('an event can fire once past the gap + roll interval', () => {
  const s = new Scheduler(rng);
  const run = freshRun({ lastEventEndMinute: 1000 });
  let fired = null;
  for (let m = 1001; m < 1000 + 400; m++) {
    const r = s.tick(run, clock(m));
    if (r) { fired = m; break; }
  }
  assert.ok(fired !== null, 'an event should fire after the gap');
  assert.ok(fired >= 1000 + 150, `must respect MIN_GAP (fired at ${fired})`);
});

test('an active event blocks rolls and restarts the roll clock', () => {
  const s = new Scheduler(rng);
  const run = freshRun({ lastEventEndMinute: -Infinity, activeEventId: 'blackout' });
  for (let m = 0; m < 300; m++) assert.equal(s.tick(run, clock(m)), null);
  assert.equal(s._sinceRoll, 0, 'roll counter is held at 0 during an active event');
});

test('queued events fire immediately, bypassing the gap', () => {
  const s = new Scheduler(rng);
  const run = freshRun({ lastEventEndMinute: 9999, eventQueue: [{ atMinute: 10, eventId: 'refugee' }] });
  assert.equal(s.tick(run, clock(20)), 'refugee', 'a due queued event ignores MIN_GAP');
});
