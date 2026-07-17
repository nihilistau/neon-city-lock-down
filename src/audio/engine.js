// @ts-check
// WebAudio core: context + bus graph (music/ambience/sfx/voice/ui → compressor
// → destination), volume control from settings, voice ducking.
import { settings } from '../core/settings.js';
import { on } from '../core/bus.js';

export class AudioEngine {
  constructor() {
    /** @type {AudioContext|null} created on unlock() (autoplay policy) */
    this.ctx = null;
    this.buses = {};
    this._duck = 1;
  }

  /** Call from a user gesture (the 18+ gate click). Idempotent. */
  unlock() {
    if (this.ctx) { this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    const ctx = this.ctx;

    this.master = ctx.createDynamicsCompressor();
    this.master.threshold.value = -14;
    this.master.knee.value = 22;
    this.master.ratio.value = 5;
    this.masterGain = ctx.createGain();
    this.masterGain.connect(this.master);
    this.master.connect(ctx.destination);

    for (const name of ['music', 'ambience', 'sfx', 'voice', 'ui']) {
      const g = ctx.createGain();
      g.connect(this.masterGain);
      this.buses[name] = g;
    }
    this.applyVolumes();
    on('settings.changed', () => this.applyVolumes());
  }

  applyVolumes() {
    if (!this.ctx) return;
    const v = settings.volumes;
    this.masterGain.gain.value = v.master;
    for (const name of Object.keys(this.buses)) {
      const duck = (name === 'music' && this._duck < 1) ? this._duck
        : (name === 'ambience' && this._duck < 1) ? (0.6 + this._duck * 0.4) : 1;
      this.buses[name].gain.value = (v[name] ?? 1) * duck;
    }
  }

  /** @param {'music'|'ambience'|'sfx'|'voice'|'ui'} name */
  bus(name) { return this.buses[name]; }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  /** Duck music/ambience while a voice line plays. */
  duckStart() {
    if (!this.ctx) return;
    this._duck = 0.35;
    this._rampBus('music', settings.volumes.music * 0.35, 0.15);
    this._rampBus('ambience', settings.volumes.ambience * 0.6, 0.15);
  }
  duckEnd() {
    if (!this.ctx) return;
    this._duck = 1;
    this._rampBus('music', settings.volumes.music, 0.4);
    this._rampBus('ambience', settings.volumes.ambience, 0.4);
  }
  _rampBus(name, target, sec) {
    const g = this.buses[name].gain;
    g.cancelScheduledValues(this.now);
    g.setValueAtTime(g.value, this.now);
    g.linearRampToValueAtTime(target, this.now + sec);
  }
}

export const audio = new AudioEngine();
