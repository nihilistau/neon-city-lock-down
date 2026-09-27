// @ts-check
// Content builders + validators. Data modules construct topics/intents/etc.
// through these so malformed content throws at import time (caught by
// tools/lint-data.mjs without launching a browser).

import { STAT_KEYS } from '../src/chars/stats.js';
import { BOND_TIERS } from '../src/chars/bond.js';

const STAT_SET = new Set(STAT_KEYS);
const BOND_SET = new Set(BOND_TIERS);

function assert(cond, msg) { if (!cond) throw new Error(`[schema] ${msg}`); }

/** @param {any} c @param {string} where */
function assertBond(c, where) {
  if (!c) return;
  for (const k of ['bondAtLeast', 'bondBelow']) {
    if (c[k] != null) assert(BOND_SET.has(c[k]), `${where}.${k} must be one of ${BOND_TIERS.join('|')}`);
  }
}

function validateStatMap(map, where) {
  if (!map) return;
  for (const k of Object.keys(map)) {
    assert(STAT_SET.has(k), `${where}: unknown stat "${k}"`);
    assert(typeof map[k] === 'number', `${where}: stat "${k}" must be a number`);
  }
}

/**
 * Build & validate a topic definition.
 * @param {string} id
 * @param {any} def
 */
/** minigames a topic or line may open — see src/dialogue/effects.js */
const GAME_SET = new Set(['cards']);

/** @param {any} g @param {string} where */
function assertGame(g, where) {
  assert(typeof g === 'string' && (GAME_SET.has(g) || g.startsWith('mystery:')),
    `${where} must be one of ${[...GAME_SET].join('|')} or mystery:<case>`);
}

export function topic(id, def) {
  assert(typeof id === 'string' && id.includes('.'), `topic id "${id}" should be namespaced (char.pack.name)`);
  assert(def.char, `topic ${id}: missing char`);
  assert(Array.isArray(def.lines) && def.lines.length, `topic ${id}: needs lines[]`);
  for (const ln of def.lines) {
    assert(typeof ln.text === 'string', `topic ${id}: line.text must be a string`);
    validateStatMap(ln.fx, `topic ${id} line.fx`);
    if (ln.game) assertGame(ln.game, `topic ${id} line.game`);
    if (ln.bed != null) assert(['invite', 'stay', 'dismiss'].includes(ln.bed), `topic ${id} line.bed must be invite|stay|dismiss`);
    assertBond(ln.when, `topic ${id} line.when`);
  }
  assertBond(def.cond, `topic ${id} cond`);
  if (def.effects) {
    validateStatMap(def.effects.stat, `topic ${id} effects.stat`);
    if (def.effects.game) assertGame(def.effects.game, `topic ${id}: effects.game`);
  }
  if (def.triggers) for (const t of def.triggers) {
    assert(t.intent || t.fromBranch, `topic ${id}: trigger needs intent or fromBranch`);
  }
  return { id, ...def };
}

/** intent builder passthrough (validation is light; matcher tolerates shapes) */
export function intent(id, def) {
  assert(typeof id === 'string', 'intent needs string id');
  return { id, ...def };
}

/** trigger helper for readability in topic defs */
export function onIntent(intentId, min = 0) {
  return { intent: intentId, min };
}
