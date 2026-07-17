// @ts-check
// NPC need model: slow-growing pressures the utility brain spends actions on.
// 0 = satisfied, 100 = desperate. Growth rates are per game-minute and get
// modulated by stats (low energy grows rest need faster, etc.).

export const NEED_KEYS = ['rest', 'social', 'fun', 'drink', 'air', 'safety'];

export function defaultNeeds() {
  return { rest: 20, social: 35, fun: 30, drink: 25, air: 20, safety: 10 };
}

/**
 * @param {Record<string, number>} needs mutated in place
 * @param {number} minutes
 * @param {Record<string, number>} stats character stats
 * @param {number} threat world threat 0..100
 */
export function growNeeds(needs, minutes, stats, threat) {
  const m = minutes;
  needs.rest += m * (0.10 + (100 - stats.energy) * 0.002);
  needs.social += m * 0.14;
  needs.fun += m * (0.12 + (100 - stats.happiness) * 0.001);
  needs.drink += m * (0.08 + stats.tension * 0.001);
  needs.air += m * 0.06;
  needs.safety = Math.max(needs.safety, threat * 0.6 + stats.fear * 0.3);
  for (const k of NEED_KEYS) needs[k] = Math.max(0, Math.min(100, needs[k]));
}

/** @param {Record<string, number>} needs @param {Partial<Record<string, number>>} relief */
export function satisfy(needs, relief) {
  for (const [k, v] of Object.entries(relief)) {
    needs[k] = Math.max(0, Math.min(100, (needs[k] ?? 0) - v));
  }
}
