// @ts-check
// Games surface: a centered panel hosting cards and the mystery board. Bound
// to the app's game engines; renders their state and routes player choices
// back. Gambits live inline in the Actions tab (dice).
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

  cards() {
    this.app.cards.start();
    this.mode = 'cards';
    this._open();
    this._renderCards();
  }

  _renderCards() {
    const s = this.app.cards.state();
    this.root.innerHTML = '';
    const last = s.last;
    const lastLine = last
      ? `You ${last.call} · yours ${last.yours} · Kai ${last.his}${last.cheated ? ' (his sleeve)' : ''} — ${last.win ? 'your trick' : 'his trick'}`
      : 'Five tricks. Call high or low. He is already counting the tells.';
    const body = s.active
      ? h('div', { class: 'game-row' }, [
          h('button', { onclick: () => this._cardPlay('high') }, ['High — mine is bigger']),
          h('button', { onclick: () => this._cardPlay('low') }, ['Low — mine is smaller']),
        ])
      : h('div', { class: 'bg-hint' }, [
          s.winner === 'player' ? 'You take the night. He almost looks pleased.'
            : s.winner === 'kai' ? 'He gathers the cards. "Again, whenever you want to lose with more style."'
              : 'A split. He offers you a drink as if that were the real stake.',
        ]);
    this.root.appendChild(h('div', { class: 'panel game-box' }, [
      h('div', { class: 'game-head' }, [
        h('span', { class: 'neon-title', style: 'font-size:18px' }, ["Kai's game"]),
        h('button', { onclick: () => this.close() }, ['Walk away']),
      ]),
      h('div', { class: 'tod-who' }, [`Tricks ${s.round}/${s.total} — you ${s.playerTricks} · Kai ${s.kaiTricks}`]),
      h('div', { class: 'bg-line' }, [lastLine]),
      body,
    ]));
  }

  _cardPlay(call) {
    const r = this.app.cards.play(call);
    if (r?.winner === 'player') {
      this.app.cast.kai?.applyStats({ trust: 4, happiness: 3, openness: 2 }, 'cards');
    } else if (r?.winner === 'kai') {
      this.app.cast.kai?.applyStats({ dominance: 3, happiness: 2 }, 'cards');
    }
    this._renderCards();
  }

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
