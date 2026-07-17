// @ts-check
// Persistent meta-progression: run history + codex of discovered lore/easter
// eggs + light unlocks. Survives perma-death by design. No power creep.

const KEY = 'ncld.meta';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { runs: [], codex: [], unlocks: [] };
  } catch {
    return { runs: [], codex: [], unlocks: [] };
  }
}

export const meta = load();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(meta)); } catch { }
}

/**
 * @param {{days:number, kills:number, endedBy:string, bonds:Record<string,number>,
 *          eventsSurvived:number, choices:number}} summary
 */
export function recordRun(summary) {
  meta.runs.push({ ...summary, at: Date.now() });
  persist();
}

/** @param {string} id @param {string} title @param {string} text */
export function addCodex(id, title, text) {
  if (meta.codex.some((c) => c.id === id)) return false;
  meta.codex.push({ id, title, text, at: Date.now() });
  persist();
  return true;
}

/** @param {string} id */
export function unlock(id) {
  if (meta.unlocks.includes(id)) return false;
  meta.unlocks.push(id);
  persist();
  return true;
}
