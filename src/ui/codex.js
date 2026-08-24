// @ts-check
// Codex viewer — the persistent record of lore/easter eggs discovered across
// runs. Opened with 'K'. Reads the meta store (survives perma-death).
import { meta } from '../sim/meta.js';
import { escapeHtml } from './widgets.js';
import { openModal, closeModal } from './modalStack.js';

export class Codex {
  /** @param {import('../core/app.js').App} app */
  constructor(app) {
    this.app = app;
    this.open = false;
    document.addEventListener('keydown', (e) => {
      // …and <select>: typing 'k' in the chat addressee dropdown used to open
      // this panel and pause the sim
      if (e.code === 'KeyK' && this.app.mode === 'run'
          && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) {
        this.toggle();
      }
    });
  }

  toggle() { this.open ? this.close() : this.show(); }
  close() { this.open = false; this.el?.remove(); this.el = null; this.app.loop.resume('codex'); closeModal('codex'); }

  show() {
    this.open = true;
    this.app.loop.pause('codex'); openModal('codex', () => this.close());
    const overlay = document.getElementById('overlay');
    const entries = meta.codex.length
      // Codex entries reach addCodex() from event scripts, and events can be
      // authored in user/events/*.json — so these are NOT trusted strings.
      // Reproduced: an entry containing <b id="…"> created a live DOM node.
      ? meta.codex.map((c) => `<div class="cx-entry"><div class="cx-title">◈ ${escapeHtml(c.title)}</div><div class="cx-text">${escapeHtml(c.text)}</div></div>`).join('')
      : '<p>Nothing discovered yet. Explore the tower, talk to VOX, find what\'s hidden.</p>';
    const el = document.createElement('div');
    el.className = 'screen';
    el.style.background = 'rgba(4,5,9,0.9)';
    el.innerHTML = `
      <div class="panel" style="max-width:560px;max-height:80vh;overflow-y:auto">
        <h1 class="neon-title" style="font-size:24px">CODEX</h1>
        <h2>what the tower remembers · ${meta.codex.length} entries · ${meta.runs.length} runs</h2>
        <div class="cx-list">${entries}</div>
        <div class="actions"><button id="cx-close">Close (K)</button></div>
      </div>`;
    overlay.appendChild(el);
    this.el = el;
    el.querySelector('#cx-close').addEventListener('click', () => this.close());
  }
}
