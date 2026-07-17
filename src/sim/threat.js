// @ts-check
// External threat pressure 0..100: baseline climbs by day with noisy waves,
// events spike it, quiet hours bleed it off. Drives event weights, ambience
// riot loudness, and the music conductor's tension.

/**
 * Per-game-minute update.
 * @param {any} run @param {{day:number, minuteOfDay:number, phase:string}} clock
 * @param {import('../core/rng.js').RngStream} rng
 */
export function threatTick(run, clock, rng) {
  const dayBase = Math.min(60, 12 + clock.day * 7);
  const nightBoost = clock.phase === 'night' ? 8 : clock.phase === 'dusk' ? 5 : 0;
  const wave = Math.sin((clock.minuteOfDay / 1440) * Math.PI * 2 + clock.day) * 6;
  const target = dayBase + nightBoost + wave + (run.flags.threatSpike || 0);

  // ease toward target; spikes decay
  run.threat += (target - run.threat) * 0.004;
  if (run.flags.threatSpike > 0) run.flags.threatSpike *= 0.9985;
  if (rng.chance(0.002)) run.threat += rng.range(1, 4); // random flare
  run.threat = Math.max(0, Math.min(100, run.threat));
}

/** @param {any} run @param {number} amount */
export function spikeThreat(run, amount) {
  run.flags.threatSpike = (run.flags.threatSpike || 0) + amount;
}
