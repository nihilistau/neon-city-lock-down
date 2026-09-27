// @ts-check
// PURE 9-stat model. No imports from three.js/DOM. Fully unit-tested.
// All stats are clamped 0..100. Deltas are scaled by personality receptivity
// and modulated by cross-stat coupling (e.g. high tension suppresses trust gain).
// Coupling/decay/compliance/start values are config-tunable (config/chars.yaml);
// cfg() falls back to CONFIG_DEFAULTS.chars (so Node unit tests use defaults).
import { cfg } from '../core/config.js';
import { CONFIG_DEFAULTS } from '../../data/configDefaults.js';
const CH = CONFIG_DEFAULTS.chars;

/** @typedef {import('../core/types.js').StatKey} StatKey */

export const STAT_KEYS = /** @type {StatKey[]} */ ([
  'happiness', 'openness', 'dominance', 'trust', 'tension', 'energy', 'sobriety', 'loyalty', 'fear',
]);

/** @returns {Record<StatKey, number>} */
export function defaultStats() {
  return { ...cfg('chars.startStats', CH.startStats) };
}

/** clamp helper */
export function clamp(v, lo = 0, hi = 100) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * Coupling: given the CURRENT stats, scale an incoming delta for `key`.
 * Returns the effective multiplier (>=0). Pure function of state + key + sign.
 * @param {Record<StatKey, number>} s
 * @param {StatKey} key
 * @param {number} delta raw signed delta (pre-scale)
 */
export function couplingFactor(s, key, delta) {
  let f = 1;
  const gaining = delta > 0;
  const c = cfg('chars.coupling', CH.coupling);
  switch (key) {
    case 'openness':
      // intoxication opens people up; fear closes them
      if (gaining) f *= 1 + (1 - s.sobriety / 100) * c.intoxOpen - (s.fear / 100) * c.fearClose;
      break;
    case 'trust':
      // trust is hard to gain while tense, easy to lose
      if (gaining) f *= 1 - (s.tension / 100) * c.tensionTrust;
      break;
    case 'tension':
      // tension climbs faster when fearful
      if (gaining) f *= 1 + (s.fear / 100) * c.fearTension;
      break;
  }
  return Math.max(0, f);
}

/**
 * Apply a set of deltas to a stats object IN PLACE, returning the actually-applied
 * deltas (post-scale, post-clamp) so callers can report/log them.
 * @param {Record<StatKey, number>} stats
 * @param {Partial<Record<StatKey, number>>} deltas
 * @param {{receptivity?: Partial<Record<StatKey, number>>}} [personality]
 * @returns {Partial<Record<StatKey, number>>} applied deltas
 */
export function applyDelta(stats, deltas, personality = {}) {
  const recv = personality.receptivity || {};
  /** @type {Partial<Record<StatKey, number>>} */
  const applied = {};
  for (const key of /** @type {StatKey[]} */ (Object.keys(deltas))) {
    const raw = deltas[key];
    if (raw == null || !STAT_KEYS.includes(key)) continue;
    const recvScale = recv[key] ?? 1;
    const couple = couplingFactor(stats, key, raw);
    const scaled = raw * recvScale * couple;
    const before = stats[key];
    stats[key] = clamp(before + scaled);
    applied[key] = stats[key] - before;
  }
  return applied;
}

/**
 * Passive decay/regression toward homeostatic rest values over game minutes.
 * Tension and fear bleed off; energy recovers slowly; sobriety returns.
 * @param {Record<StatKey, number>} stats
 * @param {number} minutes
 */
export function decayTick(stats, minutes) {
  const d = cfg('chars.decay', CH.decay);
  const rest = d.rest, rate = d.rate;
  for (const key of /** @type {StatKey[]} */ (Object.keys(rest))) {
    const target = rest[key];
    const step = rate[key] * minutes;
    if (stats[key] > target) stats[key] = Math.max(target, stats[key] - step);
    else stats[key] = Math.min(target, stats[key] + step * d.approachFactor);
  }
  // sobriety climbs back toward 100 (metabolizing)
  stats.sobriety = clamp(stats.sobriety + d.sobrietyRegain * minutes);
}

/**
 * Compliance score 0..100 — how likely the character is to accept player asks.
 * Weighted blend; NOT stored, derived on demand.
 * @param {Record<StatKey, number>} stats
 * @param {number} [playerDominance] 0..100 — a dominant player lowers a dominant NPC's compliance
 */
export function compliance(stats, playerDominance = 50) {
  const w = cfg('chars.compliance', CH.compliance);
  const base =
    stats.trust * w.trust +
    stats.openness * w.openness +
    stats.happiness * w.happiness +
    stats.loyalty * w.loyalty +
    (100 - stats.tension) * w.calm +
    (100 - stats.fear) * w.brave;
  // dominance clash: if NPC is more dominant than the player, compliance drops
  const clash = clamp((stats.dominance - playerDominance) * w.clashScale, w.clashMin, w.clashMax);
  return clamp(base - clash);
}
