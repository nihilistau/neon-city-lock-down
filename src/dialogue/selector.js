// @ts-check
// Line-variant selection within a chosen topic. Deterministic under a fixed seed
// + memory state: score = (#conditions matched × 10) − recency penalty + jitter.
// Pure (rng passed in). This is a unit-test anchor.

/**
 * @param {any} topic compiled topic (lines have .when, .compiled, .fx)
 * @param {import('../chars/character.js').Character} char
 * @param {number} nowMinute
 * @param {import('../core/rng.js').RngStream} rng
 * @returns {any} the chosen line (with .compiled)
 */
export function selectLine(topic, char, nowMinute, rng) {
  const lines = topic.lines;
  let best = null, bestScore = -Infinity, bestIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!whenOk(ln.when, char)) continue;
    let score = conditionCount(ln.when) * 10;

    // recency: penalize a line said recently (by its topic+index key)
    const key = `${topic.id}#${i}`;
    const usage = char.memory.lineUsage(key);
    if (usage.count > 0) {
      const age = nowMinute - usage.lastMin;
      score -= Math.max(0, 8 - age * 0.05) + usage.count * 1.5;
    }
    score += rng.range(-2, 2);

    if (score > bestScore) { bestScore = score; best = ln; bestIdx = i; }
  }

  // fall back to the last (unconditional) line if nothing matched
  if (!best) { best = lines[lines.length - 1]; bestIdx = lines.length - 1; }
  best._key = `${topic.id}#${bestIdx}`;
  return best;
}

/** @param {any} when */
function conditionCount(when) {
  if (!when) return 0;
  let c = 0;
  for (const k of Object.keys(when)) {
    const v = when[k];
    c += (v && typeof v === 'object') ? Object.keys(v).length : 1;
  }
  return c;
}

/**
 * @param {any} when @param {import('../chars/character.js').Character} char
 */
function whenOk(when, char) {
  if (!when) return true;
  const s = char.stats;
  if (when.statGte) for (const [k, v] of Object.entries(when.statGte)) if (s[k] < v) return false;
  if (when.statLte) for (const [k, v] of Object.entries(when.statLte)) if (s[k] > v) return false;
  if (when.mood && !when.mood.includes(char.mood?.id)) return false;
  if (when.flag && !char.memory.hasFlag(when.flag)) return false;
  if (when.notFlag && char.memory.hasFlag(when.notFlag)) return false;
  if (when.bondAtLeast && !char.bondAtLeast(when.bondAtLeast)) return false;
  if (when.bondBelow && char.bondAtLeast(when.bondBelow)) return false;
  return true;
}
