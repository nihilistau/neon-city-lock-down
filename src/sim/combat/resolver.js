// @ts-check
// PURE combat math — no three.js/DOM. Attack resolution, damage, injuries.

/**
 * @typedef {Object} Weapon
 * @property {string} id
 * @property {[number, number]} damage  [min, max]
 * @property {number} accuracy          base hit chance 0..1 at close range
 * @property {number} range             meters at which accuracy halves
 */

/** @type {Record<string, Weapon>} */
export const WEAPONS = {
  sidearm: { id: 'sidearm', damage: [12, 22], accuracy: 0.78, range: 9 },
  smg: { id: 'smg', damage: [8, 14], accuracy: 0.6, range: 7 },
  pipe: { id: 'pipe', damage: [6, 12], accuracy: 0.85, range: 1.2 },
  shiv: { id: 'shiv', damage: [5, 10], accuracy: 0.8, range: 1 },
};

/**
 * Resolve one attack.
 * @param {Object} a
 * @param {Weapon} a.weapon
 * @param {number} a.skill      0..100 attacker competence
 * @param {number} a.distance   meters
 * @param {number} [a.cover]    0..1 target cover
 * @param {number} [a.targetDodge] 0..100
 * @param {import('../../core/rng.js').RngStream} rng
 * @returns {{hit:boolean, crit:boolean, damage:number}}
 */
export function resolveAttack(a, rng) {
  const w = a.weapon;
  const distFactor = 1 / (1 + Math.max(0, a.distance - 1) / w.range);
  const skillFactor = 0.6 + (a.skill / 100) * 0.55;
  const coverFactor = 1 - (a.cover ?? 0) * 0.5;
  const dodgeFactor = 1 - ((a.targetDodge ?? 20) / 100) * 0.3;
  const pHit = Math.min(0.98, Math.max(0.03, w.accuracy * distFactor * skillFactor * coverFactor * dodgeFactor));

  if (!rng.chance(pHit)) return { hit: false, crit: false, damage: 0 };
  const crit = rng.chance(0.08 + (a.skill / 100) * 0.1);
  let damage = rng.range(w.damage[0], w.damage[1]);
  if (crit) damage *= 1.8;
  return { hit: true, crit, damage: Math.round(damage) };
}

const BODY_PARTS = ['arm', 'leg', 'torso', 'shoulder', 'hand'];

/**
 * Convert damage into an injury record for a character.
 * @param {number} damage
 * @param {import('../../core/rng.js').RngStream} rng
 * @returns {{part:string, severity:'graze'|'wound'|'serious', bleeding:boolean, at:number}}
 */
export function rollInjury(damage, rng, atMinute = 0) {
  const part = rng.pick(BODY_PARTS);
  const severity = damage >= 30 ? 'serious' : damage >= 16 ? 'wound' : 'graze';
  return {
    part, severity,
    bleeding: severity !== 'graze' && rng.chance(severity === 'serious' ? 0.7 : 0.35),
    at: atMinute,
  };
}

/**
 * Hostile archetype stats.
 * @type {Record<string, {hp:number, skill:number, weapon:string, speed:number, aggression:number}>}
 */
export const HOSTILE_ARCHETYPES = {
  rioter: { hp: 45, skill: 30, weapon: 'pipe', speed: 1.5, aggression: 0.8 },
  looter: { hp: 35, skill: 25, weapon: 'shiv', speed: 1.7, aggression: 0.5 },
  merc: { hp: 70, skill: 65, weapon: 'smg', speed: 1.3, aggression: 0.95 },
};
