// @ts-check
// PURE intimacy-gate ladder. The SOLE authority on what escalations are allowed.
// Every intimacy-tagged action MUST route through gateCheck(). No other module
// may flip a gate state. No three.js/DOM imports.

/** @typedef {import('../core/types.js').GateTier} GateTier */
/** @typedef {import('../core/types.js').GateState} GateState */
/** @typedef {import('../core/types.js').Explicitness} Explicitness */
/** @typedef {import('../core/types.js').StatKey} StatKey */

/** Ordered ladder, low → high. */
export const GATE_LADDER = /** @type {GateTier[]} */ ([
  'light_touch', 'kiss', 'touch', 'undress', 'intimate', 'explicit', 'depraved',
]);

/** @param {GateTier} tier */
export function tierIndex(tier) { return GATE_LADDER.indexOf(tier); }

/**
 * Per-tier stat thresholds that must be met before a tier can even be OFFERED.
 * Consent (an in-fiction flag) is separate and required on top for `granted`.
 * @type {Record<GateTier, Partial<Record<StatKey, number>>>}
 */
export const TIER_THRESHOLDS = {
  light_touch: { trust: 20, openness: 20 },
  kiss: { trust: 35, arousal: 25, openness: 35 },
  touch: { trust: 45, arousal: 40, horniness: 30 },
  undress: { trust: 55, arousal: 55, horniness: 45, openness: 50 },
  intimate: { trust: 60, arousal: 65, horniness: 60 },
  explicit: { trust: 65, arousal: 75, horniness: 70, openness: 60 },
  depraved: { trust: 70, arousal: 85, horniness: 82, openness: 70, loyalty: 30 },
};

/** Explicitness caps: the highest tier the global setting permits. */
export const EXPLICITNESS_CAP = /** @type {Record<Explicitness, GateTier>} */ ({
  suggestive: 'kiss',
  mature: 'intimate',
  full: 'depraved',
});

/** @returns {Record<GateTier, GateState>} */
export function defaultGates() {
  /** @type {any} */
  const g = {};
  for (const t of GATE_LADDER) g[t] = 'locked';
  return g;
}

/** @returns {{ladder: Record<GateTier, {given:boolean, at:number}>, withdrawn:boolean, safeword:boolean}} */
export function defaultConsent() {
  /** @type {any} */
  const ladder = {};
  for (const t of GATE_LADDER) ladder[t] = { given: false, at: 0 };
  return { ladder, withdrawn: false, safeword: false };
}

/** @param {Partial<Record<StatKey,number>>} thresholds @param {Record<StatKey,number>} stats */
function meetsThresholds(thresholds, stats) {
  for (const [k, min] of Object.entries(thresholds)) {
    if (stats[k] < min) return { ok: false, missing: k, need: min, have: stats[k] };
  }
  return { ok: true };
}

/**
 * The core authority. Can `char` engage tier `tier` right now?
 * Requires: (1) explicitness cap allows it, (2) not withdrawn/safeworded,
 * (3) every LOWER tier already granted (ladder integrity), (4) stat thresholds met,
 * (5) in-fiction consent given for this tier.
 *
 * @param {{stats: Record<StatKey,number>, gates: Record<GateTier,GateState>,
 *          consent: {ladder: Record<GateTier,{given:boolean,at:number}>, withdrawn:boolean, safeword:boolean}}} char
 * @param {GateTier} tier
 * @param {{explicitness?: Explicitness}} [settings]
 * @returns {{allowed:boolean, reason?:string, need?:string}}
 */
export function gateCheck(char, tier, settings = {}) {
  const idx = tierIndex(tier);
  if (idx < 0) return { allowed: false, reason: 'unknown_tier' };

  const cap = EXPLICITNESS_CAP[settings.explicitness || 'mature'];
  if (idx > tierIndex(cap)) return { allowed: false, reason: 'explicitness_cap' };

  if (char.consent.safeword) return { allowed: false, reason: 'safeword' };
  if (char.consent.withdrawn) return { allowed: false, reason: 'consent_withdrawn' };

  // ladder integrity: all lower tiers must be granted
  for (let i = 0; i < idx; i++) {
    if (char.gates[GATE_LADDER[i]] !== 'granted') {
      return { allowed: false, reason: 'lower_tier_locked', need: GATE_LADDER[i] };
    }
  }

  const thr = meetsThresholds(TIER_THRESHOLDS[tier], char.stats);
  if (!thr.ok) return { allowed: false, reason: 'stats', need: thr.missing };

  if (!char.consent.ladder[tier].given) return { allowed: false, reason: 'no_consent' };

  return { allowed: true };
}

/**
 * Whether tier could be OFFERED (thresholds + cap + ladder), independent of consent.
 * Drives the UI showing an "offer" pip / dialogue option.
 */
export function canOffer(char, tier, settings = {}) {
  const idx = tierIndex(tier);
  const cap = EXPLICITNESS_CAP[settings.explicitness || 'mature'];
  if (idx > tierIndex(cap)) return false;
  if (char.consent.withdrawn || char.consent.safeword) return false;
  for (let i = 0; i < idx; i++) if (char.gates[GATE_LADDER[i]] !== 'granted') return false;
  return meetsThresholds(TIER_THRESHOLDS[tier], char.stats).ok;
}

/**
 * Mutate gate/consent state through the sanctioned transitions.
 * action: 'offer' | 'grant' | 'revoke' | 'withdraw' | 'safeword' | 'reset'
 * Returns true if the transition was legal and applied.
 * @param {any} char
 * @param {GateTier} tier
 * @param {'offer'|'grant'|'revoke'|'withdraw'|'safeword'|'reset_withdraw'} action
 * @param {number} [atMinute]
 */
export function setGate(char, tier, action, atMinute = 0) {
  switch (action) {
    case 'offer':
      if (char.gates[tier] === 'locked') { char.gates[tier] = 'offered'; return true; }
      return false;
    case 'grant':
      char.gates[tier] = 'granted';
      char.consent.ladder[tier] = { given: true, at: atMinute };
      return true;
    case 'revoke':
      char.gates[tier] = 'revoked';
      char.consent.ladder[tier].given = false;
      return true;
    case 'withdraw':
      char.consent.withdrawn = true;
      return true;
    case 'safeword':
      char.consent.safeword = true;
      char.consent.withdrawn = true;
      return true;
    case 'reset_withdraw':
      char.consent.withdrawn = false;
      char.consent.safeword = false;
      return true;
  }
  return false;
}

/**
 * Highest tier currently granted (or null). Used for scene/animation ceilings.
 * @param {Record<GateTier,GateState>} gates
 * @returns {GateTier|null}
 */
export function highestGranted(gates) {
  let top = null;
  for (const t of GATE_LADDER) if (gates[t] === 'granted') top = t;
  return top;
}
