// @ts-check
// src/core/clock.js — game time. The load-bearing property is that skip() (used
// by elevator rides, repairs and sleep) is INDISTINGUISHABLE from letting the
// same minutes elapse in real time: it used to bypass `world.minute`, so event
// scripts, brain ticks, the death check and autosave all froze during a ride.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameClock, MINUTES_PER_DAY } from '../../src/core/clock.js';
import { on, emit } from '../../src/core/bus.js';

/** every world.minute the bus sees, as the listener sees it */
function record(fn) {
  const seen = [];
  const off = on('world.minute', ({ clock }) => seen.push(`${clock.day}:${clock.minuteOfDay}`));
  try { fn(); } finally { off(); }
  return seen;
}

test('skip(n) is indistinguishable from n minutes of real time', () => {
  // the real-time path, exactly as app.js wires it: the loop advances the clock
  // and the clock's per-minute callback emits world.minute
  const realtime = new GameClock();
  realtime.speed = 1;
  const live = record(() => {
    // app.js: onMinute: (clock) => emit('world.minute', { clock })
    for (let i = 0; i < 90; i++) realtime.advance(1000, (c) => emit('world.minute', { clock: c }));
  });

  const skipped = new GameClock();
  const fast = record(() => skipped.skip(90));

  assert.equal(live.length, 90, 'the real-time path must emit one event per minute');
  assert.deepEqual(fast, live, 'skip must produce the same listener-visible minute sequence');
  assert.equal(skipped.minuteOfDay, realtime.minuteOfDay);
  assert.equal(skipped.day, realtime.day);
  assert.equal(skipped.totalMinutes, realtime.totalMinutes);
  assert.equal(skipped.label, realtime.label);
  assert.equal(skipped.phase, realtime.phase);
});

test('skip fires one world.minute per minute, with the clock already advanced', () => {
  const clock = new GameClock();
  const start = clock.minuteOfDay;
  const seen = record(() => clock.skip(45));
  assert.equal(seen.length, 45, 'one event per minute skipped — not one per skip');
  assert.equal(seen[0], `${clock.day}:${start + 1}`, 'the first listener already sees minute+1');
  assert.equal(seen.at(-1), `${clock.day}:${start + 45}`, 'the last sees the final minute');
  assert.equal(clock.minuteOfDay, start + 45);

  assert.deepEqual(record(() => clock.skip(0)), [], 'skipping nothing does nothing');
});

test('the extra onMinute hook runs per minute, alongside the bus event', () => {
  const clock = new GameClock();
  const order = [];
  const off = on('world.minute', () => order.push('bus'));
  clock.skip(3, () => order.push('hook'));
  off();
  assert.deepEqual(order, ['bus', 'hook', 'bus', 'hook', 'bus', 'hook'],
    'the bus event fires regardless of the hook, so callers must not pass worldTick.minute');
});

test('a skip across midnight rolls the day over exactly once per 1440 minutes', () => {
  const clock = new GameClock();
  clock.day = 3;
  clock.minuteOfDay = MINUTES_PER_DAY - 5;
  const seen = record(() => clock.skip(10));
  assert.equal(clock.day, 4);
  assert.equal(clock.minuteOfDay, 5);
  assert.deepEqual(seen.slice(2, 6), ['3:1438', '3:1439', '4:0', '4:1'],
    'the rollover is visible to listeners at the exact minute it happens');

  const long = new GameClock();
  long.minuteOfDay = 0;
  const many = record(() => long.skip(MINUTES_PER_DAY * 2 + 30));
  assert.equal(long.day, 3);
  assert.equal(long.minuteOfDay, 30);
  assert.equal(many.length, MINUTES_PER_DAY * 2 + 30, 'no minute is skipped over');
});

test('advance converts real time at the configured speed and carries the remainder', () => {
  const clock = new GameClock();
  clock.speed = 1;
  const start = clock.minuteOfDay;
  let minutes = 0;
  clock.advance(2500, () => minutes++);
  assert.equal(minutes, 2, '2.5 real seconds at speed 1 = two whole game minutes');
  assert.equal(clock.minuteOfDay, start + 2);
  clock.advance(500, () => minutes++);
  assert.equal(minutes, 3, 'the carried 0.5s completes the third minute');

  const fast = new GameClock();
  fast.speed = 4;
  let fastMinutes = 0;
  fast.advance(1000, () => fastMinutes++);
  assert.equal(fastMinutes, 4, 'speed 4 = four game minutes per real second');

  const paused = new GameClock();
  paused.speed = 0;
  let never = 0;
  paused.advance(60_000, () => never++);
  assert.equal(never, 0, 'speed 0 freezes time');
});

test('serialize/deserialize round-trips, and drops the sub-minute accumulator', () => {
  const clock = new GameClock();
  clock.day = 5; clock.minuteOfDay = 613; clock.speed = 2;
  clock.advance(400);   // half a minute of unspent accumulator
  const wire = JSON.parse(JSON.stringify(clock.serialize()));
  assert.deepEqual(wire, { day: 5, minuteOfDay: 613, speed: 2 });

  const loaded = new GameClock();
  loaded.deserialize(wire);
  assert.equal(loaded.day, 5);
  assert.equal(loaded.minuteOfDay, 613);
  assert.equal(loaded.speed, 2);
  assert.equal(loaded._acc, 0, 'a load must not inherit a half-spent minute');
  assert.equal(loaded.label, 'Day 5 — 10:13');
  assert.equal(loaded.totalMinutes, 4 * MINUTES_PER_DAY + 613);

  const legacy = new GameClock();
  legacy.deserialize(/** @type {any} */ ({ day: 2, minuteOfDay: 60 }));
  assert.equal(legacy.speed, 1, 'a save with no speed defaults to 1× rather than freezing');
});

test('the phase bands cover the whole day with no gaps', () => {
  const clock = new GameClock();
  const phases = new Set();
  for (let m = 0; m < MINUTES_PER_DAY; m++) {
    clock.minuteOfDay = m;
    const p = clock.phase;
    assert.ok(['dawn', 'day', 'dusk', 'night'].includes(p), `minute ${m} has phase ${p}`);
    phases.add(p);
  }
  assert.equal(phases.size, 4, 'every phase must actually occur');
  clock.minuteOfDay = 5 * 60; assert.equal(clock.phase, 'dawn');
  clock.minuteOfDay = 8 * 60; assert.equal(clock.phase, 'day');
  clock.minuteOfDay = 17 * 60; assert.equal(clock.phase, 'dusk');
  clock.minuteOfDay = 20 * 60; assert.equal(clock.phase, 'night');
  clock.minuteOfDay = 0; assert.equal(clock.phase, 'night', 'midnight is night, not a gap');
  clock.minuteOfDay = 0; assert.equal(clock.dayFraction, 0);
  clock.minuteOfDay = MINUTES_PER_DAY / 2; assert.equal(clock.dayFraction, 0.5);
});
