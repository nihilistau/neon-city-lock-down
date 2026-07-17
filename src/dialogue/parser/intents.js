// @ts-check
// Scored intent matcher. Intents are registered as pattern sets: weighted
// keywords/stems, multiword phrases (worth more than the sum of parts), and
// optional regex escape hatches. Returns ranked matches with captured slots. Pure.

/**
 * @typedef {Object} IntentDef
 * @property {string} id
 * @property {string[]} [keywords]     matched against stems (weight 1 each)
 * @property {[string, number][]} [weighted]  [stem, weight]
 * @property {string[]} [phrases]      multiword substrings of normalized text (weight 2.5)
 * @property {RegExp[]} [regex]        each match adds weight 3
 * @property {number} [base]           base score if any signal matches
 */

/** @type {Map<string, IntentDef>} */
export const intentRegistry = new Map();

/** @param {IntentDef[]} defs */
export function registerIntents(defs) {
  for (const d of defs) {
    if (intentRegistry.has(d.id)) throw new Error(`duplicate intent: ${d.id}`);
    intentRegistry.set(d.id, d);
  }
}

/**
 * Score all intents against normalized input.
 * @param {import('./normalize.js').normalize} n
 * @returns {{id:string, score:number, slots:Record<string,string>}[]} ranked desc
 */
export function matchIntents(n) {
  const stemSet = new Set(n.stems);
  const results = [];

  for (const def of intentRegistry.values()) {
    let score = 0;
    if (def.keywords) for (const k of def.keywords) if (stemSet.has(k)) score += 1;
    if (def.weighted) for (const [k, w] of def.weighted) if (stemSet.has(k)) score += w;
    if (def.phrases) for (const p of def.phrases) if (n.text.includes(p)) score += 2.5;
    if (def.regex) for (const rx of def.regex) if (rx.test(n.text)) score += 3;
    if (score > 0) {
      score += def.base || 0;
      // coverage bonus: reward matching a larger share of a short message
      score *= 1 + Math.min(0.5, score / Math.max(3, n.wordCount));
      results.push({ id: def.id, score, slots: {} });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Resolve slot references against the registry of known entities.
 * @param {import('./normalize.js').normalize} n
 * @param {{chars?:string[], zones?:string[], items?:string[]}} vocab
 * @returns {Record<string,string>}
 */
export function captureSlots(n, vocab) {
  /** @type {Record<string,string>} */
  const slots = {};
  const find = (list) => list?.find((v) => n.text.includes(v));
  const c = find(vocab.chars); if (c) slots.char = c;
  const z = find(vocab.zones); if (z) slots.zone = z;
  const i = find(vocab.items); if (i) slots.item = i;
  return slots;
}
