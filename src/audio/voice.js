// @ts-check
// Baked-voice playback. Fetches WAVs on first use (LRU-decoded cache), plays into
// the voice bus through an AnalyserNode that drives the speaking character's mouth
// amplitude, ducks music/ambience for the duration, and paces subtitles.
import { audio } from './engine.js';
import { emit } from '../core/bus.js';

export class Voice {
  /** @param {Record<string, any>} manifest lineId → {file, duration, voice} */
  constructor(manifest) {
    this.manifest = manifest || {};
    /** @type {Map<string, AudioBuffer>} */
    this.cache = new Map();
    this.cacheOrder = [];
    this.maxCache = 60;
    /** @type {{src:AudioBufferSourceNode, analyser:AnalyserNode, char:any}|null} */
    this.active = null;
  }

  hasLine(lineKey) { return !!this.manifest[lineKey]; }

  /**
   * Speak a compiled line for a character if a baked take exists.
   * @param {import('../chars/character.js').Character} char
   * @param {import('../core/types.js').CompiledLine} compiled
   * @param {string} lineKey
   * @returns {Promise<boolean>} whether baked audio played
   */
  async speakLine(char, compiled, lineKey) {
    const entry = this.manifest[lineKey];
    if (!entry || !audio.ctx) return false;
    let buf;
    try {
      buf = await this._load(lineKey, entry.file);
    } catch {
      return false;
    }
    this._stopActive();

    const ctx = audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    src.connect(analyser); analyser.connect(gain); gain.connect(audio.bus('voice'));

    audio.duckStart();
    src.start();
    this.active = { src, analyser, char };
    this._pumpMouth(char, analyser);
    emit('voice.speaking', { id: char.id, lineKey, dur: entry.duration });

    src.onended = () => {
      if (this.active?.src === src) { this.active = null; char.actor.face.setTalk(0); }
      audio.duckEnd();
      emit('voice.done', { id: char.id });
    };
    return true;
  }

  _pumpMouth(char, analyser) {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const face = char.actor.face;
    const tick = () => {
      if (this.active?.char !== char) return;
      analyser.getByteFrequencyData(data);
      // emphasise vocal band bins for mouth movement
      let sum = 0;
      const lo = 2, hi = Math.min(40, data.length);
      for (let i = lo; i < hi; i++) sum += data[i];
      const raw = (sum / (hi - lo)) / 150;
      // gamma curve keeps the mouth from pinning open on loud vowels
      const amp = Math.min(1, Math.pow(raw, 1.3) * 1.15);
      face.setTalk(amp);
      requestAnimationFrame(tick);
    };
    tick();
  }

  _stopActive() {
    if (this.active) {
      try { this.active.src.stop(); } catch { }
      this.active.char.actor.face.setTalk(0);
      this.active = null;
    }
  }

  async _load(key, file) {
    let buf = this.cache.get(key);
    if (buf) return buf;
    const res = await fetch('/' + file.replace(/\\/g, '/'));
    if (!res.ok) throw new Error(`voice fetch ${res.status}`);
    const arr = await res.arrayBuffer();
    buf = await audio.ctx.decodeAudioData(arr);
    this.cache.set(key, buf);
    this.cacheOrder.push(key);
    if (this.cacheOrder.length > this.maxCache) {
      const evict = this.cacheOrder.shift();
      this.cache.delete(evict);
    }
    return buf;
  }
}
