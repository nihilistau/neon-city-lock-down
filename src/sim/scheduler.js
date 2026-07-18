// @ts-check
// Event scheduler: pops due queued events and rolls weighted-random events on a
// cadence, respecting window/cooldown/max-per-run.
import { EVENTS } from '../../data/events.js';

const ROLL_EVERY_MIN = 45;    // roll for a random event ~every 45 game-min
const MIN_GAP_MIN = 150;      // hard floor between the END of one event and the next (~2.5 real min)

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
    if (run.activeEventId) { this._sinceRoll = 0; return null; }   // one at a time; restart the roll clock post-event

    // global minimum gap after the previous event ended — the single biggest
    // fix for "events too quick". Queued/scheduled beats above bypass this.
    const lastEnd = run.lastEventEndMinute ?? -Infinity;
    if (clock.totalMinutes - lastEnd < MIN_GAP_MIN) return null;

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

    // per-roll fire probability, mildly threat-scaled and capped so late game
    // doesn't turn into a firehose (the MIN_GAP above is the real spacing floor).
    const fireChance = Math.min(0.4, 0.18 + run.threat * 0.0015);
    if (!this.rng.chance(fireChance)) return null;

    const pick = this.rng.weighted(pool, (p) => p.w);
    if (!pick) return null;
    this.lastFired[pick.def.id] = clock.totalMinutes;
    return pick.def.id;
  }

  serialize() { return { lastFired: this.lastFired }; }
  deserialize(d) { this.lastFired = d?.lastFired || {}; }
}
