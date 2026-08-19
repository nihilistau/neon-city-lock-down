// @ts-check
// Tower-system + flag consequences on the threat curve. Before v0.3.0 the
// `cameras` system, `flags.ceasefire` and `flags.jammerActive` were all written
// and read by nothing; these assert they now move the threat target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRunState } from '../../src/sim/world.js';
import { threatTick } from '../../src/sim/threat.js';

const noFlareRng = { chance: () => false, range: () => 0 };
/** a fixed mid-run clock */
const clock = { day: 3, minuteOfDay: 12 * 60, phase: 'day', totalMinutes: 2 * 1440 + 12 * 60 };

/** Ease threatTick to convergence, where run.threat ≈ the target it eases toward. */
function converge(mutate) {
  const run = newRunState(1);
  mutate(run);
  for (let i = 0; i < 8000; i++) threatTick(run, clock, noFlareRng);
  return run.threat;
}

test('cameras offline raises the threat target (VOX is blind)', () => {
  const base = converge(() => {});
  const blind = converge((run) => { run.systems.cameras.online = false; });
  assert.ok(blind > base + 3, `blind ${blind.toFixed(1)} should exceed base ${base.toFixed(1)}`);
});

test('a live signal jammer suppresses threat, and expires', () => {
  const base = converge(() => {});
  const jammed = converge((run) => { run.flags.jammerActive = clock.totalMinutes - 10; }); // 10 min ago
  assert.ok(jammed < base - 3, `jammed ${jammed.toFixed(1)} should be below base ${base.toFixed(1)}`);
  // stamped long ago → past jammerDurationMin (240) → no relief
  const stale = converge((run) => { run.flags.jammerActive = clock.totalMinutes - 600; });
  assert.ok(Math.abs(stale - base) < 0.5, `stale jammer ${stale.toFixed(1)} should match base ${base.toFixed(1)}`);
});

test('a brokered ceasefire eases the baseline', () => {
  const base = converge(() => {});
  const truce = converge((run) => { run.flags.ceasefire = true; });
  assert.ok(truce < base - 3, `ceasefire ${truce.toFixed(1)} should be below base ${base.toFixed(1)}`);
});

test('threat stays clamped to 0..100 under every consequence', () => {
  const hi = converge((run) => { run.systems.cameras.online = false; run.flags.threatSpike = 999; });
  assert.ok(hi <= 100 && hi >= 0);
  const lo = converge((run) => { run.flags.ceasefire = true; run.flags.jammerActive = clock.totalMinutes; });
  assert.ok(lo >= 0 && lo <= 100);
});
