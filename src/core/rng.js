// @ts-check
// Seeded PRNG (mulberry32) with named streams so world gen, dialogue jitter,
// AI decisions and loot rolls don't perturb each other's sequences.

/** @param {string} str */
export function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** @param {number} seed */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RngStream {
  /** @param {number} seed */
  constructor(seed) {
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
    this.draws = 0;
  }
  /** float [0,1) */
  next() { this.draws++; return this._next(); }
  /** float [min,max) */
  range(min, max) { return min + this.next() * (max - min); }
  /** int [min,max] inclusive */
  int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }
  /** @param {number} p probability of true */
  chance(p) { return this.next() < p; }
  /** @template T @param {T[]} arr @returns {T} */
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /**
   * Weighted pick. @template T
   * @param {T[]} arr @param {(item:T)=>number} weightFn @returns {T|null}
   */
  weighted(arr, weightFn) {
    let total = 0;
    const w = arr.map((it) => { const v = Math.max(0, weightFn(it)); total += v; return v; });
    if (total <= 0) return null;
    let roll = this.next() * total;
    for (let i = 0; i < arr.length; i++) { roll -= w[i]; if (roll <= 0) return arr[i]; }
    return arr[arr.length - 1];
  }
  /** dice: sides n, count c → sum */
  dice(c, n) { let s = 0; for (let i = 0; i < c; i++) s += this.int(1, n); return s; }
  /** parse + roll "2d6+1" style notation → {total, rolls, mod} */
  roll(notation) {
    const m = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(notation.trim());
    if (!m) throw new Error(`bad dice notation: ${notation}`);
    const c = m[1] ? Number(m[1]) : 1, n = Number(m[2]), mod = m[3] ? Number(m[3]) : 0;
    const rolls = [];
    for (let i = 0; i < c; i++) rolls.push(this.int(1, n));
    return { total: rolls.reduce((a, b) => a + b, 0) + mod, rolls, mod };
  }
  /** serialize position by replaying draw count on load */
  state() { return { seed: this.seed, draws: this.draws }; }
  /** @param {{seed:number, draws:number}} s */
  static from(s) {
    const r = new RngStream(s.seed);
    for (let i = 0; i < s.draws; i++) r.next();
    return r;
  }

  /**
   * Wind THIS stream to a saved position, in place.
   *
   * Restoring by REPLACING the object cannot work: consumers capture their
   * stream once at construction (`rng: this.rng.stream('cards')`), so a swapped
   * instance leaves every one of them holding the old one.
   * @param {{seed:number, draws:number}} s
   */
  restore(s) {
    this.seed = s.seed >>> 0;
    // `this.seed` is the ORIGINAL seed and never moves; the live position lives
    // in the `_next` closure. Rebuilding it is what actually rewinds the stream
    // — setting the seed field alone leaves the closure exactly where it was.
    this._next = mulberry32(this.seed);
    this.draws = 0;
    for (let i = 0; i < s.draws; i++) this.next();
  }
}

export class Rng {
  /** @param {number|string} baseSeed */
  constructor(baseSeed) {
    this.baseSeed = typeof baseSeed === 'string' ? hashStr(baseSeed) : baseSeed >>> 0;
    /** @type {Map<string, RngStream>} */
    this.streams = new Map();
  }
  /** @param {string} name @returns {RngStream} */
  stream(name) {
    let s = this.streams.get(name);
    if (!s) this.streams.set(name, (s = new RngStream((this.baseSeed ^ hashStr(name)) >>> 0)));
    return s;
  }
  serialize() {
    /** @type {Record<string, {seed:number,draws:number}>} */
    const out = {};
    for (const [k, v] of this.streams) out[k] = v.state();
    return { baseSeed: this.baseSeed, streams: out };
  }
  /** @param {{baseSeed:number, streams:Record<string,{seed:number,draws:number}>}} data */
  static deserialize(data) {
    const r = new Rng(data.baseSeed);
    for (const [k, s] of Object.entries(data.streams)) r.streams.set(k, RngStream.from(s));
    return r;
  }

  /**
   * Restore saved stream positions onto THIS instance.
   *
   * `deserialize()` builds a fresh Rng, which is right for tests and wrong for
   * loading a save: the App hands `rng.stream(name)` out at construction and
   * every system holds its own reference, so swapping app.rng leaves them all
   * pointing at the pre-load object. save.js consequently captured rng state and
   * never restored it — deserialize() had zero call sites in src/ — so a seeded
   * run stopped being reproducible the moment you loaded it.
   *
   * Restoring in place fixes every captured reference at once.
   * @param {{baseSeed:number, streams:Record<string,{seed:number,draws:number}>}} data
   */
  restore(data) {
    if (!data || typeof data.baseSeed !== 'number') return false;
    this.baseSeed = data.baseSeed >>> 0;
    for (const [name, st] of Object.entries(data.streams || {})) {
      // stream() creates it if this session has not touched that stream yet
      this.stream(name).restore(st);
    }
    return true;
  }
}
