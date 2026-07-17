// @ts-check
// Fallback ladders (per-character, tone-keyed deflections) + bystander
// interjection selection. This is what keeps free-typed chat from dead-ending.

import { compileLine } from './stageDirections.js';

/** @type {Map<string, any>} charId → { tone → [compiled lines] } */
const fallbacksByChar = new Map();

/**
 * @param {string} charId
 * @param {Record<string, string[]>} toneMap  tone → array of raw line texts
 */
export function registerFallbacks(charId, toneMap) {
  /** @type {Record<string, any[]>} */
  const compiled = {};
  for (const [tone, lines] of Object.entries(toneMap)) {
    compiled[tone] = lines.map((t) => compileLine(t));
  }
  fallbacksByChar.set(charId, compiled);
}

/**
 * Pick a fallback line for a character given the dominant tone.
 * @param {string} charId
 * @param {string} tone
 * @param {import('../core/rng.js').RngStream} rng
 * @param {import('../chars/character.js').Character} char (for recency)
 * @returns {import('../core/types.js').CompiledLine|null}
 */
export function selectFallback(charId, tone, rng, char) {
  const map = fallbacksByChar.get(charId);
  if (!map) return null;
  const pool = map[tone] || map.neutral || [];
  if (!pool.length) return null;
  // avoid immediate repeats via a per-char rolling index
  const key = `fb_${tone}`;
  const lastIdx = char.memory.fact(key);
  let idx = rng.int(0, pool.length - 1);
  if (pool.length > 1 && idx === lastIdx) idx = (idx + 1) % pool.length;
  char.memory.fact(key, idx);
  return pool[idx];
}
