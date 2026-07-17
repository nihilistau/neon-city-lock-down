// @ts-check
// Cutscene player: a ScriptRunner vocabulary for cinematic camera moves,
// letterboxing, title cards, subtitled+voiced lines, cast staging. The world
// sim pauses (render continues); Space/click skips the current line's wait.
import * as THREE from 'three';
import { ScriptRunner } from '../core/script.js';
import { audio } from '../audio/engine.js';

export class CutscenePlayer {
  /**
   * @param {Object} deps
   * @param {import('../scene3d/stage.js').Stage} deps.stage
   * @param {import('../camera/cameraRig.js').CameraRig} deps.cameraRig
   * @param {import('../core/loop.js').Loop} deps.loop
   * @param {Record<string, import('../chars/character.js').Character>} deps.cast
   * @param {import('../audio/voice.js').Voice} deps.voiceBank
   * @param {import('../audio/voxVoice.js').VoxVoice} deps.vox
   * @param {any} deps.lighting
   */
  constructor(deps) {
    this.d = deps;
    this.runner = new ScriptRunner('cutscene');
    this.playing = false;
    this._skip = false;
    this._buildChrome();

    const d = deps;
    this.runner.register({
      shot: (s) => this._shot(s),
      line: (s) => this._line(s),
      titleCard: (s) => this._titleCard(s),
      light: (s) => { d.lighting.apply(s.preset, s.fade ?? 1.2); },
      anim: (s) => { d.cast[s.char]?.actor.playClip(s.clip, 0.3); },
      face: (s) => { d.cast[s.char]?.actor.face.setExpression(s.expr); },
      look: (s) => {
        const target = s.target === 'camera' ? d.stage.camera : d.cast[s.target]?.actor.root;
        d.cast[s.char]?.actor.lookAt(target || null);
      },
      teleport: (s) => {
        const c = d.cast[s.char];
        if (c) { c.queue.clear(); c.actor.root.position.set(s.at[0], 0, s.at[1]); c.actor.faceYaw(s.yaw ?? 0); }
      },
      wait: (s) => this._wait(s.sec),
    });

    document.addEventListener('keydown', (e) => {
      if (this.playing && e.code === 'Space') this._skip = true;
    });
  }

  _buildChrome() {
    const ui = document.getElementById('ui');
    this.lbTop = document.createElement('div');
    this.lbTop.className = 'letterbox top';
    this.lbBottom = document.createElement('div');
    this.lbBottom.className = 'letterbox bottom';
    this.titleEl = document.createElement('div');
    this.titleEl.id = 'titlecard';
    ui.append(this.lbTop, this.lbBottom, this.titleEl);
  }

  /** @param {any[]} steps */
  async play(steps) {
    if (this.playing) return;
    this.playing = true;
    this._skip = false;
    const d = this.d;
    d.loop.pause('cutscene');
    const prevMode = d.cameraRig.mode;
    d.cameraRig.setMode('cinematic');
    document.body.classList.add('cinema');
    this.lbTop.classList.add('active');
    this.lbBottom.classList.add('active');
    try {
      await this.runner.run(steps, {});
    } finally {
      this.lbTop.classList.remove('active');
      this.lbBottom.classList.remove('active');
      this.titleEl.classList.remove('visible');
      document.body.classList.remove('cinema');
      d.cameraRig.setMode(prevMode === 'cinematic' ? 'director' : prevMode);
      d.loop.resume('cutscene');
      this.playing = false;
      this._clearSubtitle();
    }
  }

  async _wait(sec) {
    const step = 0.05;
    let t = 0;
    while (t < sec && !this._skip) {
      await new Promise((r) => setTimeout(r, step * 1000));
      t += step;
    }
    this._skip = false;
  }

  /** camera flight: from → to (world), easing, look at fixed point or a character */
  async _shot(s) {
    const cam = this.d.stage.camera;
    const from = new THREE.Vector3(...s.from);
    const to = new THREE.Vector3(...(s.to || s.from));
    const dur = s.dur ?? 4;
    const lookTarget = s.lookChar
      ? () => this.d.cast[s.lookChar].actor.rig.byName.head.getWorldPosition(new THREE.Vector3())
      : () => new THREE.Vector3(...(s.look || [0, 1.4, 0]));
    const t0 = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        const raw = Math.min(1, (performance.now() - t0) / (dur * 1000));
        const k = raw * raw * (3 - 2 * raw);
        cam.position.lerpVectors(from, to, k);
        cam.lookAt(lookTarget());
        if (raw >= 1 || this._skip) { this._skip = false; resolve(); return; }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  /** subtitled voiced line — baked take by id if available */
  async _line(s) {
    const speaker = s.speaker ? this.d.cast[s.speaker] : null;
    const name = speaker?.name || (s.speaker === 'vox' ? 'VOX' : s.name || '');
    this._subtitle(name, s.text, speaker?.persona.accent);

    let dur = Math.min(6, 1 + s.text.length * 0.05);
    const entry = s.bakedId && this.d.voiceBank?.manifest[s.bakedId];
    if (entry && audio.ctx) {
      dur = entry.duration + 0.3;
      if (speaker) {
        this.d.voiceBank.speakLine(speaker, { cleanText: s.text, directions: [] }, s.bakedId);
      } else {
        // narration / VOX baked take without a body
        try {
          const buf = await this.d.voiceBank._load(s.bakedId, entry.file);
          const src = audio.ctx.createBufferSource();
          src.buffer = buf;
          src.connect(audio.bus('voice'));
          audio.duckStart();
          src.start();
          src.onended = () => audio.duckEnd();
        } catch { }
      }
    } else if (s.speaker === 'vox') {
      dur = this.d.vox.say(s.text) + 0.3;
    }
    await this._wait(dur);
    this._clearSubtitle();
  }

  _subtitle(name, text, accent) {
    const el = document.getElementById('subtitles');
    el.innerHTML = `<div class="line">${name ? `<span class="speaker" ${accent ? `style="color:${accent}"` : ''}>${name}</span>` : ''}${text}</div>`;
  }
  _clearSubtitle() {
    document.getElementById('subtitles').innerHTML = '';
  }

  async _titleCard(s) {
    this.titleEl.innerHTML = `
      <div class="tc-main neon-title">${s.text}</div>
      ${s.sub ? `<div class="tc-sub">${s.sub}</div>` : ''}`;
    this.titleEl.classList.add('visible');
    await this._wait(s.dur ?? 3);
    this.titleEl.classList.remove('visible');
    await this._wait(0.8);
  }
}
