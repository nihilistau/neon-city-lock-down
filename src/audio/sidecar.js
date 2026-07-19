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

  // ── Voice Controls panel API (src/ui/voicePanel.js) ──────────────────────
  _url(path) { return settings.tts.sidecarUrl.replace(/\/$/, '') + path; }

  /** all voices (preset + user) as [{name, kind}]. (Named listVoices to avoid
   *  clashing with the `this.voices` array set by probe().) */
  async listVoices() {
    try { const r = await fetch(this._url('/voices')); return r.ok ? (await r.json()).voices : []; }
    catch { return []; }
  }

  /** saved clips + available voices: { clips:[file], voices:[{name,kind}] }. */
  async library() {
    try { const r = await fetch(this._url('/library')); return r.ok ? await r.json() : { clips: [], voices: [] }; }
    catch { return { clips: [], voices: [] }; }
  }

  /** synth one line at a chosen euler → ArrayBuffer (bypasses the char-line cache). */
  async speakRaw(text, voice, euler) {
    try {
      const r = await fetch(this._url('/speak'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice, euler }) });
      return r.ok ? await r.arrayBuffer() : null;
    } catch { return null; }
  }

  /** synth long text (chunked + concatenated) → { audio:ArrayBuffer, saved:string|null }. */
  async synthLong(text, voice, euler, { save = false, name = '' } = {}) {
    try {
      const r = await fetch(this._url('/synthLong'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice, euler, save, name }) });
      if (!r.ok) return null;
      return { audio: await r.arrayBuffer(), saved: r.headers.get('X-Saved') };
    } catch { return null; }
  }

  /** save a clip (base64) to the library, or bake a character line. */
  async save(payload) {
    try { const r = await fetch(this._url('/save'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); return r.ok ? await r.json() : { ok: false, error: `http ${r.status}` }; }
    catch (e) { return { ok: false, error: String(e) }; }
  }

  /** clone a voice from a reference clip (base64) → { status, ... }. */
  async clone(payload) {
    try { const r = await fetch(this._url('/clone'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }
    catch (e) { return { status: 0, error: String(e) }; }
  }

  /** URL of a saved clip for an <audio> element. */
  clipUrl(file) { return this._url('/clip?file=' + encodeURIComponent(file)); }

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
