// @ts-check
// Pure helpers for the environment + exterior pass (lighting.js, zoneBuilder.js,
// rain.js). No three.js, no DOM — so the timing and layout rules are unit-tested.

const smooth = (x) => x * x * (3 - 2 * x);

/**
 * The environment-map crossfade. PMREM textures cannot be blended, so a preset
 * change dips `scene.environmentIntensity` to 0 over the first half, swaps the
 * map at the bottom (where the swap is invisible), and rises over the second.
 * @param {number} t seconds since the dip began
 * @param {number} dur total dip length, seconds
 * @returns {{k:number, swap:boolean, done:boolean}} k multiplies the target intensity
 */
export function dipAndSwap(t, dur) {
  if (!(dur > 0) || t >= dur) return { k: 1, swap: true, done: true };
  const half = dur / 2;
  if (t < half) return { k: 1 - smooth(Math.max(0, t) / half), swap: false, done: false };
  return { k: smooth((t - half) / half), swap: true, done: false };
}

/**
 * Aim the dip at a new preset. Restarting it from t = 0 (what a preset change
 * mid-dip used to do) snapped a rising intensity straight back to full — the
 * very pop the dip exists to hide. Still descending: keep the time, just swap
 * to the new map at the bottom. Already swapped and rising: mirror the time
 * into the descending half (smoothstep is symmetric, so k is unchanged) and
 * swap again at the bottom.
 * @param {{t:number, dur:number, id:string, swapped:boolean}|null} dip
 * @param {string} id the preset to swap in
 * @param {number} dur dip length for a fresh dip, seconds
 * @returns {{t:number, dur:number, id:string, swapped:boolean}}
 */
export function retargetDip(dip, id, dur) {
  if (!dip) return { t: 0, dur, id, swapped: false };
  if (!dip.swapped) return { t: dip.t, dur: dip.dur, id, swapped: false };
  return { t: Math.max(0, dip.dur - dip.t), dur: dip.dur, id, swapped: false };
}

/** Where the HDRI soft clamp starts bending (linear radiance, after the gain). */
export const HDRI_KNEE = 1.0;

/**
 * Soft-knee highlight clamp for a texel's brightest channel. The old hard cap
 * (min(1, cap / peak)) flattened every lamp to one value with a visible kink
 * where the ramp met it; this is the identity below the knee, leaves it at
 * slope 1 (no kink), and approaches `cap` asymptotically, so lamp cores keep
 * their falloff but never exceed the cap. `c *= softKnee(peak) / peak`.
 * GLSL twin: SOFT_KNEE_GLSL.
 * @param {number} p the texel's max channel @param {number} knee @param {number} cap (> knee)
 */
export function softKnee(p, knee, cap) {
  if (p <= knee) return p;
  const span = cap - knee;
  return knee + span * (1 - Math.exp(-(p - knee) / span));
}

/** softKnee() for shaders: `vec3 softKneeClamp(vec3 c, float knee, float cap)`. */
export const SOFT_KNEE_GLSL = /* glsl */ `
vec3 softKneeClamp(vec3 c, float knee, float cap) {
  float p = max(max(c.r, c.g), max(c.b, 1e-6));
  if (p <= knee) return c;
  float span = cap - knee;
  return c * ((knee + span * (1.0 - exp(-(p - knee) / span))) / p);
}`;

/**
 * Per-tower offsets into the lit-window texture, so no two neighbouring towers
 * show the same windows. Snapped to 1/8 — the texture's window grid — so every
 * offset lands a whole window, never half of one.
 * @param {number} count @param {{next: () => number}} rng
 */
export function windowOffsets(count, rng) {
  const out = new Float32Array(count * 2);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(rng.next() * 8) / 8;
  return out;
}

/**
 * Initial drop positions, uniformly inside `vol`. The shader wraps them, so
 * this is the only time rain touches the CPU.
 * @param {number} count
 * @param {{x:[number,number], y:[number,number], z:[number,number]}} vol
 * @param {{next: () => number}} rng
 */
export function rainLayout(count, vol, rng) {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] = vol.x[0] + rng.next() * (vol.x[1] - vol.x[0]);
    out[i * 3 + 1] = vol.y[0] + rng.next() * (vol.y[1] - vol.y[0]);
    out[i * 3 + 2] = vol.z[0] + rng.next() * (vol.z[1] - vol.z[0]);
  }
  return out;
}

/** Streaks at density 1 (the high preset). */
export const RAIN_BASE = 900;
/** Allocated once per volume; ultra's 1.4 fits, anything denser clamps. */
export const RAIN_MAX = 1800;

/** @param {number} density preset rain density (0 = dry) */
export function rainCount(density) {
  if (!(density > 0)) return 0;
  return Math.min(RAIN_MAX, Math.round(RAIN_BASE * density));
}
