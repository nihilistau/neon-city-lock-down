// @ts-check
// PURE 12-stat model. No imports from three.js/DOM. Fully unit-tested.
// All stats are clamped 0..100. Deltas are scaled by personality receptivity
// and modulated by cross-stat coupling (e.g. high tension suppresses arousal gain).

/** @typedef {import('../core/types.js').StatKey} StatKey */

export const STAT_KEYS = /** @type {StatKey[]} */ ([
  'arousal', 'pleasure', 'happiness', 'horniness', 'openness', 'dominance',
  'trust', 'tension', 'energy', 'sobriety', 'loyalty', 'fear',
]);

/** @returns {Record<StatKey, number>} */
export function defaultStats() {
  return {
    arousal: 5, pleasure: 15, happiness: 50, horniness: 10, openness: 30,
    dominance: 50, trust: 20, tension: 25, energy: 75, sobriety: 100,
    loyalty: 10, fear: 5,
  };
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
  switch (key) {
    case 'arousal':
    case 'horniness':
      // high tension / fear suppresses arousal & horniness gains
      if (gaining) f *= 1 - (s.tension / 100) * 0.55 - (s.fear / 100) * 0.5;
      // intoxication (low sobriety) amplifies arousal gains
      if (gaining) f *= 1 + (1 - s.sobriety / 100) * 0.4;
      break;
    case 'openness':
      // intoxication opens people up; fear closes them
      if (gaining) f *= 1 + (1 - s.sobriety / 100) * 0.5 - (s.fear / 100) * 0.4;
      break;
    case 'trust':
      // trust is hard to gain while tense, easy to lose
      if (gaining) f *= 1 - (s.tension / 100) * 0.4;
      break;
    case 'pleasure':
      if (gaining) f *= 0.3 + (s.arousal / 100) * 0.9; // pleasure tracks arousal
      break;
    case 'tension':
      // tension climbs faster when fearful
      if (gaining) f *= 1 + (s.fear / 100) * 0.35;
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
 * Arousal/horniness/tension bleed off; energy recovers slowly; sobriety returns.
 * @param {Record<StatKey, number>} stats
 * @param {number} minutes
 */
export function decayTick(stats, minutes) {
  const rest = { arousal: 5, horniness: 8, tension: 22, pleasure: 12, fear: 4 };
  const rate = { arousal: 0.5, horniness: 0.35, tension: 0.25, pleasure: 0.6, fear: 0.4 };
  for (const key of /** @type {StatKey[]} */ (Object.keys(rest))) {
    const target = rest[key];
    const step = rate[key] * minutes;
    if (stats[key] > target) stats[key] = Math.max(target, stats[key] - step);
    else stats[key] = Math.min(target, stats[key] + step * 0.3);
  }
  // sobriety climbs back toward 100 (metabolizing)
  stats.sobriety = clamp(stats.sobriety + 0.35 * minutes);
}

/**
 * Compliance score 0..100 — how likely the character is to accept player asks.
 * Weighted blend; NOT stored, derived on demand.
 * @param {Record<StatKey, number>} stats
 * @param {number} [playerDominance] 0..100 — a dominant player lowers a dominant NPC's compliance
 */
export function compliance(stats, playerDominance = 50) {
  const base =
    stats.trust * 0.30 +
    stats.openness * 0.22 +
    stats.happiness * 0.14 +
    stats.loyalty * 0.14 +
    (100 - stats.tension) * 0.12 +
    (100 - stats.fear) * 0.08;
  // dominance clash: if NPC is more dominant than the player, compliance drops
  const clash = clamp((stats.dominance - playerDominance) * 0.35, -20, 35);
  return clamp(base - clash);
}
