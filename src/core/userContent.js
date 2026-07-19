// @ts-check
// User-content layer for the Scenario Creation Toolkit. At boot, fetches the
// user's authored scenarios / events / cutscenes / dialogue (JSON under user/,
// served by tools/userApi.mjs) and registers them alongside the built-ins:
//   scenarios/events → merged into the exported SCENARIOS / EVENTS maps
//   cutscenes        → a name→steps registry (played via app.cutscene.play)
//   dialogue         → registerTopics() (same registry as data/dialogue/*)
//
// FAIL-SOFT: every file is validated + registered in isolation; a bad file is
// skipped with a collected error (surfaced in the Kit panel) and NEVER crashes
// boot. Built-in content is untouched.
import { emit } from './bus.js';
import { SCENARIOS } from '../../data/scenarios.js';
import { EVENTS } from '../../data/events.js';
import { topic } from '../../data/schema.js';
import { registerTopics } from '../dialogue/topics.js';

const CATS = ['scenarios', 'events', 'cutscenes', 'dialogue'];

/** name → cutscene step list */
export const userCutscenes = new Map();
/** ids of user-registered scenarios/events (for the editor to list + distinguish) */
export const userIndex = { scenarios: [], events: [], cutscenes: [], dialogue: [], errors: [] };

/** wrap a user event's numeric weight into the (run,clock)→number the sim expects */
function wrapEvent(e) {
  const base = typeof e.weight === 'number' ? e.weight : 1;
  const scale = Number(e.weightThreatScale) || 0;
  return { ...e, weight: (run) => Math.max(0, base + (run?.threat || 0) * scale) };
}

/** register one parsed item into the live game. Throws on invalid content. */
export function registerUserItem(cat, name, data) {
  if (cat === 'scenarios') {
    if (!data.id || !data.title) throw new Error('scenario needs id + title');
    SCENARIOS[data.id] = data;
    if (!userIndex.scenarios.includes(data.id)) userIndex.scenarios.push(data.id);
  } else if (cat === 'events') {
    if (!data.id || !Array.isArray(data.script)) throw new Error('event needs id + script[]');
    EVENTS[data.id] = wrapEvent(data);
    if (!userIndex.events.includes(data.id)) userIndex.events.push(data.id);
  } else if (cat === 'cutscenes') {
    const steps = Array.isArray(data) ? data : data.steps;
    if (!Array.isArray(steps)) throw new Error('cutscene needs a steps[] array');
    userCutscenes.set(name, steps);
    if (!userIndex.cutscenes.includes(name)) userIndex.cutscenes.push(name);
  } else if (cat === 'dialogue') {
    const topics = Array.isArray(data) ? data : (data.topics || [data]);
    for (const t of topics) registerTopics([topic(t.id, t)]);  // topic() validates, may throw
    if (!userIndex.dialogue.includes(name)) userIndex.dialogue.push(name);
  } else {
    throw new Error(`unknown category ${cat}`);
  }
}

/**
 * Load + register all user content. Browser-only (uses fetch). Returns a summary.
 * @param {typeof fetch} [fetchImpl]
 */
export async function loadUserContent(fetchImpl = (typeof fetch !== 'undefined' ? fetch : null)) {
  userIndex.errors = [];
  if (!fetchImpl) return userIndex;
  let index;
  try {
    const res = await fetchImpl('/api/user', { cache: 'no-store' });
    if (!res.ok) return userIndex;
    index = await res.json();
  } catch { return userIndex; }

  for (const cat of CATS) {
    for (const name of index[cat] || []) {
      try {
        const res = await fetchImpl(`/api/user/${cat}/${name}.json`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`http ${res.status}`);
        registerUserItem(cat, name, await res.json());
      } catch (err) {
        userIndex.errors.push({ cat, name, error: String(err?.message || err) });
        console.warn(`[user content] skipped ${cat}/${name}:`, err?.message || err);
      }
    }
  }
  emit('usercontent.loaded', userIndex);
  return userIndex;
}
