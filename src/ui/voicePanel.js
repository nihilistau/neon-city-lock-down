// @ts-check
// Voice Controls panel (press V). Drives the Voxtral voice server
// (tools/sidecar.mjs): realtime say, the voice library + playback, long-text /
// file synthesis, custom-dialogue baking, per-character voice assignment, and
// cloning. Falls back gracefully when the voice server or cloner isn't running.
import { h } from './widgets.js';
import { cfg, saveConfigFile } from '../core/config.js';

const CHARS = [
  { id: 'lola', name: 'Lola Voss' },
  { id: 'aria', name: 'Aria Chen' },
  { id: 'kai', name: 'Kai Mercer' },
  { id: 'vox', name: 'VOX' },
];
const SAMPLE = 'The tower holds another night. Stay close, and stay quiet.';

export class VoicePanel {
  /** @param {import('../core/app.js').App} app */
  constructor(app) {
    this.app = app;
    this.open = false;
    this.el = null;
    this.voices = [];        // [{name, kind}]
    this.clips = [];         // saved clip filenames
    this._audio = new Audio();
    this._draft = { text: SAMPLE, long: '', voice: '', euler: 3, char: 'lola', line: '', clipName: '', cloneName: '' };
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyV' && this.app.mode === 'run'
          && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) {
        this.toggle();
      }
    });
  }

  toggle() { this.open ? this.close() : this.show(); }
  close() { this.open = false; this._audio.pause(); if (this._playUrl) { URL.revokeObjectURL(this._playUrl); this._playUrl = null; } this.el?.remove(); this.el = null; this.app.loop.resume('voice'); }

  async show() {
    this.open = true;
    this.app.loop.pause('voice');
    this._render(true);
    await this.app.sidecar.probe();
    const [voices, lib] = await Promise.all([this.app.sidecar.listVoices(), this.app.sidecar.library()]);
    this.voices = voices.length ? voices : (lib.voices || []);
    this.clips = lib.clips || [];
    if (!this._draft.voice && this.voices[0]) this._draft.voice = this.voices[0].name;
    if (this.open) this._render(false);
  }

  // ── audio helpers ──────────────────────────────────────────────────────────
  _play(arrayBuffer) {
    if (!arrayBuffer) return;
    if (this._playUrl) URL.revokeObjectURL(this._playUrl);   // don't leak the previous clip's blob
    this._playUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: 'audio/wav' }));
    this._audio.src = this._playUrl; this._audio.play().catch(() => {});
  }
  _b64(buf) { let s = ''; const b = new Uint8Array(buf); const CH = 0x8000; for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH)); return btoa(s); }
  async _busy(btn, label, fn) {
    const old = btn.textContent; btn.disabled = true; btn.textContent = label;
    try { await fn(); } finally { btn.disabled = false; btn.textContent = old; }
  }

  // ── widgets ─────────────────────────────────────────────────────────────────
  _voiceSelect(selected, onChange, id) {
    const sel = h('select', { id }, this.voices.map((v) =>
      h('option', { value: v.name, ...(v.name === selected ? { selected: true } : {}) }, [`${v.name}${v.kind === 'user' ? ' ·user' : ''}`])));
    sel.value = selected || (this.voices[0]?.name ?? '');
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }
  _btn(label, onClick) { const b = h('button', {}, [label]); b.addEventListener('click', () => onClick(b)); return b; }

  _render(loading) {
    const overlay = document.getElementById('overlay');
    if (this.el) this.el.remove();
    const online = this.voices.length > 0;
    const status = loading ? 'checking voice server…'
      : online ? `online · ${this.voices.length} voices` : 'offline — run  node tools/sidecar.mjs';
    const d = this._draft;

    const body = [
      // realtime say
      this._section('SAY (realtime)', [
        this._textarea((v) => (d.text = v), d.text, 2),
        h('div', { class: 'dir-row' }, ['voice ', this._voiceSelect(d.voice, (v) => (d.voice = v)),
          '  euler ', this._eulerSel((v) => (d.euler = v), d.euler)]),
        h('div', { class: 'dir-row' }, [this._btn('▶ Speak', (b) => this._busy(b, '…', async () => {
          this._play(await this.app.sidecar.speakRaw(d.text.slice(0, 800), d.voice, d.euler)); }))]),
      ]),
      // long text / file
      this._section('LONG TEXT / FILE', [
        this._textarea((v) => (d.long = v), d.long, 4, 'Paste long text, or load a .txt file…'),
        h('div', { class: 'dir-row' }, [this._fileInput('.txt', async (file) => {
          d.long = await file.text(); this._render(false); })]),
        h('div', { class: 'dir-row' }, ['voice ', this._voiceSelect(d.voice, (v) => (d.voice = v)),
          '  save as ', this._input((v) => (d.clipName = v), d.clipName, 'clip name')]),
        h('div', { class: 'dir-row' }, [
          this._btn('▶ Synthesize', (b) => this._busy(b, 'synthesizing…', async () => {
            const r = await this.app.sidecar.synthLong(d.long || d.text, d.voice, d.euler); if (r) this._play(r.audio); })),
          this._btn('💾 Synthesize + Save', (b) => this._busy(b, 'saving…', async () => {
            const r = await this.app.sidecar.synthLong(d.long || d.text, d.voice, d.euler, { save: true, name: d.clipName || 'clip' });
            if (r) { this._play(r.audio); await this._refreshLibrary(); }
          })),
        ]),
      ]),
      // per-character voice assignment
      this._section('CHARACTER VOICES (config/voice.yaml)', CHARS.map((c) =>
        h('div', { class: 'dir-row' }, [h('span', { style: 'width:90px;display:inline-block' }, [c.name]),
          this._voiceSelect(cfg(`voice.cast.${c.id}`, ''), (v) => this._assignVoice(c.id, v)),
          this._btn('▶', (b) => this._busy(b, '…', async () => {
            this._play(await this.app.sidecar.speakRaw(SAMPLE, cfg(`voice.cast.${c.id}`, d.voice), d.euler)); })),
        ])),
      ),
      // custom dialogue baking
      this._section('CUSTOM DIALOGUE (bake a spoken line)', [
        h('div', { class: 'dir-row' }, ['as ', this._charSelect((v) => (d.char = v), d.char),
          '  voice ', this._voiceSelect(d.voice, (v) => (d.voice = v))]),
        this._textarea((v) => (d.line = v), d.line, 2, 'The line this character says…'),
        h('div', { class: 'dir-row' }, [
          this._btn('▶ Preview', (b) => this._busy(b, '…', async () => {
            this._play(await this.app.sidecar.speakRaw(d.line || SAMPLE, d.voice, d.euler)); })),
          this._btn('🎙 Bake for character', (b) => this._busy(b, 'baking…', async () => {
            const audio = await this.app.sidecar.speakRaw(d.line, d.voice, d.euler);
            if (!audio) return this._flash('synthesis failed');
            const lineId = `user.${d.char}.${Math.abs(this._hash(d.line))}`;
            const res = await this.app.sidecar.save({ wavBase64: this._b64(audio), char: d.char, lineId, text: d.line, voice: d.voice });
            this._flash(res.ok ? `baked ${res.baked} (${lineId})` : `save failed: ${res.error || ''}`);
          })),
        ]),
        h('p', { class: 'dir-hint' }, ['Bakes a WAV into assets/voice + the manifest under a user line-id. Use it from a topic line (Scenario/Dialogue toolkit) to hear it in game.']),
      ]),
      // saved clips
      this._section('SAVED CLIPS (user/voices)', this.clips.length ? this.clips.map((f) =>
        h('div', { class: 'dir-row' }, [h('span', { style: 'flex:1' }, [f]),
          this._audioEl(this.app.sidecar.clipUrl(f))])) : [h('p', { class: 'dir-hint' }, ['none yet'])]),
      // cloning
      this._section('CLONE A VOICE (add-on)', [
        h('div', { class: 'dir-row' }, ['reference clip ', this._fileInput('audio/*', (file) => { d._cloneFile = file; this._flash(`selected ${file.name}`); })]),
        h('div', { class: 'dir-row' }, ['name ', this._input((v) => (d.cloneName = v), d.cloneName, 'new voice name'),
          this._btn('🧬 Clone', (b) => this._busy(b, 'cloning…', async () => {
            if (!d._cloneFile || !d.cloneName) return this._flash('pick a clip + name');
            const buf = await d._cloneFile.arrayBuffer();
            const res = await this.app.sidecar.clone({ refWavBase64: this._b64(buf), name: d.cloneName });
            if (res.status === 200) { await this._refreshLibrary(); this._flash(`cloned "${res.voice}"`); }
            else this._flash(res.error || 'clone unavailable — see docs/systems/voice.md');
          }))]),
        h('p', { class: 'dir-hint' }, ['Needs the Python add-on (scripts/voice/requirements.txt). Without it, drop a <name>.safetensors embedding into the voices dir.']),
      ]),
    ];

    this.el = h('div', { class: 'screen', style: 'background:rgba(4,5,9,0.92)' }, [
      h('div', { class: 'panel', style: 'min-width:480px;max-width:600px;max-height:88vh;overflow-y:auto' }, [
        h('div', { class: 'game-head' }, [
          h('h1', { class: 'neon-title', style: 'font-size:22px' }, ['VOICE CONTROLS']),
          h('button', { onclick: () => this.close() }, ['Close (V)']),
        ]),
        h('div', { style: `margin:4px 0 8px;color:${online ? 'var(--cyan)' : 'var(--pink,#ff3fa4)'}` }, [status]),
        this._flashEl = h('div', { style: 'min-height:16px;color:var(--gold,#ffb347);font-size:12px;margin-bottom:6px' }, ['']),
        ...body,
      ]),
    ]);
    overlay.appendChild(this.el);
  }

  // ── section + input helpers ─────────────────────────────────────────────────
  _section(label, rows) { return h('div', { class: 'dir-section' }, [h('div', { class: 'dir-label' }, [label]), ...rows]); }
  _textarea(onChange, val, rows = 2, ph = '') { const t = h('textarea', { rows, placeholder: ph, style: 'width:100%;resize:vertical' }, [val || '']); t.value = val || ''; t.addEventListener('input', () => onChange(t.value)); return t; }
  _input(onChange, val, ph = '') { const i = h('input', { type: 'text', placeholder: ph, value: val || '', style: 'width:150px' }); i.addEventListener('input', () => onChange(i.value)); return i; }
  _eulerSel(onChange, val) { const s = h('select', {}, [3, 4, 6, 8].map((n) => h('option', { value: n, ...(n === val ? { selected: true } : {}) }, [`${n}${n === 3 ? ' (fast)' : n === 8 ? ' (best)' : ''}`]))); s.value = String(val); s.addEventListener('change', () => onChange(Number(s.value))); return s; }
  _charSelect(onChange, val) { const s = h('select', {}, CHARS.map((c) => h('option', { value: c.id, ...(c.id === val ? { selected: true } : {}) }, [c.name]))); s.value = val; s.addEventListener('change', () => onChange(s.value)); return s; }
  _fileInput(accept, onFile) { const i = h('input', { type: 'file', accept }); i.addEventListener('change', () => { if (i.files?.[0]) onFile(i.files[0]); }); return i; }
  _audioEl(src) { const a = h('audio', { controls: true, src, style: 'height:28px;vertical-align:middle' }); return a; }

  _flash(msg) { if (this._flashEl) this._flashEl.textContent = msg; }
  _hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
  async _refreshLibrary() { const lib = await this.app.sidecar.library(); this.clips = lib.clips || []; this.voices = lib.voices || this.voices; if (this.open) this._render(false); }
  async _assignVoice(id, v) {
    const voice = structuredClone(cfg('voice', {}));
    voice.cast = { ...(voice.cast || {}), [id]: v };
    const res = await saveConfigFile('voice', voice);
    this._flash(res.ok ? `${id} → ${v}` : `save failed: ${(res.errors || []).join(', ')}`);
  }
}
