// @ts-check
// Routes a line to audio: baked WAV (manifest) → live sidecar → procedural synth
// (VOX/radio) → subtitle-only. Fully wired in P1.6; this shell no-ops safely and
// drives the face mouth from a placeholder envelope so lips move even pre-bake.

export class TtsRouter {
  /** @param {{ voice?: any, sidecar?: any, manifest?: any }} [deps] */
  constructor(deps = {}) {
    this.voice = deps.voice || null;
    this.sidecar = deps.sidecar || null;
    this.manifest = deps.manifest || {};
    this.enabled = true;
  }

  /**
   * @param {import('../chars/character.js').Character} char
   * @param {import('../core/types.js').CompiledLine} compiled
   * @param {string} lineKey
   */
  async speak(char, compiled, lineKey) {
    if (!this.enabled) return;
    if (this.voice) {
      await this.voice.speakLine(char, compiled, lineKey);
    } else {
      // placeholder: drive mouth from a synthetic talking envelope
      this._fakeTalk(char, compiled.cleanText.length);
    }
  }

  _fakeTalk(char, len) {
    const dur = Math.min(4, 0.5 + len * 0.045);
    const start = performance.now();
    const face = char.actor.face;
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      if (t >= dur) { face.setTalk(0); return; }
      face.setTalk(0.3 + 0.4 * Math.abs(Math.sin(t * 22)) * (0.6 + 0.4 * Math.sin(t * 5)));
      requestAnimationFrame(tick);
    };
    tick();
  }
}
