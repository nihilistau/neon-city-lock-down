// @ts-check
// Routes a line to audio, in priority order:
//   1. baked WAV (manifest hit by lineKey)
//   2. live sidecar (POST /speak) for dynamic/LLM lines, cached in IndexedDB
//   3. procedural VOX/radio synth for synthetic characters
//   4. subtitle-only + a soft prosodic mouth flutter (never fake human speech)
import { audio } from '../audio/engine.js';
import { emit } from '../core/bus.js';
import { settings } from '../core/settings.js';
import { TALK_PROFILES, sayTalk } from '../audio/talkSynth.js';

export class TtsRouter {
  /**
   * @param {{ voice?: import('../audio/voice.js').Voice,
   *           sidecar?: import('../audio/sidecar.js').Sidecar,
   *           vox?: import('../audio/voxVoice.js').VoxVoice,
   *           voiceCast?: Record<string,string> }} deps
   */
  constructor(deps = {}) {
    this.voice = deps.voice || null;
    this.sidecar = deps.sidecar || null;
    this.vox = deps.vox || null;
    this.voiceCast = deps.voiceCast || {};
    this.enabled = true;
  }

  /**
   * @param {import('../chars/character.js').Character} char
   * @param {import('../core/types.js').CompiledLine} compiled
   * @param {string} lineKey
   */
  async speak(char, compiled, lineKey) {
    if (!this.enabled || !audio.ctx) { this._flutter(char, compiled.cleanText.length); return; }
    const text = compiled.cleanText;

    // 1. baked
    if (this.voice?.hasLine(lineKey)) {
      const ok = await this.voice.speakLine(char, compiled, lineKey);
      if (ok) return;
    }
    // 2. VOX is a synth identity, not a human take
    if (char.id === 'vox' && this.vox) {
      audio.duckStart();
      const dur = this.vox.say(text);
      setTimeout(() => audio.duckEnd(), dur * 1000);
      return;
    }
    // 3. optional live sidecar (off by default — the vendored engine fades out)
    if (settings.tts?.useSidecar && this.sidecar?.healthy) {
      const voice = this.voiceCast[char.id] || 'casual_female';
      const buf = await this.sidecar.synth(text, voice);
      if (buf) { this._playBuffer(char, buf); return; }
    }
    // 4. procedural formant talk — always-on fallback so unbaked lines have a voice
    const profile = TALK_PROFILES[char.id] || TALK_PROFILES.player;
    const pitched = { ...profile };
    if (char.id === 'player' && settings.playerPronouns === 'he') pitched.pitch = 112;
    audio.duckStart();
    const dur = sayTalk(audio, pitched, text, char.actor?.face, char.id);
    if (dur > 0) {
      setTimeout(() => audio.duckEnd(), dur * 1000);
      return;
    }
    audio.duckEnd();
    // 5. subtitle-only + soft mouth flutter if audio isn't up yet
    this._flutter(char, text.length);
  }

  _playBuffer(char, buf) {
    const ctx = audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser); analyser.connect(audio.bus('voice'));
    audio.duckStart();
    src.start();
    const data = new Uint8Array(analyser.frequencyBinCount);
    const face = char.actor.face;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0; for (let i = 2; i < 40; i++) sum += data[i];
      face.setTalk(Math.min(1, sum / 38 / 90));
      if (src.buffer && ctx.currentTime < src._end) requestAnimationFrame(tick);
    };
    src._end = ctx.currentTime + buf.duration;
    tick();
    src.onended = () => { face.setTalk(0); audio.duckEnd(); };
  }

  /** Soft prosodic mouth movement — NOT synthesized speech; a placeholder. */
  _flutter(char, len) {
    const dur = Math.min(4, 0.5 + len * 0.045);
    const start = performance.now();
    const face = char.actor.face;
    emit('voice.speaking', { id: char.id, dur, silent: true });
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      if (t >= dur) { face.setTalk(0); emit('voice.done', { id: char.id }); return; }
      face.setTalk(0.25 + 0.35 * Math.abs(Math.sin(t * 20)) * (0.6 + 0.4 * Math.sin(t * 4.5)));
      requestAnimationFrame(tick);
    };
    tick();
  }
}
