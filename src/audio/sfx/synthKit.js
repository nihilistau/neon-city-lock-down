// @ts-check
// Named parametric SFX recipes, synthesized per call on the sfx bus.
import { noiseBuffer } from '../music/instruments.js';

/** @type {Record<string, (ctx:AudioContext, out:AudioNode, t:number)=>void>} */
const RECIPES = {
  ui_click(ctx, out, t) {
    blip(ctx, out, t, 1600, 0.05, 0.08);
  },
  ui_confirm(ctx, out, t) {
    blip(ctx, out, t, 900, 0.06, 0.09);
    blip(ctx, out, t + 0.07, 1400, 0.07, 0.09);
  },
  ui_deny(ctx, out, t) {
    blip(ctx, out, t, 320, 0.09, 0.1, 'square');
    blip(ctx, out, t + 0.09, 240, 0.12, 0.1, 'square');
  },
  alarm_soft(ctx, out, t) {
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 720 + i * 6;
      g.gain.setValueAtTime(0, t);
      for (let p = 0; p < 3; p++) {
        g.gain.linearRampToValueAtTime(0.05, t + p * 0.5 + 0.08);
        g.gain.linearRampToValueAtTime(0.004, t + p * 0.5 + 0.42);
      }
      g.gain.linearRampToValueAtTime(0, t + 1.6);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 1.65);
    }
  },
  alarm_hard(ctx, out, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(600, t);
    for (let p = 0; p < 4; p++) {
      o.frequency.linearRampToValueAtTime(900, t + p * 0.4 + 0.2);
      o.frequency.linearRampToValueAtTime(600, t + p * 0.4 + 0.4);
    }
    g.gain.setValueAtTime(0.09, t);
    g.gain.setValueAtTime(0.09, t + 1.5);
    g.gain.linearRampToValueAtTime(0, t + 1.7);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 1.75);
  },
  door_servo(ctx, out, t) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t);
    o.frequency.linearRampToValueAtTime(150, t + 0.5);
    f.type = 'lowpass'; f.frequency.value = 500;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.06);
    g.gain.setValueAtTime(0.08, t + 0.42);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(f); f.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.6);
    // latch clunk
    blip(ctx, out, t + 0.5, 180, 0.08, 0.12, 'sine');
  },
  glass_clink(ctx, out, t) {
    for (const [freq, dt] of [[2100, 0], [3150, 0.012]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq * (0.98 + Math.random() * 0.04);
      g.gain.setValueAtTime(0.09, t + dt);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dt + 0.35);
      o.connect(g); g.connect(out);
      o.start(t + dt); o.stop(t + dt + 0.4);
    }
  },
  pour_drink(ctx, out, t) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 1.2);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(1500, t + 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.15);
    g.gain.setValueAtTime(0.05, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t);
  },
  gunshot(ctx, out, t) {
    // noise crack + low thump + short comb tail
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 0.3);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(6000, t);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    og.gain.setValueAtTime(0.45, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(og); og.connect(out);
    o.start(t); o.stop(t + 0.25);
  },
  thump(ctx, out, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.3);
  },
  elevator_ding(ctx, out, t) {
    for (const [freq, dt, lvl] of [[830, 0, 0.1], [1245, 0.18, 0.08]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(lvl, t + dt);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dt + 0.9);
      o.connect(g); g.connect(out);
      o.start(t + dt); o.stop(t + dt + 1);
    }
  },
  static_burst(ctx, out, t) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 0.4);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.linearRampToValueAtTime(0.0, t + 0.4);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t);
  },
};

function blip(ctx, out, t, freq, dur, level, type = 'sine') {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = /** @type {OscillatorType} */ (type);
  o.frequency.value = freq;
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + dur + 0.02);
}

/**
 * @param {import('../engine.js').AudioEngine} engine
 * @param {string} id recipe name
 */
export function playSfx(engine, id) {
  if (!engine.ctx) return;
  const recipe = RECIPES[id];
  if (!recipe) { console.warn('[sfx] unknown recipe', id); return; }
  recipe(engine.ctx, engine.bus('sfx'), engine.now + 0.01);
}

export const SFX_IDS = Object.keys(RECIPES);
