// @ts-check
// Games surface: a centered panel hosting the bed game, truth-or-dare, and
// mystery board. Bound to the app's game engines; renders their state and routes
// player choices back. Gambits live inline in the Actions tab (dice).
import { on } from '../core/bus.js';
import { h } from './widgets.js';

export class GamesPanel {
  /** @param {import('../core/app.js').App} app */
  constructor(app) {
    this.app = app;
    this.root = document.createElement('div');
    this.root.id = 'games-panel';
    this.root.className = 'hidden';
    document.getElementById('ui').appendChild(this.root);

    on('bedgame.state', (s) => { if (this.mode === 'bed') this._renderBed(s); });
    on('tod.resolved', () => { if (this.mode === 'tod') this._renderTod(); });
    on('mystery.clue', () => { if (this.mode === 'mystery') this._renderMystery(); });
    on('mystery.solved', () => { if (this.mode === 'mystery') this._renderMystery(); });
  }

  close() {
    this.mode = null;
    this.root.className = 'hidden';
    this.root.innerHTML = '';
    this.app.loop.resume('games');
  }

  _open() {
    this.root.className = 'clickable';
    this.app.loop.pause('games');
  }

  // ── Bed game ──────────────────────────────────────────────
  bed(partnerId) {
    const res = this.app.bedGame.start(partnerId);
    if (!res.ok) {
      this.app.toast?.(res.line || 'Not now.');
      return;
    }
    this.mode = 'bed';
    this._open();
    this._renderBed(res.state);
  }

  _renderBed(s) {
    if (!s) return;
    this.root.innerHTML = '';
    const tiers = s.tiers.map((t) => h('div', { class: `bg-tier ${t.unlocked ? 'open' : 'locked'} ${t.capped ? 'capped' : ''}` }, [
      h('div', { class: 'bg-tier-name' }, [`${t.name}${t.capped ? ' · (capped)' : t.unlocked ? '' : ' · locked'}`]),
      h('div', { class: 'bg-actions' }, t.actions.map((a) =>
        h('button', {
          class: a.enabled ? '' : 'disabled', disabled: !a.enabled,
          onclick: () => this._bedAct(a.id),
        }, [a.label]))),
    ]));

    this.root.appendChild(h('div', { class: 'panel game-box' }, [
      h('div', { class: 'game-head' }, [
        h('span', { class: 'neon-title', style: 'font-size:20px' }, [`with ${s.partnerName}`]),
        h('button', { onclick: () => { this.app.bedGame.end(); this.close(); } }, ['End']),
      ]),
      h('div', { class: 'bg-meters' }, [
        this._meter('arousal', s.arousal, '#ff5fa8'),
        this._meter('pleasure', s.pleasure, '#ff8fc0'),
        h('span', { class: 'bg-gate' }, [`gate: ${s.topGate || 'none'}`]),
      ]),
      h('div', { id: 'bg-line', class: 'bg-line' }, [this._lastBedLine || '']),
      ...tiers,
      s.canEscalate
        ? h('button', { class: 'bg-ask', onclick: () => this._bedAsk() }, [`Ask for more →`])
        : h('div', { class: 'bg-hint' }, ['Warm them up to open the next tier…']),
    ]));
  }

  _meter(label, val, color) {
    return h('span', { class: 'bg-meter' }, [
      `${label} `,
      h('span', { class: 'bg-bar' }, [h('span', { class: 'bg-fill', style: `width:${val}%;background:${color}` }, [])]),
      ` ${val}`,
    ]);
  }

  _bedAct(id) {
    const r = this.app.bedGame.act(id);
    this._lastBedLine = r.line || '';
    const lineEl = document.getElementById('bg-line');
    if (lineEl) lineEl.textContent = this._lastBedLine;
    if (r.withdrawn) this.app.toast?.('They pulled back. Slow down.');
  }

  _bedAsk() {
    const r = this.app.bedGame.askForMore();
    this._lastBedLine = r.line || '';
    const lineEl = document.getElementById('bg-line');
    if (lineEl) lineEl.textContent = this._lastBedLine;
    this._renderBed(this.app.bedGame.state());
  }

  // ── Truth or Dare ─────────────────────────────────────────
  tod() {
    this.app.truthOrDare.start();
    this.mode = 'tod';
    this._open();
    this._renderTod();
  }

  _renderTod() {
    const g = this.app.truthOrDare;
    const turn = g.turn();
    this.root.innerHTML = '';
    let body;
    if (turn.isPlayer) {
      body = h('div', { class: 'tod-turn' }, [
        h('div', { class: 'tod-who' }, [`Your turn — round tier ${turn.tier}`]),
        this._pendingPrompt
          ? h('div', {}, [
              h('div', { class: 'tod-prompt' }, [this._pendingPrompt.text]),
              h('div', { class: 'game-row' }, [
                h('button', { onclick: () => this._todResolve('complete') }, ['Do it']),
                h('button', { class: 'danger', onclick: () => this._todResolve('refuse') }, ['Refuse']),
              ]),
            ])
          : h('div', { class: 'game-row' }, [
              h('button', { onclick: () => this._todDraw('truth') }, ['Truth']),
              h('button', { onclick: () => this._todDraw('dare') }, ['Dare']),
            ]),
      ]);
    } else {
      body = h('div', { class: 'tod-turn' }, [
        h('div', { class: 'tod-who' }, [`${turn.name}'s turn`]),
        h('button', { onclick: () => this._todAuto() }, [`Let ${turn.name} play →`]),
      ]);
    }
    this.root.appendChild(h('div', { class: 'panel game-box' }, [
      h('div', { class: 'game-head' }, [
        h('span', { class: 'neon-title', style: 'font-size:20px' }, ['Truth or Dare']),
        h('button', { onclick: () => { this.app.truthOrDare.end(); this.close(); } }, ['End']),
      ]),
      body,
    ]));
  }

  _todDraw(kind) { this._pendingPrompt = this.app.truthOrDare.draw(kind); this._renderTod(); }
  _todResolve(outcome) {
    this.app.truthOrDare.resolve(this._pendingPrompt, outcome);
    this._pendingPrompt = null;
    this._renderTod();
  }
  _todAuto() { this.app.truthOrDare.autoTurn(); this._renderTod(); }

  // ── Mystery ───────────────────────────────────────────────
  mystery(caseId) {
    this.app.mystery.start(caseId);
    this.mode = 'mystery';
    this._open();
    this._renderMystery();
  }

  _renderMystery() {
    const s = this.app.mystery.state();
    if (!s) return;
    this.root.innerHTML = '';
    this.root.appendChild(h('div', { class: 'panel game-box' }, [
      h('div', { class: 'game-head' }, [
        h('span', { class: 'neon-title', style: 'font-size:18px' }, [s.title]),
        h('button', { onclick: () => this.close() }, ['Close']),
      ]),
      h('p', { class: 'mys-intro' }, [s.intro]),
      h('div', { class: 'mys-clues' }, [`Clues: ${s.found.length}/${s.total} — explore zones and interact with objects to find them.`]),
      h('div', { class: 'mys-section' }, ['INTERROGATE']),
      h('div', { class: 'game-row' }, s.interrogations.length
        ? s.interrogations.map((iq) => h('button', { onclick: () => this._mysInterrogate(iq.id) }, [iq.char]))
        : [h('span', { class: 'bg-hint' }, ['Find clues to unlock questions.'])]),
      h('div', { id: 'mys-line', class: 'bg-line' }, [this._lastMysLine || '']),
      h('div', { class: 'mys-section' }, ['ACCUSE']),
      s.solved
        ? h('div', { class: 'bg-hint' }, ['Case closed.'])
        : h('div', { class: 'game-row' }, s.suspects.map((sid) =>
            h('button', { class: 'danger', onclick: () => this._mysAccuse(sid) }, [sid]))),
    ]));
  }

  _mysInterrogate(id) {
    this._lastMysLine = this.app.mystery.interrogate(id) || '';
    const el = document.getElementById('mys-line');
    if (el) el.textContent = this._lastMysLine;
  }
  _mysAccuse(id) {
    const r = this.app.mystery.accuse(id);
    this._lastMysLine = r?.correct ? 'Correct.' : 'Wrong.';
    this._renderMystery();
  }
}
