// @ts-check
// Runtime engine-config store. Loads editable YAML (config/<group>.yaml) over the
// baked defaults (data/configDefaults.js) at boot, exposes cfg('group.path') reads,
// and can save edits back to disk via the config API (tools/configApi.mjs).
//
// Non-breaking: the store is seeded from CONFIG_DEFAULTS, so before/without any
// config/ files the game behaves exactly as the hardcoded constants did.
//
// Node-safe: this module imports only pure data + the bus, so unit tests that
// reach it through pure modules (resolver, cover) get default values. js-yaml is
// dynamically imported ONLY inside the browser-only load/save paths, so Node
// (which lacks the import map) never resolves the bare 'js-yaml' specifier.
import { emit } from './bus.js';
import { CONFIG_DEFAULTS } from '../../data/configDefaults.js';
import { validateConfig } from '../../data/configSchema.js';

/** live, merged config (defaults ⊕ loaded YAML ⊕ live edits) */
let _store = structuredClone(CONFIG_DEFAULTS);

/** deep-merge `over` onto a clone of `base` (objects merge, scalars/arrays replace) */
function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!over || typeof over !== 'object') return out;
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? merge(base[k], v) : v;
  }
  return out;
}

/**
 * Dotted paths, already split. `cfg()` is called from the render loop by the
 * animator, the camera director, the lighting system and combat — measured at
 * roughly thirty calls per frame — and `path.split('.')` allocated an array
 * plus one substring per segment on EVERY one of them, so a single line here
 * was producing well over a hundred short-lived objects per frame for the GC.
 *
 * Paths are compile-time literals from a fixed vocabulary, so this map is
 * bounded by the number of distinct paths in the source and never grows with
 * runtime data.
 * @type {Map<string, string[]>}
 */
const _pathCache = new Map();

/**
 * Read a dotted config path. cfg('camera.thirdPerson.shoulderDist').
 * @param {string} path @param {any} [fallback]
 */
export function cfg(path, fallback) {
  let keys = _pathCache.get(path);
  if (keys === undefined) { keys = path.split('.'); _pathCache.set(path, keys); }
  let o = _store;
  for (let i = 0; i < keys.length; i++) {
    if (o == null || typeof o !== 'object') return fallback;
    o = o[keys[i]];
  }
  return o === undefined ? fallback : o;
}

/** the whole merged store (read-only use). */
export function getConfig() { return _store; }

/** replace the entire store (used by tests / hard resets). */
export function _setConfigStore(next) { _store = next; }

/**
 * Merge a validated group into the live store and notify listeners.
 * @param {string} group @param {any} obj @returns {string[]} validation errors (merge skipped if any)
 */
export function applyConfig(group, obj) {
  const errs = validateConfig(group, obj);
  if (errs.length) return errs;
  // merge the edit over the CURRENT store so a PARTIAL edit keeps loaded-YAML +
  // prior-edit values (not just baked defaults); clone-fallback if the group is new
  _store[group] = merge(_store[group] ?? structuredClone(CONFIG_DEFAULTS[group] ?? {}), obj);
  emit('config.changed', { group });
  return [];
}

/**
 * Fetch every config/<group>.yaml, validate, and merge over defaults. Missing
 * files keep defaults; invalid files are skipped with a console warning (the
 * game still boots). Returns a summary. Browser-only (uses fetch + js-yaml).
 * @param {typeof fetch} [fetchImpl]
 */
export async function loadConfig(fetchImpl = (typeof fetch !== 'undefined' ? fetch : null)) {
  const summary = { loaded: [], missing: [], errors: [] };
  if (!fetchImpl) return summary;
  let YAML;
  try { YAML = await import('js-yaml'); } catch { return summary; }
  for (const group of Object.keys(CONFIG_DEFAULTS)) {
    try {
      const res = await fetchImpl(`/config/${group}.yaml`, { cache: 'no-store' });
      if (!res.ok) { summary.missing.push(group); continue; }
      const text = await res.text();
      const parsed = YAML.load(text) || {};
      const errs = validateConfig(group, parsed);
      if (errs.length) { summary.errors.push({ group, errs }); console.warn(`[config] ${group}.yaml invalid, using defaults:`, errs); continue; }
      // merge over a FRESH deep clone of the defaults so the store never aliases
      // (and thus can't mutate) the shared CONFIG_DEFAULTS objects
      _store[group] = merge(structuredClone(CONFIG_DEFAULTS[group]), parsed);
      summary.loaded.push(group);
    } catch (err) {
      summary.errors.push({ group, errs: [String(err)] });
    }
  }
  emit('config.loaded', summary);
  return summary;
}

/**
 * Validate + persist a group to config/<group>.yaml via the config API, then
 * apply it live. Returns { ok, errors }. Browser-only.
 * @param {string} group @param {any} obj
 */
export async function saveConfigFile(group, obj) {
  const errs = validateConfig(group, obj);
  if (errs.length) return { ok: false, errors: errs };
  let YAML;
  try { YAML = await import('js-yaml'); } catch { return { ok: false, errors: ['js-yaml unavailable'] }; }
  const yaml = YAML.dump(obj, { indent: 2, lineWidth: 100, noRefs: true });
  try {
    const res = await fetch(`/api/config/${group}.yaml`, {
      method: 'POST', headers: { 'Content-Type': 'text/yaml' }, body: yaml,
    });
    if (!res.ok) return { ok: false, errors: [`server ${res.status}: ${await res.text().catch(() => '')}`] };
  } catch (err) {
    return { ok: false, errors: [String(err)] };
  }
  applyConfig(group, obj);
  return { ok: true, errors: [] };
}
