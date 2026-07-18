// @ts-check
// LLM control panel (press L). Pick which model powers the characters, set a
// different model per character (or opt one out to authored dialogue), and tune
// the agent — all backed by the lmstudio-engine. Models list comes live from
// /engine/models. Thinking models are flagged (they need a big token budget and
// answer slowly); a plain instruct model gives snappy in-character replies.
import { settings, setSetting } from '../core/settings.js';
import { h } from './widgets.js';

const CHARS = [
  { id: 'lola', name: 'Lola Voss' },
  { id: 'aria', name: 'Aria Chen' },
  { id: 'kai', name: 'Kai Mercer' },
  { id: 'vox', name: 'VOX' },
];

function looksThinking(key) {
  return /think|reason|r1|qwq|distill/i.test(key);
}

export class LLMPanel {
  /** @param {import('../core/app.js').App} app */
  constructor(app) {
    this.app = app;
    this.open = false;
    this.el = null;
    this._models = [];
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyL' && this.app.mode === 'run'
          && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) {
        this.toggle();
      }
    });
  }

  toggle() { this.open ? this.close() : this.show(); }
  close() { this.open = false; this.el?.remove(); this.el = null; this.app.loop.resume('llm'); }

  async show() {
    this.open = true;
    this.app.loop.pause('llm');
    this._render(true);
    // load models + status live
    const [models, info] = await Promise.all([this.app.agent.engine.models(), this.app.agent.info(true)]);
    this._models = models;
    this._info = info;
    if (this.open) this._render(false);
  }

  _modelOptions(selected, extra = []) {
    const opts = [...extra, ...this._models.map((m) => ({
      value: m.key,
      label: `${m.displayName || m.key}${m.loaded ? ' ●' : ''}${looksThinking(m.key) ? ' ⟳think' : ''}`,
    }))];
    return opts.map((o) => h('option', { value: o.value, ...(o.value === selected ? { selected: true } : {}) }, [o.label]));
  }

  _select(id, selected, extra, onChange) {
    const sel = h('select', { id }, this._modelOptions(selected, extra));
    sel.value = selected ?? '';
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  _render(loading) {
    const overlay = document.getElementById('overlay');
    if (this.el) this.el.remove();
    const L = settings.llm;
    const status = this._info?.available !== false && this._info?.model
      ? `online · ${this._info.mode} · ${this._info.model}`
      : (loading ? 'checking…' : 'offline — start LM Studio + a model');

    const body = loading && !this._models.length
      ? [h('p', {}, ['Loading models…'])]
      : [
        h('div', { class: 'dir-section' }, [
          h('div', { class: 'dir-row' }, [
            h('label', { class: 'st-check' }, [
              this._checkbox(L.enabled, (v) => { setSetting('llm.enabled', v); this.app.llm.refresh(); }), ' LLM characters enabled']),
          ]),
          h('div', { class: 'dir-row' }, [
            h('label', { class: 'st-check' }, [
              this._checkbox(L.agentMode, (v) => setSetting('llm.agentMode', v)), ' agent mode (LLM writes replies + drives the scene)']),
          ]),
          h('div', { class: 'dir-row' }, [
            h('label', { style: 'flex:1' }, [`warmth ${L.temperature}`,
              this._range(0.3, 1.3, 0.05, L.temperature, (v) => { setSetting('llm.temperature', v); this._render(false); })]),
          ]),
        ]),
        h('div', { class: 'dir-section' }, [
          h('div', { class: 'dir-label' }, ['DEFAULT MODELS']),
          h('div', { class: 'dir-row' }, ['chat: ',
            this._select('llm-chat', L.chatModel, [{ value: '', label: 'whatever is loaded' }], (v) => {
              setSetting('llm.chatModel', v); this.app.agent.engine.setConfig({ chatModel: v }); })]),
          h('div', { class: 'dir-row' }, ['tags: ',
            this._select('llm-fn', L.functionModel, [{ value: '', label: 'functiongemma-270m (default)' }], (v) => {
              setSetting('llm.functionModel', v); this.app.agent.engine.setConfig({ functionModel: v }); })]),
          h('p', { class: 'dir-hint' }, ['● loaded · ⟳think = reasoning model (slow, needs a big budget). Pick a plain instruct model for snappy replies.']),
        ]),
        h('div', { class: 'dir-section' }, [
          h('div', { class: 'dir-label' }, ['PER-CHARACTER']),
          ...CHARS.map((c) => h('div', { class: 'dir-row' }, [`${c.name}: `,
            this._select(`llm-char-${c.id}`, L.charModels?.[c.id] || 'default',
              [{ value: 'default', label: 'default model' }, { value: 'authored', label: 'authored dialogue (no LLM)' }],
              (v) => setSetting('llm.charModels', { ...settings.llm.charModels, [c.id]: v }))])),
        ]),
      ];

    const el = h('div', { class: 'screen', style: 'background:rgba(4,5,9,0.92)' }, [
      h('div', { class: 'panel', style: 'min-width:460px;max-width:560px;max-height:86vh;overflow-y:auto' }, [
        h('div', { class: 'game-head' }, [
          h('h1', { class: 'neon-title', style: 'font-size:22px' }, ['LLM ENGINE']),
          h('button', { onclick: () => this.close() }, ['Close (L)']),
        ]),
        h('div', { class: 'llm-status', style: 'margin:4px 0 10px;color:var(--cyan)' }, [status]),
        ...body,
      ]),
    ]);
    overlay.appendChild(el);
    this.el = el;
  }

  _checkbox(checked, onChange) {
    const c = h('input', { type: 'checkbox', ...(checked ? { checked: true } : {}) });
    c.addEventListener('change', () => onChange(c.checked));
    return c;
  }
  _range(min, max, step, val, onChange) {
    const r = h('input', { type: 'range', min, max, step, value: val, style: 'width:100%' });
    r.addEventListener('input', () => onChange(Number(r.value)));
    return r;
  }
}
