// @ts-check
// Game time. Default pace: 1 real second = 1 game minute (speed 1).
// Day 1 starts at 18:00 — lockdown is declared at dusk. Pace + phase bands are
// config-tunable (config/world.yaml → clock). MINUTES_PER_DAY is structural.
import { cfg } from './config.js';

export const MINUTES_PER_DAY = 1440;

/** @typedef {'dawn'|'day'|'dusk'|'night'} DayPhase */

export class GameClock {
  constructor() {
    this.day = 1;
    this.minuteOfDay = cfg('world.clock.startHour', 18) * 60;
    this.speed = cfg('world.clock.speed', 1);   // game minutes per real second
    this._acc = 0;           // real ms accumulator
  }

  /** @returns {DayPhase} */
  get phase() {
    const h = this.minuteOfDay / 60;
    const c = cfg('world.clock', {});
    if (h >= (c.dawnStart ?? 5) && h < (c.dayStart ?? 8)) return 'dawn';
    if (h >= (c.dayStart ?? 8) && h < (c.duskStart ?? 17)) return 'day';
    if (h >= (c.duskStart ?? 17) && h < (c.nightStart ?? 20)) return 'dusk';
    return 'night';
  }

  /** total elapsed game minutes since run start */
  get totalMinutes() {
    return (this.day - 1) * MINUTES_PER_DAY + this.minuteOfDay;
  }

  /** "Day 3 — 07:45" */
  get label() {
    const h = String(Math.floor(this.minuteOfDay / 60)).padStart(2, '0');
    const m = String(this.minuteOfDay % 60).padStart(2, '0');
    return `Day ${this.day} — ${h}:${m}`;
  }

  /** 0..1 through the 24h cycle (0 = midnight) — drives sun/sky */
  get dayFraction() {
    return this.minuteOfDay / MINUTES_PER_DAY;
  }

  /**
   * Advance by real milliseconds; invokes onMinute(clock) per whole game minute.
   * @param {number} realMs
   * @param {(clock: GameClock) => void} [onMinute]
   */
  advance(realMs, onMinute) {
    this._acc += realMs * this.speed;
    while (this._acc >= 1000) {
      this._acc -= 1000;
      this.minuteOfDay++;
      if (this.minuteOfDay >= MINUTES_PER_DAY) {
        this.minuteOfDay = 0;
        this.day++;
      }
      if (onMinute) onMinute(this);
    }
  }

  /** jump forward n game minutes, firing per-minute callback (used by debug + sleep) */
  skip(minutes, onMinute) {
    for (let i = 0; i < minutes; i++) {
      this.minuteOfDay++;
      if (this.minuteOfDay >= MINUTES_PER_DAY) { this.minuteOfDay = 0; this.day++; }
      if (onMinute) onMinute(this);
    }
  }

  serialize() {
    return { day: this.day, minuteOfDay: this.minuteOfDay, speed: this.speed };
  }
  /** @param {{day:number, minuteOfDay:number, speed:number}} d */
  deserialize(d) {
    this.day = d.day; this.minuteOfDay = d.minuteOfDay; this.speed = d.speed ?? 1;
    this._acc = 0;
  }
}
