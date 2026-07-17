// @ts-check
// Main loop: rAF render + fixed-step sim accumulator + game-minute clock.
// Pause reasons form a set — sim/clock halt while any reason is active
// (cutscene, menu, death, chat-modal); rendering always continues.
import { emit } from './bus.js';

export const SIM_STEP_MS = 100;

export class Loop {
  /**
   * @param {{
   *   clock: import('./clock.js').GameClock,
   *   render: (dtMs:number) => void,
   *   simStep?: (stepMs:number) => void,
   *   onMinute?: (clock: import('./clock.js').GameClock) => void,
   * }} opts
   */
  constructor(opts) {
    this.clock = opts.clock;
    this.render = opts.render;
    this.simStep = opts.simStep || (() => {});
    this.onMinute = opts.onMinute || (() => {});
    /** @type {Set<string>} */
    this.pauseReasons = new Set();
    this._last = 0;
    this._simAcc = 0;
    this._running = false;
    this._raf = 0;
    this._fpsSamples = [];
  }

  get paused() { return this.pauseReasons.size > 0; }

  /** @param {string} reason */
  pause(reason) {
    this.pauseReasons.add(reason);
    emit('loop.pause', { reason, paused: true });
  }
  /** @param {string} reason */
  resume(reason) {
    this.pauseReasons.delete(reason);
    emit('loop.pause', { reason, paused: this.paused });
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    const tick = (now) => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(tick);
      let dt = now - this._last;
      this._last = now;
      if (dt > 250) dt = 250; // tab was hidden — don't spiral

      if (!this.paused) {
        this._simAcc += dt;
        while (this._simAcc >= SIM_STEP_MS) {
          this._simAcc -= SIM_STEP_MS;
          this.simStep(SIM_STEP_MS);
        }
        this.clock.advance(dt, this.onMinute);
      }

      this.render(dt);

      this._fpsSamples.push(dt);
      if (this._fpsSamples.length > 120) this._fpsSamples.shift();
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }

  /** rolling average fps over the last ~2s */
  fps() {
    if (!this._fpsSamples.length) return 0;
    const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length;
    return Math.round(1000 / avg);
  }
}
