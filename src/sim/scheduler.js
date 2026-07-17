// @ts-check
// Event scheduler: pops due queued events and rolls weighted-random events on a
// cadence, respecting window/cooldown/max-per-run.
import { EVENTS } from '../../data/events.js';

const ROLL_EVERY_MIN = 30;

export class Scheduler {
  /** @param {import('../core/rng.js').RngStream} rng */
  constructor(rng) {
    this.rng = rng;
    /** @type {Record<string, number>} eventId → totalMinute last fired */
    this.lastFired = {};
    this._sinceRoll = 0;
  }

  /**
   * Per-game-minute. Returns an eventId to fire now, or null.
   * @param {any} run
   * @param {{day:number, minuteOfDay:number, phase:string, totalMinutes:number}} clock
   */
  tick(run, clock) {
    // queued events first
    const due = run.eventQueue.findIndex((e) => e.atMinute <= clock.totalMinutes);
    if (due >= 0) {
      const [ev] = run.eventQueue.splice(due, 1);
      return ev.eventId;
    }
    if (run.activeEventId) return null;   // one at a time

    this._sinceRoll++;
    if (this._sinceRoll < ROLL_EVERY_MIN) return null;
    this._sinceRoll = 0;

    // build eligible pool
    const pool = [];
    for (const def of Object.values(EVENTS)) {
      if (def.window?.minDay && clock.day < def.window.minDay) continue;
      if (def.window?.phase && !def.window.phase.includes(clock.phase)) continue;
      const fired = run.eventsFired.filter((id) => id === def.id).length;
      if (def.maxPerRun && fired >= def.maxPerRun) continue;
      const last = this.lastFired[def.id] ?? -Infinity;
      if (def.cooldownMin && clock.totalMinutes - last < def.cooldownMin) continue;
      const w = def.weight(run, clock);
      if (w > 0) pool.push({ def, w });
    }
    if (!pool.length) return null;

    // global pacing: roughly one random event per ~2.5 game-hours, scaled by threat
    const fireChance = 0.22 + run.threat * 0.003;
    if (!this.rng.chance(fireChance)) return null;

    const pick = this.rng.weighted(pool, (p) => p.w);
    if (!pick) return null;
    this.lastFired[pick.def.id] = clock.totalMinutes;
    return pick.def.id;
  }

  serialize() { return { lastFired: this.lastFired }; }
  deserialize(d) { this.lastFired = d?.lastFired || {}; }
}
