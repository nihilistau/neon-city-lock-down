// @ts-check
// Instrument voice builders — each schedules one note/hit on the music bus.
// All parameters are plain numbers so the conductor can shape timbre by mood.

/**
 * Dark pad: two detuned saws → lowpass → slow envelope.
 * @param {AudioContext} ctx @param {AudioNode} out
 * @param {number} freq @param {number} t start @param {number} dur
 * @param {{cutoff?:number, level?:number}} [o]
 */
export function pad(ctx, out, freq, t, dur, o = {}) {
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = o.cutoff ?? 900;
  f.Q.value = 0.7;
  g.connect(f); f.connect(out);
  const level = o.level ?? 0.08;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + dur * 0.3);
  g.gain.setValueAtTime(level, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0, t + dur);
  for (const det of [-4, 3]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = det;
    osc.connect(g);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
}

/** Sub bass: sine + quiet saw an octave up. */
export function bass(ctx, out, freq, t, dur, o = {}) {
  const g = ctx.createGain();
  g.connect(out);
  const level = o.level ?? 0.16;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.02);
  g.gain.setValueAtTime(level, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  const sine = ctx.createOscillator();
  sine.type = 'sine'; sine.frequency.value = freq / 2;
  sine.connect(g);
  sine.start(t); sine.stop(t + dur + 0.05);
  const saw = ctx.createOscillator();
  const sg = ctx.createGain(); sg.gain.value = 0.25;
  saw.type = 'sawtooth'; saw.frequency.value = freq;
  saw.connect(sg); sg.connect(g);
  saw.start(t); saw.stop(t + dur + 0.05);
}

/** Arp pluck: square through bandpass with fast decay. */
export function arp(ctx, out, freq, t, o = {}) {
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq * 2;
  f.Q.value = 2.5;
  g.connect(f); f.connect(out);
  const level = o.level ?? 0.07;
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + (o.decay ?? 0.28));
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = freq;
  osc.connect(g);
  osc.start(t); osc.stop(t + 0.5);
}

/** Kick: sine with fast pitch envelope. */
export function kick(ctx, out, t, o = {}) {
  const g = ctx.createGain();
  g.connect(out);
  g.gain.setValueAtTime(o.level ?? 0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.12);
  osc.connect(g);
  osc.start(t); osc.stop(t + 0.3);
}

/** Snare: noise burst through bandpass + body tone. */
export function snare(ctx, out, t, o = {}) {
  const dur = 0.18;
  const buf = noiseBuffer(ctx, dur);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(o.level ?? 0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t);
}

/** Hat: short highpassed noise tick. */
export function hat(ctx, out, t, o = {}) {
  const dur = 0.05;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur);
  const f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = 7500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(o.level ?? 0.08, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t);
}

/** shared noise buffer cache */
const noiseCache = new Map();
export function noiseBuffer(ctx, dur) {
  const key = Math.round(dur * 1000);
  let buf = noiseCache.get(key);
  if (buf) return buf;
  buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseCache.set(key, buf);
  return buf;
}
