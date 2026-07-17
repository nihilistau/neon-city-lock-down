// @ts-check
// VOX — the tower AI's procedural voice. Deliberately synthetic: a sawtooth
// carrier through swept formant bandpasses, ring-mod shimmer, and a syllable
// gate derived from the text. Emits 'vox.speaking' amplitude for monitors.
// Radio chatter reuses the family with band-limit + static.
import { emit } from '../core/bus.js';
import { playSfx } from './sfx/synthKit.js';

/** rough syllable split for gating */
function syllables(text) {
  return text.toLowerCase().replace(/[^a-z ]/g, '')
    .split(/\s+/).flatMap((w) => w.match(/[aeiouy]+[^aeiouy]*/g) || [w])
    .filter(Boolean);
}

export class VoxVoice {
  /** @param {import('./engine.js').AudioEngine} engine */
  constructor(engine) {
    this.engine = engine;
    this.speaking = false;
  }

  /**
   * Speak a line as VOX. Returns total duration (sec).
   * @param {string} text
   * @param {{pitch?:number, rate?:number, radio?:boolean}} [o]
   */
  say(text, o = {}) {
    const ctx = this.engine.ctx;
    if (!ctx) return 0;
    const out = this.engine.bus('voice');
    const t0 = this.engine.now + 0.05;
    const sylls = syllables(text);
    const rate = o.rate ?? 1;
    const sylDur = 0.135 / rate;
    const gapDur = 0.045 / rate;
    const basePitch = o.pitch ?? 92;

    // shared chain: carrier → formants → ring mod → (radio band) → out
    const carrier = ctx.createOscillator();
    carrier.type = 'sawtooth';
    const carrierG = ctx.createGain();
    carrierG.gain.value = 0;
    carrier.connect(carrierG);

    const formants = [700, 1220, 2600].map((f, i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 7 - i * 1.5;
      const g = ctx.createGain();
      g.gain.value = [0.9, 0.55, 0.3][i];
      carrierG.connect(bp); bp.connect(g);
      return { bp, g };
    });

    const mix = ctx.createGain();
    for (const f of formants) f.g.connect(mix);

    // ring-mod shimmer
    const ring = ctx.createGain();
    const ringOsc = ctx.createOscillator();
    ringOsc.frequency.value = 210;
    const ringDepth = ctx.createGain();
    ringDepth.gain.value = 0.35;
    ringOsc.connect(ringDepth);
    ringDepth.connect(ring.gain);
    ring.gain.value = 0.75;
    mix.connect(ring);

    let tail = ring;
    if (o.radio) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass'; band.frequency.value = 1700; band.Q.value = 0.9;
      ring.connect(band);
      tail = band;
    }
    const master = ctx.createGain();
    master.gain.value = o.radio ? 0.5 : 0.7;
    tail.connect(master); master.connect(out);

    // schedule syllables
    let t = t0;
    const vowels = ['a', 'e', 'i', 'o', 'u'];
    for (const syl of sylls) {
      const v = vowels.find((x) => syl.includes(x)) || 'e';
      const fset = { a: [800, 1150], e: [500, 1750], i: [320, 2300], o: [500, 900], u: [330, 800] }[v];
      formants[0].bp.frequency.setTargetAtTime(fset[0], t, 0.02);
      formants[1].bp.frequency.setTargetAtTime(fset[1], t, 0.02);
      carrier.frequency.setTargetAtTime(basePitch * (0.96 + Math.random() * 0.08), t, 0.03);
      carrierG.gain.setTargetAtTime(0.5, t, 0.015);
      carrierG.gain.setTargetAtTime(0.0001, t + sylDur * 0.8, 0.02);
      t += sylDur + (syl.endsWith(' ') ? gapDur * 2 : gapDur);
      if (/[.,;:!?]/.test(syl)) t += gapDur * 3;
    }
    const dur = t - t0 + 0.3;
    carrier.start(t0);
    ringOsc.start(t0);
    carrier.stop(t0 + dur);
    ringOsc.stop(t0 + dur);

    if (o.radio) playSfx(this.engine, 'static_burst');
    this.speaking = true;
    emit('vox.speaking', { text, dur });
    setTimeout(() => { this.speaking = false; emit('vox.done', {}); }, dur * 1000);
    return dur;
  }
}
