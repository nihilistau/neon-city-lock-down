// @ts-check
// External threat pressure 0..100: baseline climbs by day with noisy waves,
// events spike it, quiet hours bleed it off. Drives event weights, ambience
// riot loudness, and the music conductor's tension. Tuning: config/sim.yaml (threat).
import { cfg } from '../core/config.js';

/**
 * Per-game-minute update.
 * @param {any} run @param {{day:number, minuteOfDay:number, phase:string}} clock
 * @param {import('../core/rng.js').RngStream} rng
 */
export function threatTick(run, clock, rng) {
  const t = cfg('sim.threat', {});
  const dayBase = Math.min(t.dayBaseCap ?? 60, (t.dayBaseStart ?? 12) + clock.day * (t.dayBasePerDay ?? 7));
  const nightBoost = clock.phase === 'night' ? (t.nightBoost ?? 8) : clock.phase === 'dusk' ? (t.duskBoost ?? 5) : 0;
  const wave = Math.sin((clock.minuteOfDay / 1440) * Math.PI * 2 + clock.day) * (t.waveAmp ?? 6);
  const target = dayBase + nightBoost + wave + (run.flags.threatSpike || 0);

  // ease toward target; spikes decay
  run.threat += (target - run.threat) * (t.ease ?? 0.004);
  if (run.flags.threatSpike > 0) run.flags.threatSpike *= (t.spikeDecay ?? 0.9985);
  if (rng.chance(t.flareChance ?? 0.002)) run.threat += rng.range(t.flareMin ?? 1, t.flareMax ?? 4); // random flare
  run.threat = Math.max(0, Math.min(100, run.threat));
}

/** @param {any} run @param {number} amount */
export function spikeThreat(run, amount) {
  run.flags.threatSpike = (run.flags.threatSpike || 0) + amount;
}
