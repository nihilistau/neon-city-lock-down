// @ts-check
// Creation Kit panel (press G). Author scenarios, events, cutscenes, and
// dialogue as JSON, with per-category templates + a live vocabulary cheatsheet,
// validate + register them into the running game, and Play/Test immediately.
// Saved to user/<category>/<name>.json (tools/userApi.mjs) and reloaded at boot
// (src/core/userContent.js). Fail-soft: bad content shows an error, never crashes.
import { h } from './widgets.js';
import { cfg } from '../core/config.js';
import { SCENARIOS } from '../../data/scenarios.js';
import { EVENTS } from '../../data/events.js';
import { ZONES } from '../../data/zones.js';
import { registerUserItem, userCutscenes } from '../core/userContent.js';
import { launchScenario } from './director/tabScenario.js';

const CATS = ['scenarios', 'events', 'cutscenes', 'dialogue'];

const TEMPLATES = {
  scenarios: () => ({ id: 'my_scenario', title: 'My Scenario', blurb: 'One line of setup.', lighting: 'neon_night', castMoodShifts: { lola: { openness: 6 } }, placements: {}, fireEvent: '', game: '' }),
  events: () => ({ id: 'my_event', cls: 'social', weight: 6, weightThreatScale: 0, cooldownMin: 120, maxPerRun: 2, window: { minDay: 1 }, script: [{ type: 'vox', text: 'Something stirs in the tower.' }, { type: 'wait', sec: 2 }, { type: 'castStat', char: 'lola', deltas: { tension: 4 } }] }),
  cutscenes: () => ({ steps: [{ light: { preset: 'candlelit', fade: 1.5 } }, { titleCard: { text: 'Later that night', sub: '', dur: 2 } }, { line: { speaker: 'lola', text: 'You came back.' } }, { wait: { sec: 1 } }] }),
  dialogue: () => ({ id: 'lola.user.greeting', char: 'lola', priority: 5, triggers: [{ intent: 'greeting' }], lines: [{ text: 'Well, look who wandered in, [player].', fx: { openness: 2 } }] }),
};

function cheatsheet(cat) {
  if (cat === 'scenarios') return [
    'fields: id, title, blurb, lighting, castMoodShifts:{char:{stat:delta}}, placements:{char:[zone,waypoint]}, fireEvent, game',
    `lighting: ${Object.keys(cfg('lighting.presets', {})).join(', ')}`,
    `fireEvent: ${Object.keys(EVENTS).slice(0, 8).join(', ')}…`,
    'game: "tod" | "bed:<char>" | "mystery:<case>"',
    `zones: ${Object.keys(ZONES).slice(0, 10).join(', ')}…`,
  ];
  if (cat === 'events') return [
    'fields: id, cls(threat|social|system), weight(number), weightThreatScale, cooldownMin, maxPerRun, window:{minDay,phase:[]}, script:[steps]',
    'steps: vox{text} · news{text} · alert{text,kind} · sfx{id} · wait{sec} · light{preset,fade} · threatSpike{amount}',
    '  resource{key,amount} · castStat{char,deltas} · castStats{deltas} · playerHurt{amount} · damageSystem{system,amount}',
    '  combat{count,archetype,spawnAt,onWin:[steps]} · choice{prompt,options:[{label,steps}]} · scheduleEvent{eventId,inMinutes}',
  ];
  if (cat === 'cutscenes') return [
    'an array of steps (or {steps:[...]})',
    'steps: light{preset,fade} · shot{from:[x,y,z],to,dur} · line{speaker,text} · anim{char,clip} · face{char,expr}',
    '  teleport{char,at:[x,z],yaw} · look{char,target} · titleCard{text,sub,dur} · wait{sec}',
  ];
  return [
    'a topic: {id:"char.pack.name", char, priority, cooldownMin, triggers:[{intent,min}], cond:{minStat,mood,...}, lines:[{text,fx:{stat:delta}}], effects:{...}}',
    'line text may embed [[tags]] (anim/face/move/gate…) and [player].',
  ];
}

export class KitPanel {
  /** @param {import('../core/app.js').App} app */
  constructor(app) {
    this.app = app;
    this.open = false;
    this.el = null;
    this.cat = 'scenarios';
    this.name = '';
    this.text = JSON.stringify(TEMPLATES.scenarios(), null, 2);
    this.msg = '';
    this.index = { scenarios: [], events: [], cutscenes: [], dialogue: [] };
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG' && this.app.mode === 'run'
          && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) {
        this.toggle();
      }
    });
  }

  toggle() { this.open ? this.close() : this.show(); }
  close() { this.open = false; this.el?.remove(); this.el = null; this.app.loop.resume('kit'); }

  async show() {
    this.open = true;
    this.app.loop.pause('kit');
    await this._loadIndex();
    if (this.open) this._render();   // a fast re-toggle during the await may have closed us
  }

  async _loadIndex() {
    try { const r = await fetch('/api/user', { cache: 'no-store' }); if (r.ok) this.index = await r.json(); } catch { /* offline */ }
  }

  _setCat(cat) { this.cat = cat; this.name = ''; this.text = JSON.stringify(TEMPLATES[cat](), null, 2); this.msg = ''; this._render(); }

  _loadItem(kind, id) {
    // kind: 'user' (fetch json) or 'builtin' (from the live map)
    if (kind === 'builtin') {
      let obj = null;
      if (this.cat === 'scenarios') obj = { ...SCENARIOS[id] };
      else if (this.cat === 'events') { const e = { ...EVENTS[id] }; delete e.weight; obj = { ...e, weight: 6 }; }  // weight is a fn — template it
      else if (this.cat === 'cutscenes') obj = { steps: userCutscenes.get(id) || [] };
      if (obj) { this.text = JSON.stringify(obj, null, 2); this.name = id; this.msg = `loaded built-in "${id}" as a template`; this._render(); }
      return;
    }
    fetch(`/api/user/${this.cat}/${id}.json`, { cache: 'no-store' }).then((r) => r.json()).then((obj) => {
      this.text = JSON.stringify(obj, null, 2); this.name = id; this.msg = `loaded ${id}`; this._render();
    }).catch(() => { this.msg = 'load failed'; this._render(); });
  }

  async _save() {
    let data;
    try { data = JSON.parse(this.text); } catch (err) { this.msg = `✗ JSON: ${err.message}`; this._render(); return; }
    const name = this.name || data.id || (this.cat === 'cutscenes' ? 'my_cutscene' : 'untitled');
    // register live first (validates); only persist if it registered
    try { registerUserItem(this.cat, name, data); } catch (err) { this.msg = `✗ invalid: ${err.message}`; this._render(); return; }
    try {
      const r = await fetch(`/api/user/${this.cat}/${name}.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data, null, 2) });
      const j = await r.json();
      this.msg = j.ok ? `✓ saved + registered ${name}` : `✗ ${j.error || 'save failed'}`;
    } catch (err) { this.msg = `✗ ${err}`; }
    this.name = name;
    await this._loadIndex();
    this._render();
  }

  async _delete() {
    if (!this.name) return;
    await fetch(`/api/user/${this.cat}/${this.name}.json`, { method: 'DELETE' }).catch(() => {});
    this.msg = `deleted ${this.name} (registered copy persists until reload)`;
    this.name = '';
    await this._loadIndex();
    this._render();
  }

  _play() {
    let data;
    try { data = JSON.parse(this.text); } catch (err) { this.msg = `✗ JSON: ${err.message}`; this._render(); return; }
    try { registerUserItem(this.cat, this.name || data.id || 'preview', data); } catch (err) { this.msg = `✗ ${err.message}`; this._render(); return; }
    if (this.cat === 'scenarios') { launchScenario(this.app, data); this.msg = `▶ launched scenario "${data.id}"`; this.close(); return; }
    if (this.cat === 'events') { this.app.eventRunner?.fire(data.id); this.msg = `▶ fired event "${data.id}"`; this.close(); return; }
    if (this.cat === 'cutscenes') { const steps = Array.isArray(data) ? data : data.steps; this.app.cutscene?.play(steps); this.msg = '▶ playing cutscene'; this.close(); return; }
    this.msg = 'dialogue is live in conversation — no direct play'; this._render();
  }

  _render() {
    const overlay = document.getElementById('overlay');
    if (this.el) this.el.remove();
    const tabBtn = (c) => { const b = h('button', { class: c === this.cat ? 'kit-tab on' : 'kit-tab' }, [c]); b.addEventListener('click', () => this._setCat(c)); return b; };
    const listRow = (kind, id) => { const b = h('button', { class: 'kit-item', style: 'font-size:11px;margin:1px' }, [`${kind === 'builtin' ? '◇ ' : '● '}${id}`]); b.addEventListener('click', () => this._loadItem(kind, id)); return b; };

    const builtins = this.cat === 'scenarios' ? Object.keys(SCENARIOS) : this.cat === 'events' ? Object.keys(EVENTS) : this.cat === 'cutscenes' ? [...userCutscenes.keys()] : [];
    const ta = h('textarea', { spellcheck: 'false', style: 'width:100%;height:230px;font-family:monospace;font-size:12px;white-space:pre;resize:vertical' }, [this.text]);
    ta.value = this.text; ta.addEventListener('input', () => { this.text = ta.value; });

    const actions = h('div', { class: 'dir-row', style: 'gap:6px' }, [
      this._btn('💾 Save + Register', () => this._save()),
      ...(this.cat !== 'dialogue' ? [this._btn('▶ Play / Test', () => this._play())] : []),
      this._btn('🗑 Delete', () => this._delete()),
      this._btn('＋ New', () => this._setCat(this.cat)),
    ]);

    this.el = h('div', { class: 'screen', style: 'background:rgba(4,5,9,0.93)' }, [
      h('div', { class: 'panel', style: 'min-width:560px;max-width:720px;max-height:90vh;overflow-y:auto' }, [
        h('div', { class: 'game-head' }, [
          h('h1', { class: 'neon-title', style: 'font-size:22px' }, ['CREATION KIT']),
          h('button', { onclick: () => this.close() }, ['Close (G)']),
        ]),
        h('div', { class: 'dir-row', style: 'gap:6px;margin:4px 0' }, CATS.map(tabBtn)),
        h('div', { style: 'min-height:16px;color:var(--gold,#ffb347);font-size:12px;margin:2px 0' }, [this.msg]),
        h('div', { class: 'dir-section' }, [
          h('div', { class: 'dir-label' }, [`YOUR ${this.cat.toUpperCase()}`]),
          h('div', { style: 'display:flex;flex-wrap:wrap' }, (this.index[this.cat] || []).length ? this.index[this.cat].map((id) => listRow('user', id)) : [h('span', { class: 'dir-hint' }, ['none yet'])]),
          h('div', { class: 'dir-label', style: 'margin-top:6px' }, ['BUILT-IN (load as template)']),
          h('div', { style: 'display:flex;flex-wrap:wrap;max-height:64px;overflow-y:auto' }, builtins.map((id) => listRow('builtin', id))),
        ]),
        h('div', { class: 'dir-section' }, [
          h('div', { class: 'dir-row' }, ['name/id ', this._input((v) => (this.name = v), this.name, 'file name (defaults to .id)')]),
          ta,
          actions,
          h('div', { class: 'dir-label', style: 'margin-top:8px' }, ['REFERENCE']),
          ...cheatsheet(this.cat).map((line) => h('p', { class: 'dir-hint', style: 'margin:1px 0;font-size:11px' }, [line])),
        ]),
      ]),
    ]);
    overlay.appendChild(this.el);
  }

  _btn(label, onClick) { const b = h('button', {}, [label]); b.addEventListener('click', onClick); return b; }
  _input(onChange, val, ph) { const i = h('input', { type: 'text', value: val || '', placeholder: ph || '', style: 'width:220px' }); i.addEventListener('input', () => onChange(i.value)); return i; }
}
