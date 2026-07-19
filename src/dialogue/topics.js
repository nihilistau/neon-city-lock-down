// @ts-check
// Topic graph + condition DSL. Topics are registered by data modules through the
// topic() builder in data/schema.js (which validates + compiles line text). Here
// we index them per character and evaluate their conditions against live state.

import { compileLine } from './stageDirections.js';

/** @type {Map<string, any>} topicId → compiled topic */
export const topicRegistry = new Map();
/** @type {Map<string, any[]>} charId → topics */
const byChar = new Map();

/**
 * Register topic definitions. Line text is compiled here (fail fast on bad tags).
 * @param {any[]} defs
 */
export function registerTopics(defs) {
  for (const def of defs) {
    if (topicRegistry.has(def.id)) throw new Error(`duplicate topic id: ${def.id}`);
    const compiled = { ...def };
    compiled.lines = def.lines.map((ln) => ({
      ...ln,
      compiled: compileLine(ln.text),
    }));
    topicRegistry.set(def.id, compiled);
    if (!byChar.has(def.char)) byChar.set(def.char, []);
    byChar.get(def.char).push(compiled);
  }
}

/**
 * Remove a registered topic by id (from both indexes), so it can be re-registered.
 * Used by the creation kit when a user edits + re-saves a topic in-session.
 * @param {string} id
 */
export function unregisterTopic(id) {
  const t = topicRegistry.get(id);
  if (!t) return false;
  topicRegistry.delete(id);
  const list = byChar.get(t.char);
  if (list) byChar.set(t.char, list.filter((x) => x.id !== id));
  return true;
}

/** @param {string} charId */
export function topicsFor(charId) { return byChar.get(charId) || []; }

/** @param {string} id */
export function getTopic(id) { return topicRegistry.get(id); }

/**
 * Evaluate a topic condition object against character + world context.
 * Supported keys: minStat, maxStat, mood, flag, notFlag, saidBefore, notSaid,
 * fact, dayGte, gateAtLeast, zoneAny, chance.
 * @param {any} cond
 * @param {{char: import('../chars/character.js').Character, day:number, rng?:any}} ctx
 */
export function condOk(cond, ctx) {
  if (!cond) return true;
  const { char, day } = ctx;
  const s = char.stats, mem = char.memory;
  if (cond.minStat) for (const [k, v] of Object.entries(cond.minStat)) if (s[k] < v) return false;
  if (cond.maxStat) for (const [k, v] of Object.entries(cond.maxStat)) if (s[k] > v) return false;
  if (cond.mood && !cond.mood.includes(char.mood?.id)) return false;
  if (cond.flag && !mem.hasFlag(cond.flag)) return false;
  if (cond.notFlag && mem.hasFlag(cond.notFlag)) return false;
  if (cond.saidBefore && !mem.saidTopic(cond.saidBefore)) return false;
  if (cond.notSaid && mem.saidTopic(cond.notSaid)) return false;
  if (cond.fact) for (const [k, v] of Object.entries(cond.fact)) if (mem.fact(k) !== v) return false;
  if (cond.minCounter) for (const [k, v] of Object.entries(cond.minCounter)) if (mem.count(k) < v) return false;
  if (cond.dayGte != null && day < cond.dayGte) return false;
  if (cond.zoneAny && !cond.zoneAny.includes(char.queue.zone)) return false;
  if (cond.gateAtLeast) {
    const order = ['light_touch', 'kiss', 'touch', 'undress', 'intimate', 'explicit', 'depraved'];
    const top = char.topGate;
    if (!top || order.indexOf(top) < order.indexOf(cond.gateAtLeast)) return false;
  }
  return true;
}

/**
 * Find candidate topics for a character responding to a set of intents.
 * @param {import('../chars/character.js').Character} char
 * @param {{id:string, score:number}[]} intents
 * @param {{day:number}} ctx
 * @returns {{topic:any, score:number}[]} ranked
 */
export function candidateTopics(char, intents, ctx) {
  const intentScore = new Map(intents.map((i) => [i.id, i.score]));
  const out = [];
  for (const topic of topicsFor(char.id)) {
    if (topic.triggers?.length) {
      let best = 0;
      for (const trig of topic.triggers) {
        if (trig.intent && intentScore.has(trig.intent)) {
          const sc = intentScore.get(trig.intent);
          if (sc >= (trig.min ?? 0)) best = Math.max(best, sc);
        }
      }
      if (best <= 0) continue;
      if (!condOk(topic.cond, { char, day: ctx.day })) continue;
      // recency penalty: topics said recently rank lower
      const said = char.memory.saidTopic(topic.id) ? -1.5 : 0;
      out.push({ topic, score: best * 2 + (topic.priority || 0) + said });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
