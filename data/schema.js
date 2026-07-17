// @ts-check
// Content builders + validators. Data modules construct topics/intents/etc.
// through these so malformed content throws at import time (caught by
// tools/lint-data.mjs without launching a browser).

import { STAT_KEYS } from '../src/chars/stats.js';
import { GATE_LADDER } from '../src/chars/gates.js';

const STAT_SET = new Set(STAT_KEYS);
const GATE_SET = new Set(GATE_LADDER);

function assert(cond, msg) { if (!cond) throw new Error(`[schema] ${msg}`); }

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
export function topic(id, def) {
  assert(typeof id === 'string' && id.includes('.'), `topic id "${id}" should be namespaced (char.pack.name)`);
  assert(def.char, `topic ${id}: missing char`);
  assert(Array.isArray(def.lines) && def.lines.length, `topic ${id}: needs lines[]`);
  for (const ln of def.lines) {
    assert(typeof ln.text === 'string', `topic ${id}: line.text must be a string`);
    validateStatMap(ln.fx, `topic ${id} line.fx`);
  }
  if (def.effects) {
    validateStatMap(def.effects.stat, `topic ${id} effects.stat`);
    if (def.effects.gate) {
      assert(GATE_SET.has(def.effects.gate.tier), `topic ${id}: bad gate tier`);
    }
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
