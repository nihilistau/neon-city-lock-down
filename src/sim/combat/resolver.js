// @ts-check
// PURE combat math — no three.js/DOM. Attack resolution, damage, injuries.
// WEAPONS/HOSTILE_ARCHETYPES default values live in data/configDefaults.js
// (combat group) so they share one source of truth with config/combat.yaml.
// These exports are the defaults (used by tests + the HUD preview); the runtime
// combat controller reads live values via cfg('combat.*') for hot-reload.
import { CONFIG_DEFAULTS } from '../../../data/configDefaults.js';

/**
 * @typedef {Object} Weapon
 * @property {string} id
 * @property {[number, number]} damage  [min, max]
 * @property {number} accuracy          base hit chance 0..1 at close range
 * @property {number} range             meters at which accuracy halves
 */

/** @type {Record<string, Weapon>} */
export const WEAPONS = CONFIG_DEFAULTS.combat.weapons;

/**
 * Probability an attack lands (shared by resolveAttack and the combat HUD's
 * hit-% preview).
 * @param {{weapon:Weapon, skill:number, distance:number, cover?:number, targetDodge?:number}} a
 */
export function hitChance(a) {
  const w = a.weapon;
  const distFactor = 1 / (1 + Math.max(0, a.distance - 1) / w.range);
  const skillFactor = 0.6 + (a.skill / 100) * 0.55;
  const coverFactor = 1 - (a.cover ?? 0) * 0.5;
  const dodgeFactor = 1 - ((a.targetDodge ?? 20) / 100) * 0.3;
  return Math.min(0.98, Math.max(0.03, w.accuracy * distFactor * skillFactor * coverFactor * dodgeFactor));
}

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
  const pHit = hitChance(a);

  if (!rng.chance(pHit)) return { hit: false, crit: false, damage: 0 };
  const crit = rng.chance(0.08 + (a.skill / 100) * 0.1);
  let damage = rng.range(w.damage[0], w.damage[1]);
  if (crit) damage *= 1.8;
  return { hit: true, crit, damage: Math.round(damage) };
}

/**
 * Player-aimed shot: the ray already hit a body. Cover reduces damage and
 * may glance; it never converts a mesh-hit into a miss. NPC/turret fire
 * still uses resolveAttack (dice).
 * @param {{weapon:Weapon, cover?:number, skill?:number, rng:import('../../core/rng.js').RngStream}} a
 * @returns {{hit:true, crit:boolean, damage:number, glancing:boolean}}
 */
export function resolveAimedShot(a) {
  const w = a.weapon;
  const cover = Math.max(0, Math.min(1, a.cover ?? 0));
  const skill = a.skill ?? 60;
  const crit = a.rng.chance(0.08 + (skill / 100) * 0.1);
  let damage = a.rng.range(w.damage[0], w.damage[1]);
  if (crit) damage *= 1.8;
  const coverMul = 1 - cover * 0.55;
  damage = Math.max(1, Math.round(damage * coverMul));
  return { hit: true, crit, damage, glancing: cover >= 0.4 };
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
export const HOSTILE_ARCHETYPES = CONFIG_DEFAULTS.combat.hostileArchetypes;
