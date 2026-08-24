// @ts-check
// Cutscene player: a ScriptRunner vocabulary for cinematic camera moves,
// letterboxing, title cards, subtitled+voiced lines, cast staging. The world
// sim pauses (render continues); Space/click skips the current line's wait.
import * as THREE from 'three';

// scratch for the per-frame look target — this ran every frame of every shot
const _scratch = new THREE.Vector3();
const _fallbackLook = new THREE.Vector3(0, 1.4, 0);
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
    /** @type {Set<() => void>} things a Space press should resolve immediately */
    this._skipResolvers = new Set();
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
      if (!this.playing || e.code !== 'Space') return;
      this._skip = true;
      // Poking the flag is not enough when the thing waiting on it is an rAF
      // loop in a hidden tab: nothing is running to notice. Anything currently
      // waiting registers a resolver so a skip reaches it directly.
      for (const fn of [...this._skipResolvers]) fn();
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
    // A LAST-RESORT WATCHDOG.
    //
    // The specific rAF stall below is fixed, but the failure mode it caused is
    // severe enough to deserve a floor under it: while a cutscene runs, the sim
    // is paused, so ANY step that never settles leaves the game permanently
    // frozen with no way back. A player cannot recover from that, and the only
    // symptom is "I can't move" — which reads as the controls being broken
    // rather than a cutscene that never ended.
    //
    // So: a generous budget derived from the script's own declared durations,
    // and if it is exceeded, tear down anyway. Finishing early looks like a
    // slightly abrupt cut; not finishing costs the run.
    const budgetMs = 8000 + steps.reduce((t, st) => t + ((st.dur ?? st.sec ?? 0) * 1000), 0) * 2;
    let watchdog;
    const guard = new Promise((resolve) => {
      watchdog = setTimeout(() => {
        console.warn(`[cutscene] exceeded ${Math.round(budgetMs / 1000)}s budget — forcing an exit so the sim can resume`);
        resolve();
      }, budgetMs);
    });
    try {
      await Promise.race([this.runner.run(steps, {}), guard]);
    } finally {
      clearTimeout(watchdog);
      this._skipResolvers.clear();
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

  /**
   * Camera flight: from → to (world), easing, look at a fixed point or a character.
   *
   * THE TAB-SWITCH FREEZE
   * This used to drive itself purely from requestAnimationFrame. A browser stops
   * rAF ENTIRELY in a hidden tab — not throttled, stopped — so alt-tabbing during
   * a cutscene meant this promise never resolved, `play()` never returned, its
   * `finally` never ran, and `loop.resume('cutscene')` never happened. The game
   * was then permanently frozen: no movement, no camera control, the clock
   * stopped dead. Reproduced with the intro cutscene (about 60 seconds of
   * unskippable shots, so alt-tabbing through it is likely rather than exotic):
   * visibilityState 'hidden', zero rAF callbacks in 1.5s, and the loop still
   * holding its cutscene token a minute later.
   *
   * Space could not rescue it either, because the skip check lived INSIDE the
   * rAF callback that had stopped running.
   *
   * So: rAF still drives the smooth motion when the tab is visible, and a
   * setTimeout backstop guarantees completion when it is not. Timers are
   * throttled in a hidden tab but they do still FIRE, which is the whole
   * difference. Whichever arrives first finishes the shot exactly once.
   */
  async _shot(s) {
    const cam = this.d.stage.camera;
    const from = new THREE.Vector3(...s.from);
    const to = new THREE.Vector3(...(s.to || s.from));
    const dur = s.dur ?? 4;
    const lookTarget = s.lookChar
      ? () => this.d.cast[s.lookChar]?.actor.rig.byName.head.getWorldPosition(_scratch) || _fallbackLook
      : () => _scratch.set(...(s.look || [0, 1.4, 0]));
    const t0 = performance.now();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        this._skipResolvers.delete(finish);
        this._skip = false;
        // land the camera exactly on `to` — a backstop finish may not have run
        // a frame at raw === 1, and leaving the shot short reads as a jump cut
        cam.position.copy(to);
        cam.lookAt(lookTarget());
        resolve();
      };
      const tick = () => {
        if (done) return;
        const raw = Math.min(1, (performance.now() - t0) / (dur * 1000));
        const k = raw * raw * (3 - 2 * raw);
        cam.position.lerpVectors(from, to, k);
        cam.lookAt(lookTarget());
        if (raw >= 1 || this._skip) { finish(); return; }
        requestAnimationFrame(tick);
      };
      // + 250ms so the rAF path wins under normal conditions and this only ever
      // fires when frames genuinely are not arriving
      const guard = setTimeout(finish, dur * 1000 + 250);
      // let a Space press resolve us directly rather than waiting to be polled
      this._skipResolvers.add(finish);
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
