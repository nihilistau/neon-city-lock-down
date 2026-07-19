// @ts-check
// Node-side config loader. The browser gets config via src/core/config.js
// (fetch); server code (gameEngine.mjs) reads the same config/*.yaml straight
// from disk over the baked defaults. Synchronous, loaded once at import.
import { readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from '../vendor/js-yaml.mjs';
import { CONFIG_DEFAULTS } from '../data/configDefaults.js';
import { validateConfig } from '../data/configSchema.js';

export const ROOT_DIR = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const CONFIG_DIR = join(ROOT_DIR, 'config');

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!over || typeof over !== 'object') return out;
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? merge(base[k], v) : v;
  }
  return out;
}

let _store = structuredClone(CONFIG_DEFAULTS);

function loadAll() {
  const next = structuredClone(CONFIG_DEFAULTS);
  for (const group of Object.keys(CONFIG_DEFAULTS)) {
    try {
      const parsed = load(readFileSync(join(CONFIG_DIR, `${group}.yaml`), 'utf8')) || {};
      if (!validateConfig(group, parsed).length) next[group] = merge(structuredClone(CONFIG_DEFAULTS[group]), parsed);
      else console.warn(`[serverConfig] ${group}.yaml invalid, using defaults`);
    } catch { /* missing file → defaults */ }
  }
  _store = next;
}
loadAll();

/** Re-read config/*.yaml from disk (called after a config-API write so per-request
 *  reads like sampling go live without a full server restart). */
export function reloadServerConfig() { loadAll(); }

/** Read a dotted config path from the disk-loaded server config. */
export function scfg(path, fallback) {
  let o = _store;
  for (const k of path.split('.')) {
    if (o == null || typeof o !== 'object') return fallback;
    o = o[k];
  }
  return o === undefined ? fallback : o;
}
