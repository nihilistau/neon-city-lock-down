// @ts-check
// Procedural speech fallback for human characters. Formant-gated syllables
// (same family as VOX, warmer, per-character pitch). Used when no baked WAV
// exists — the Voxtral sidecar is optional and currently unreliable.
import { emit } from '../core/bus.js';

/** @type {Record<string, {pitch:number, rate:number, formants:[number,number,number], roughness:number}>} */
export const TALK_PROFILES = {
  lola:   { pitch: 148, rate: 1.02, formants: [620, 1380, 2650], roughness: 0.22 },
  aria:   { pitch: 215, rate: 1.10, formants: [540, 1750, 3100], roughness: 0.08 },
  kai:    { pitch: 116, rate: 0.94, formants: [580, 1180, 2350], roughness: 0.12 },
  player: { pitch: 168, rate: 1.00, formants: [640, 1480, 2580], roughness: 0.10 },
  vox:    { pitch: 92,  rate: 1.00, formants: [700, 1220, 2600], roughness: 0.35 },
};

/** rough syllable split for gating */
export function syllables(text) {
  return String(text || '').toLowerCase().replace(/[^a-z ]/g, '')
    .split(/\s+/).flatMap((w) => w.match(/[aeiouy]+[^aeiouy]*/g) || [w])
    .filter(Boolean);
}

/**
 * Speak `text` with a character profile. Returns duration in seconds.
 * Drives `face.setTalk` if a face rig is passed.
 * @param {import('./engine.js').AudioEngine} engine
 * @param {{pitch:number, rate:number, formants:[number,number,number], roughness:number}} profile
 * @param {string} text
 * @param {{setTalk?:(n:number)=>void}|null} [face]
 * @param {string} [charId]
 */
export function sayTalk(engine, profile, text, face = null, charId = '') {
  const ctx = engine.ctx;
  if (!ctx) return 0;
  const out = engine.bus('voice');
  const t0 = engine.now + 0.04;
  const sylls = syllables(text);
  const rate = profile.rate || 1;
  const sylDur = 0.118 / rate;
  const gapDur = 0.038 / rate;
  const basePitch = profile.pitch;

  const carrier = ctx.createOscillator();
  carrier.type = profile.roughness > 0.18 ? 'sawtooth' : 'triangle';
  const carrierG = ctx.createGain();
  carrierG.gain.value = 0;
  carrier.connect(carrierG);

  const formants = profile.formants.map((f, i) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 6.5 - i * 1.4;
    const g = ctx.createGain();
    g.gain.value = [0.85, 0.5, 0.28][i];
    carrierG.connect(bp); bp.connect(g);
    return { bp, g };
  });

  const mix = ctx.createGain();
  for (const f of formants) f.g.connect(mix);

  // light breath noise under the carrier so it doesn't read as a pure tone
  const noise = ctx.createBufferSource();
  const nLen = Math.max(0.4, sylls.length * (sylDur + gapDur) + 0.4);
  const nb = ctx.createBuffer(1, Math.ceil(nLen * ctx.sampleRate), ctx.sampleRate);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.15;
  noise.buffer = nb;
  const nf = ctx.createBiquadFilter();
  nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.7;
  const ng = ctx.createGain();
  ng.gain.value = 0.08 + profile.roughness * 0.12;
  noise.connect(nf); nf.connect(ng); ng.connect(mix);

  const master = ctx.createGain();
  master.gain.value = 0.55;
  mix.connect(master); master.connect(out);

  const vowels = ['a', 'e', 'i', 'o', 'u'];
  const fsets = { a: [800, 1150], e: [500, 1750], i: [320, 2300], o: [500, 900], u: [330, 800] };
  let t = t0;
  for (const syl of sylls) {
    const v = vowels.find((x) => syl.includes(x)) || 'e';
    const fset = fsets[v];
    formants[0].bp.frequency.setTargetAtTime(fset[0], t, 0.018);
    formants[1].bp.frequency.setTargetAtTime(fset[1], t, 0.018);
    carrier.frequency.setTargetAtTime(basePitch * (0.97 + Math.random() * 0.06), t, 0.025);
    carrierG.gain.setTargetAtTime(0.48, t, 0.012);
    carrierG.gain.setTargetAtTime(0.0001, t + sylDur * 0.78, 0.018);
    t += sylDur + gapDur;
  }
  const dur = Math.max(0.35, t - t0 + 0.18);
  carrier.start(t0);
  noise.start(t0);
  carrier.stop(t0 + dur);
  try { noise.stop(t0 + dur); } catch { /* buffer length may clip */ }

  if (face?.setTalk) {
    const start = performance.now();
    emit('voice.speaking', { id: charId, dur, procedural: true });
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      if (elapsed >= dur) { face.setTalk(0); emit('voice.done', { id: charId }); return; }
      const gate = Math.abs(Math.sin(elapsed * (Math.PI / sylDur)));
      face.setTalk(0.2 + 0.55 * gate);
      requestAnimationFrame(tick);
    };
    tick();
  }
  return dur;
}
