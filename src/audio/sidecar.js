// @ts-check
// Optional live-TTS sidecar client. Probes a localhost voxtral wrapper; when
// healthy, dynamic (un-baked, non-LLM or LLM) lines can be voiced at runtime and
// cached in IndexedDB by text hash. Safe no-op when the sidecar is absent.
import { settings } from '../core/settings.js';
import { audio } from './engine.js';

const DB_NAME = 'ncld-tts-cache';

export class Sidecar {
  constructor() {
    this.healthy = false;
    this.voices = [];
    this._db = null;
  }

  async probe() {
    if (!settings.tts.useSidecar) { this.healthy = false; return false; }
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 1200);
      const res = await fetch(`${settings.tts.sidecarUrl.replace(/\/$/, '')}/health`, { signal: ctrl.signal });
      clearTimeout(to);
      if (!res.ok) { this.healthy = false; return false; }
      const data = await res.json();
      this.healthy = !!data.ok;
      this.voices = data.voices || [];
      return this.healthy;
    } catch {
      this.healthy = false;
      return false;
    }
  }

  /**
   * Fetch (or cache-hit) audio for text+voice → AudioBuffer, or null.
   * @param {string} text @param {string} voice
   * @returns {Promise<AudioBuffer|null>}
   */
  async synth(text, voice) {
    if (!this.healthy || !audio.ctx) return null;
    const key = `${voice}|${text}`;
    const cached = await this._dbGet(key);
    if (cached) return audio.ctx.decodeAudioData(cached.slice(0));
    try {
      const res = await fetch(`${settings.tts.sidecarUrl.replace(/\/$/, '')}/speak`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
      });
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      this._dbPut(key, arr);
      return audio.ctx.decodeAudioData(arr.slice(0));
    } catch {
      return null;
    }
  }

  async _openDb() {
    if (this._db) return this._db;
    return new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('wav');
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => resolve(null);
    });
  }
  async _dbGet(key) {
    const db = await this._openDb(); if (!db) return null;
    return new Promise((resolve) => {
      const r = db.transaction('wav').objectStore('wav').get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  }
  async _dbPut(key, arr) {
    const db = await this._openDb(); if (!db) return;
    db.transaction('wav', 'readwrite').objectStore('wav').put(arr, key);
  }
}
