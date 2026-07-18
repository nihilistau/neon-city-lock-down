// @ts-check
// Persistent player settings (NOT run state — that's save.js).
import { emit } from './bus.js';

const KEY = 'ncld.settings';

const DEFAULTS = {
  confirmed18: false,
  playerName: 'Cipher',
  playerPronouns: 'she',         // 'she' (Female) | 'he' (Male)
  explicitness: 'mature',        // 'suggestive' | 'mature' | 'full'
  volumes: { master: 0.8, music: 0.7, sfx: 0.8, ambience: 0.7, voice: 1.0, ui: 0.6 },
  cameraMode: 'director',        // 'director' | 'firstPerson'
  mouseSensitivity: 1,           // 0.3 .. 2.5 multiplier for first-person look
  subtitleScale: 1,
  // LLM connection is handled server-side by the static-server proxy (keeps the
  // API token off the client). `enabled` turns the adapter on; `agentMode` lets
  // the LLM AUTHOR each reply + drive the scene, vs. only restyling authored text.
  // chatModel/functionModel: default model keys the engine uses ('' = whatever's
  // loaded). charModels: per-character override — 'default' | 'authored' | <key>.
  // thinking: let reasoning models think before replying (slower, sometimes
  // richer) vs. reply directly (/no_think — fast, clean). Default off = snappy.
  llm: { enabled: false, agentMode: true, thinking: false, temperature: 0.85, reasoning: 'off', chatModel: '', functionModel: '', charModels: {}, charModes: {}, baseUrl: 'http://localhost:1234/v1', apiKey: '', model: '' },
  tts: { sidecarUrl: 'http://localhost:8425', useSidecar: true },
  debug: false,
};

/** deep-merge stored over defaults so new fields appear after updates */
function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!over || typeof over !== 'object') return out;
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? merge(base[k], v) : v;
  }
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? merge(DEFAULTS, JSON.parse(raw)) : merge(DEFAULTS, {});
  } catch {
    return merge(DEFAULTS, {});
  }
}

export const settings = load();

/** Persist current settings and notify listeners ('settings.changed'). */
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage full/blocked */ }
  emit('settings.changed', settings);
}

/**
 * Set a dotted path, persist, notify. set('llm.enabled', true)
 * @param {string} path @param {any} value
 */
export function setSetting(path, value) {
  const keys = path.split('.');
  let obj = settings;
  for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
  obj[keys[keys.length - 1]] = value;
  saveSettings();
}
