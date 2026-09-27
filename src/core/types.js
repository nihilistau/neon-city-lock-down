// @ts-check
// Shared JSDoc typedefs — the single source of truth for cross-module shapes.
// This file exports nothing at runtime; import it for types only.

/**
 * @typedef {'arousal'|'pleasure'|'happiness'|'horniness'|'openness'|'dominance'|
 *           'trust'|'tension'|'energy'|'sobriety'|'loyalty'|'fear'} StatKey
 */

/** @typedef {'stranger'|'ally'|'trusted'|'loyal'} BondTier */

/**
 * @typedef {Object} StageDirection
 * @property {number} at        character offset in cleanText where it fires
 * @property {string} type      'anim'|'face'|'mood'|'look'|'move'|'sit'|'outfit'|'light'|'cam'|'sfx'|'vox'|'wait'|'fx'|'beat'|'stat'
 * @property {string[]} args
 */

/**
 * @typedef {Object} CompiledLine
 * @property {string} cleanText
 * @property {StageDirection[]} directions
 */

/**
 * @typedef {Object} ActorCommand
 * @property {'goto'|'sit'|'stand'|'playClip'|'face'|'look'|'pairWith'|'unpair'|'say'|'wait'|'outfit'} type
 * @property {any[]} args
 * @property {boolean} [priority]   preempts current queue (events/combat)
 * @property {import('./types.js').BondTier} [minBond] bond the character must hold for the queue to accept it
 */

export {};
