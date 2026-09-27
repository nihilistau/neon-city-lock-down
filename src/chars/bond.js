// @ts-check
// PURE relationship tier. The successor to the intimacy ladder: a character's
// bond with the player is DERIVED from trust + loyalty, never stored as truth,
// so it cannot drift out of sync with the stats that dialogue, events and
// objectives already move. The only remembered thing is the previous tier,
// which buys hysteresis — without it a character hovering at 35 would flip
// ally/stranger on every line and spam "Kai now trusts you".
import { cfg } from '../core/config.js';
import { CONFIG_DEFAULTS } from '../../data/configDefaults.js';

/** @typedef {import('../core/types.js').BondTier} BondTier */

/** Ordered low → high. Order is structural; thresholds are config-tunable. */
export const BOND_TIERS = /** @type {BondTier[]} */ (['stranger', 'ally', 'trusted', 'loyal']);

const DEF = CONFIG_DEFAULTS.chars.bond;
const thresholds = () => cfg('chars.bond.thresholds', DEF.thresholds);
const hysteresis = () => cfg('chars.bond.hysteresis', DEF.hysteresis);

/** @param {string} tier */
export function bondIndex(tier) { return BOND_TIERS.indexOf(/** @type {BondTier} */ (tier)); }

/** @param {{trust:number, loyalty:number}} stats */
export function bondScore(stats) { return ((stats.trust ?? 0) + (stats.loyalty ?? 0)) / 2; }

/**
 * @param {{trust:number, loyalty:number}} stats
 * @param {BondTier} [prevTier] the tier held before this change (enables hysteresis)
 * @returns {BondTier}
 */
export function bondTier(stats, prevTier) {
  const score = bondScore(stats);
  const thr = thresholds();
  const held = prevTier ? bondIndex(prevTier) : -1;
  const margin = hysteresis();
  let tier = 0;
  for (let i = 1; i < BOND_TIERS.length; i++) {
    const entry = thr[BOND_TIERS[i]];
    // a tier already held is kept down to entry - margin; a new one needs full entry
    const need = i <= held ? entry - margin : entry;
    if (score >= need) tier = i; else break;
  }
  return BOND_TIERS[tier];
}

/**
 * @param {{trust:number, loyalty:number}} stats @param {BondTier} tier
 * @param {BondTier} [prevTier]
 */
export function bondAtLeast(stats, tier, prevTier) {
  return bondIndex(bondTier(stats, prevTier)) >= bondIndex(tier);
}
