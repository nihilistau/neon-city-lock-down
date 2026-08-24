// @ts-check
// src/core/loop.js — the frame pump. Pause is a SET of reasons (so five panels
// can't leave the sim frozen behind a dismissed one), the sim runs on a fixed
// accumulator (so physics is frame-rate independent), and dt is clamped (so a
// backgrounded tab does not come back and simulate ten minutes in one frame).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Loop, SIM_STEP_MS } from '../../src/core/loop.js';
import { GameClock } from '../../src/core/clock.js';
import { on } from '../../src/core/bus.js';

/** drive the loop frame by frame instead of by rAF */
function harness(opts = {}) {
  let queued = null;
  let cancelled = [];
  let rafId = 0;
  const g = /** @type {any} */ (globalThis);
  g.requestAnimationFrame = (fn) => { queued = fn; return ++rafId; };
  g.cancelAnimationFrame = (id) => cancelled.push(id);
  g.performance = g.performance || { now: () => 0 };
  let now = 1000;
  g.performance.now = () => now;

  const steps = [];
  const renders = [];
  const minutes = [];
  const clock = new GameClock();
  clock.speed = 1;
  const loop = new Loop({
    clock,
    render: (dt) => renders.push(dt),
    simStep: (ms) => steps.push(ms),
    onMinute: (c) => minutes.push(c.minuteOfDay),
    ...opts,
  });
  return {
    loop, clock, steps, renders, minutes, cancelled,
    get pending() { return queued; },
    /** advance wall-clock by `ms` and run one frame */
    frame(ms) { now += ms; const fn = queued; queued = null; fn?.(now); },
  };
}

test('pause reasons are a set — the sim resumes only when the last one lets go', () => {
  const h = harness();
  const events = [];
  const off = on('loop.pause', (p) => events.push(p));
  h.loop.start();

  assert.equal(h.loop.paused, false);
  h.loop.pause('menu');
  assert.equal(h.loop.paused, true);
  h.loop.pause('menu');
  assert.equal(h.loop.pauseReasons.size, 1, 'the same reason twice is still one reason');
  h.loop.pause('cutscene');
  h.loop.pause('elevator');
  assert.equal(h.loop.pauseReasons.size, 3);

  h.loop.resume('menu');
  assert.equal(h.loop.paused, true, 'two panels are still open');
  h.loop.resume('nobody_held_this');
  assert.equal(h.loop.paused, true, 'resuming a reason nobody held changes nothing');
  h.loop.resume('cutscene');
  h.loop.resume('elevator');
  assert.equal(h.loop.paused, false, 'the last release un-pauses');
  off();

  assert.deepEqual(events.map((e) => [e.reason, e.paused]), [
    ['menu', true], ['menu', true], ['cutscene', true], ['elevator', true],
    ['menu', true], ['nobody_held_this', true], ['cutscene', true], ['elevator', false],
  ], 'every pause/resume announces the CURRENT paused state, not its own');
});

test('a paused loop keeps rendering but stops the sim and the clock dead', () => {
  const h = harness();
  h.loop.start();
  h.frame(100);
  assert.equal(h.steps.length, 1, 'running: one sim step per 100ms');
  const day = h.clock.day, minute = h.clock.minuteOfDay;

  h.loop.pause('menu');
  for (let i = 0; i < 20; i++) h.frame(100);
  assert.equal(h.steps.length, 1, 'paused: not one more sim step');
  assert.equal(h.clock.minuteOfDay, minute, 'paused: the clock must not move');
  assert.equal(h.clock.day, day);
  assert.equal(h.minutes.length, 0);
  assert.equal(h.renders.length, 21, 'paused: rendering continues, or the screen freezes');

  h.loop.resume('menu');
  h.frame(100);
  assert.equal(h.steps.length, 2, 'resumed: stepping again');
  assert.ok(h.clock.minuteOfDay >= minute);
});

test('the sim runs on a fixed accumulator, not on frame time', () => {
  const h = harness();
  h.loop.start();

  h.frame(250);
  assert.deepEqual(h.steps, [SIM_STEP_MS, SIM_STEP_MS], '250ms = two whole steps');
  assert.ok(Math.abs(h.loop._simAcc - 50) < 1e-9, 'the 50ms remainder is carried, not dropped');

  h.frame(60);
  assert.equal(h.steps.length, 3, 'the carried 50ms + 60ms completes a third step');
  assert.ok(Math.abs(h.loop._simAcc - 10) < 1e-9);

  // a fast machine (16.7ms frames) accumulates to exactly the same step count as
  // a slow one (100ms frames) over the same wall-clock time
  const fast = harness(); fast.loop.start();
  for (let i = 0; i < 60; i++) fast.frame(1000 / 60);
  const slow = harness(); slow.loop.start();
  for (let i = 0; i < 10; i++) slow.frame(100);
  assert.equal(fast.steps.length, 10, '60 frames of 16.67ms = 1s = 10 sim steps');
  assert.equal(slow.steps.length, 10, '10 frames of 100ms = 1s = 10 sim steps');
  assert.ok(fast.steps.every((s) => s === SIM_STEP_MS), 'every step is the fixed step');

  // a frame shorter than a step advances nothing yet, and loses nothing
  const tiny = harness(); tiny.loop.start();
  for (let i = 0; i < 9; i++) tiny.frame(10);
  assert.equal(tiny.steps.length, 0);
  tiny.frame(10);
  assert.equal(tiny.steps.length, 1, '10 x 10ms is still one whole step');
});

test('dt is clamped so a hidden tab does not spiral on return', () => {
  const h = harness();
  h.loop.start();

  // gone for ten seconds
  h.frame(10_000);
  assert.equal(h.steps.length, 2, 'a 10s gap must cost 250ms of sim, not 10s (100 steps)');
  assert.equal(h.renders[0], 250, 'render sees the clamped dt too');
  assert.equal(h.minutes.length, 0, '250ms at speed 1 is a quarter of a game minute');
  assert.equal(h.clock.minuteOfDay, new GameClock().minuteOfDay, 'the world must not jump ten minutes');

  // and it stays clamped, frame after frame — no debt is carried forward
  for (let i = 0; i < 5; i++) h.frame(10_000);
  assert.equal(h.steps.length, (6 * 250) / SIM_STEP_MS,
    'six 10-second gaps must cost six clamped frames of sim, not sixty seconds of it');
  assert.ok(h.renders.every((dt) => dt <= 250), 'no render ever sees more than the clamp');

  // exactly at the clamp is not clamped
  const edge = harness(); edge.loop.start();
  edge.frame(250);
  assert.equal(edge.renders[0], 250);
  assert.equal(edge.steps.length, 2);
});

test('start is idempotent, stop really stops, and fps averages the last frames', () => {
  const h = harness();
  h.loop.start();
  const first = h.pending;
  h.loop.start();
  assert.equal(h.pending, first, 'starting twice must not run two frame pumps');

  h.frame(16);
  h.frame(16);
  h.loop.stop();
  assert.ok(h.cancelled.length > 0, 'stop must cancel the pending frame');
  const steps = h.steps.length;
  const renders = h.renders.length;
  h.frame(100);   // a frame already in flight when stop() landed
  assert.equal(h.renders.length, renders, 'a late frame after stop must do nothing');
  assert.equal(h.steps.length, steps);

  const f = harness();
  assert.equal(f.loop.fps(), 0, 'no samples yet');
  f.loop.start();
  for (let i = 0; i < 10; i++) f.frame(20);
  assert.equal(f.loop.fps(), 50, '20ms frames = 50fps');
  for (let i = 0; i < 200; i++) f.frame(10);
  assert.equal(f.loop._fpsSamples.length, 120, 'the sample window is bounded');
  assert.equal(f.loop.fps(), 100, 'the window has rolled over to the recent 10ms frames');
});
