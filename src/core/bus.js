// @ts-check
// Event bus — the ONLY channel between UI, sim, and 3D layers.
// Topics are dot-namespaced strings: 'world.tick', 'char.stat', 'dialogue.turn', …
// Subscribe to '*' to observe everything (activity feed, debug).

/** @type {Map<string, Set<Function>>} */
const subs = new Map();

/**
 * @param {string} topic
 * @param {(payload:any, topic:string)=>void} fn
 * @returns {() => void} unsubscribe
 */
export function on(topic, fn) {
  let set = subs.get(topic);
  if (!set) subs.set(topic, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

/**
 * @param {string} topic
 * @param {(payload:any, topic:string)=>void} fn
 */
export function once(topic, fn) {
  const off = on(topic, (payload, t) => { off(); fn(payload, t); });
  return off;
}

/**
 * @param {string} topic
 * @param {any} [payload]
 */
export function emit(topic, payload) {
  const set = subs.get(topic);
  if (set) for (const fn of [...set]) fn(payload, topic);
  const all = subs.get('*');
  if (all) for (const fn of [...all]) fn(payload, topic);
}

/** Remove every subscription (used by tests and full restarts). */
export function resetBus() {
  subs.clear();
}
