// @ts-check
// Generative music conductor. Mood params (tension/warmth/energy/intimacy 0..1)
// select mode/tempo/active layers; a lookahead scheduler ("tale of two clocks":
// 25ms tick scheduling 120ms ahead on the audio clock) keeps timing sample-
// accurate; transitions land on bar boundaries so mood changes feel musical.
import { SCALES, nextDegree, chordOn, mtof, wander } from './theory.js';
import { pad, bass, arp, kick, snare, hat } from './instruments.js';

const ROOT = 45; // A2 — noir home key

export class Conductor {
  /** @param {import('../engine.js').AudioEngine} engine @param {import('../../core/rng.js').RngStream} rng */
  constructor(engine, rng) {
    this.engine = engine;
    this.rng = rng;
    this.mood = { tension: 0.25, warmth: 0.4, energy: 0.3, intimacy: 0 };
    this._target = { ...this.mood };
    this.playing = false;
    this._timer = 0;
    this._nextNoteTime = 0;
    this._step = 0;          // 16th-note counter
    this._degree = 0;
    this._arpIdx = 7;
    this._chord = chordOn(SCALES.aeolian, 0);
  }

  get bpm() { return 72 + this.mood.energy * 36; }
  get scale() {
    if (this.mood.tension > 0.6) return SCALES.phrygian;
    if (this.mood.intimacy > 0.5) return SCALES.lydian;
    if (this.mood.warmth > 0.55) return SCALES.dorian;
    return SCALES.aeolian;
  }

  /** Smoothly retarget the mood; applied at bar boundaries. */
  setMood(partial) {
    Object.assign(this._target, partial);
  }

  start() {
    if (this.playing || !this.engine.ctx) return;
    this.playing = true;
    this._nextNoteTime = this.engine.now + 0.1;
    this._timer = setInterval(() => this._schedule(), 25);
  }

  stop() {
    this.playing = false;
    clearInterval(this._timer);
  }

  _schedule() {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    while (this._nextNoteTime < ctx.currentTime + 0.12) {
      this._playStep(this._step, this._nextNoteTime);
      const secPer16 = 60 / this.bpm / 4;
      this._nextNoteTime += secPer16;
      this._step = (this._step + 1) % 64; // 4 bars of 16ths
    }
  }

  /** @param {number} step @param {number} t */
  _playStep(step, t) {
    const out = this.engine.bus('music');
    const ctx = this.engine.ctx;
    const m = this.mood;
    const scale = this.scale;
    const inBar = step % 16;

    // bar boundary: lerp mood toward target, walk the chord
    if (inBar === 0) {
      for (const k of Object.keys(this.mood)) {
        this.mood[k] += (this._target[k] - this.mood[k]) * 0.5;
      }
      this._degree = nextDegree(this._degree, () => this.rng.next());
      this._chord = chordOn(scale, this._degree);
      // pad chord for the bar
      const barDur = (60 / this.bpm) * 4;
      for (const semi of this._chord) {
        pad(ctx, out, mtof(ROOT + 12 + semi), t, barDur * 1.02, {
          cutoff: 500 + m.warmth * 900 + m.tension * 400,
          level: 0.05 + m.warmth * 0.04,
        });
      }
    }

    // bass on beats 1 and the and-of-3 (pushes at higher energy)
    if (inBar === 0 || (inBar === 10 && m.energy > 0.35)) {
      bass(ctx, out, mtof(ROOT + this._chord[0]), t, (60 / this.bpm) * 1.5, {
        level: 0.13 + m.energy * 0.06,
      });
    }

    // arp: gate probability scales with energy; wanders the scale
    if (m.energy > 0.15 && this.rng.chance(0.25 + m.energy * 0.5)) {
      this._arpIdx = wander(scale, this._arpIdx, () => this.rng.next());
      const oct = Math.floor(this._arpIdx / scale.length);
      const semi = scale[this._arpIdx % scale.length] + oct * 12;
      arp(ctx, out, mtof(ROOT + 24 + semi), t, {
        level: 0.04 + m.energy * 0.04,
        decay: 0.2 + m.intimacy * 0.25,
      });
    }

    // drums fade in with energy/tension
    const drumLevel = Math.max(0, m.energy - 0.25) + m.tension * 0.3;
    if (drumLevel > 0.1) {
      if (inBar === 0 || inBar === 8) kick(ctx, out, t, { level: 0.28 * drumLevel + 0.1 });
      if (inBar === 4 || inBar === 12) snare(ctx, out, t, { level: 0.16 * drumLevel });
      if (inBar % 2 === 0) hat(ctx, out, t, { level: 0.05 * drumLevel + 0.01 });
    }
  }
}
