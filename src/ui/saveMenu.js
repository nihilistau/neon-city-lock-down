// @ts-check
// Save/load menu (Esc). Three slots + autosave restore + export/import.
import { saveToSlot, readSlot, applySave, listSlots, exportSave } from '../core/save.js';
import { feed } from '../core/log.js';

export class SaveMenu {
  /** @param {import('../core/app.js').App} app */
  constructor(app) {
    this.app = app;
    this.open = false;
    this.el = null;
    document.addEventListener('keydown', (e) => {
      // guard every focusable text/choice control, not just <input> — Esc while
      // editing the Creation Kit's JSON textarea used to stack this on top of it
      if (e.code === 'Escape' && this.app.mode === 'run'
          && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) {
        this.toggle();
      }
    });
  }

  toggle() {
    this.open ? this.close() : this.show();
  }

  close() {
    this.open = false;
    this.el?.remove();
    this.el = null;
    this.app.loop.resume('menu');
  }

  show() {
    this.open = true;
    this.app.loop.pause('menu');
    const overlay = document.getElementById('overlay');
    const el = document.createElement('div');
    el.className = 'screen';
    el.style.background = 'rgba(4,5,9,0.82)';
    const rows = listSlots().map(({ slot, meta }) => `
      <div class="ds-row save-slot" data-slot="${slot}">
        <span>${slot === 'auto' ? 'Autosave' : `Slot ${slot}`} — ${meta ? `${meta.label} (${meta.playerName})` : 'empty'}</span>
        <span>
          ${slot !== 'auto' ? `<button data-act="save" data-slot="${slot}">Save</button>` : ''}
          ${meta ? `<button data-act="load" data-slot="${slot}">Load</button>` : ''}
        </span>
      </div>`).join('');
    el.innerHTML = `
      <div class="panel" style="min-width:440px">
        <h1 class="neon-title" style="font-size:22px">LOCKDOWN PAUSED</h1>
        <h2>save · load · breathe</h2>
        <div class="ds-grid">${rows}</div>
        <div class="actions">
          <button data-act="export">Export JSON</button>
          <button data-act="close">Resume</button>
        </div>
      </div>`;
    overlay.appendChild(el);
    this.el = el;

    el.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target);
      const act = btn.dataset?.act;
      if (!act) return;
      if (act === 'close') this.close();
      if (act === 'export') exportSave(this.app);
      if (act === 'save') {
        saveToSlot(this.app, btn.dataset.slot);
        feed(`Saved to slot ${btn.dataset.slot}.`, 'system');
        this.close();
      }
      if (act === 'load') {
        const data = readSlot(btn.dataset.slot === 'auto' ? 'auto' : btn.dataset.slot);
        if (data) {
          applySave(this.app, data);
          feed('Save restored.', 'system');
        }
        this.close();
      }
    });
  }
}
