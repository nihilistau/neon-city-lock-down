// @ts-check
// Per-character memory: facts, counters, said-lines (for recency), promises,
// topic history, and relationships to other characters + the player.

export class Memory {
  constructor() {
    /** @type {Record<string, any>} */
    this.facts = {};
    /** @type {Record<string, number>} */
    this.counters = {};
    /** @type {Map<string, {count:number, lastMin:number}>} lineId → usage */
    this.saidLines = new Map();
    /** @type {string[]} recent topic ids (cap 20) */
    this.topicHistory = [];
    /** @type {{text:string, at:number}[]} */
    this.promises = [];
    /** @type {Record<string, {affinity:number, grudge:number, lastClash:number}>} */
    this.rel = {};
    /** @type {Set<string>} */
    this.flags = new Set();
  }

  fact(key, value) {
    if (value === undefined) return this.facts[key];
    this.facts[key] = value;
    return value;
  }
  bump(counter, by = 1) { return (this.counters[counter] = (this.counters[counter] || 0) + by); }
  count(counter) { return this.counters[counter] || 0; }

  setFlag(f) { this.flags.add(f); }
  clearFlag(f) { this.flags.delete(f); }
  hasFlag(f) { return this.flags.has(f); }

  recordLine(lineId, atMin) {
    const e = this.saidLines.get(lineId);
    if (e) { e.count++; e.lastMin = atMin; }
    else this.saidLines.set(lineId, { count: 1, lastMin: atMin });
  }
  lineUsage(lineId) { return this.saidLines.get(lineId) || { count: 0, lastMin: -9999 }; }

  recordTopic(topicId) {
    this.topicHistory.push(topicId);
    if (this.topicHistory.length > 20) this.topicHistory.shift();
  }
  saidTopic(topicId) { return this.topicHistory.includes(topicId); }

  relTo(id) {
    return this.rel[id] || (this.rel[id] = { affinity: 0, grudge: 0, lastClash: -9999 });
  }

  serialize() {
    return {
      facts: this.facts, counters: this.counters,
      saidLines: [...this.saidLines.entries()],
      topicHistory: this.topicHistory, promises: this.promises,
      rel: this.rel, flags: [...this.flags],
    };
  }
  /** @param {any} d */
  static deserialize(d) {
    const m = new Memory();
    m.facts = d.facts || {};
    m.counters = d.counters || {};
    m.saidLines = new Map(d.saidLines || []);
    m.topicHistory = d.topicHistory || [];
    m.promises = d.promises || [];
    m.rel = d.rel || {};
    m.flags = new Set(d.flags || []);
    return m;
  }
}
