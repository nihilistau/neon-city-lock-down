// @ts-check
// Event scheduler: pops due queued events and rolls weighted-random events on a
// cadence, respecting window/cooldown/max-per-run.
import { EVENTS } from '../../data/events.js';
import { cfg } from '../core/config.js';   // pacing knobs → config/sim.yaml (scheduler)

export class Scheduler {
  /** @param {import('../core/rng.js').RngStream} rng */
  constructor(rng) {
    this.rng = rng;
    /** @type {Record<string, number>} eventId → totalMinute last fired */
    this.lastFired = {};
    this._sinceRoll = 0;
    // set while the clock is skipped under a fade (bed scene) — nothing fires unseen
    this.hold = false;
  }

  /**
   * Per-game-minute. Returns an eventId to fire now, or null.
   * @param {any} run
   * @param {{day:number, minuteOfDay:number, phase:string, totalMinutes:number}} clock
   */
  tick(run, clock) {
    if (this.hold) return null;
    // queued events first
    const due = run.eventQueue.findIndex((e) => e.atMinute <= clock.totalMinutes);
    if (due >= 0) {
      const [ev] = run.eventQueue.splice(due, 1);
      return ev.eventId;
    }
    if (run.activeEventId) { this._sinceRoll = 0; return null; }   // one at a time; restart the roll clock post-event

    // global minimum gap after the previous event ended — the single biggest
    // fix for "events too quick". Queued/scheduled beats above bypass this.
    const lastEnd = run.lastEventEndMinute ?? -Infinity;
    if (clock.totalMinutes - lastEnd < cfg('sim.scheduler.minGapMin', 150)) return null;

    this._sinceRoll++;
    if (this._sinceRoll < cfg('sim.scheduler.rollEveryMin', 45)) return null;
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

    // per-roll fire probability, mildly threat-scaled and capped so late game
    // doesn't turn into a firehose (the MIN_GAP above is the real spacing floor).
    const fireChance = Math.min(cfg('sim.scheduler.fireChanceMax', 0.4),
      cfg('sim.scheduler.fireChanceBase', 0.18) + run.threat * cfg('sim.scheduler.fireChanceThreatScale', 0.0015));
    if (!this.rng.chance(fireChance)) return null;

    const pick = this.rng.weighted(pool, (p) => p.w);
    if (!pick) return null;
    this.lastFired[pick.def.id] = clock.totalMinutes;
    return pick.def.id;
  }

  serialize() { return { lastFired: this.lastFired }; }
  deserialize(d) { this.lastFired = d?.lastFired || {}; }
}
