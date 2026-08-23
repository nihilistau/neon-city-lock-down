// @ts-check
// Save/load menu (Esc). Three slots + autosave restore + export/import.
import { saveToSlot, readSlot, applySave, listSlots, exportSave, importSave } from '../core/save.js';
import { feed } from '../core/log.js';
import { emit } from '../core/bus.js';
import { escapeHtml } from './widgets.js';
import { openModal, closeModal } from './modalStack.js';

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
    this.app.loop.resume('menu'); closeModal('menu');
  }

  show() {
    this.open = true;
    this.app.loop.pause('menu'); openModal('menu', () => this.close());
    const overlay = document.getElementById('overlay');
    const el = document.createElement('div');
    el.className = 'screen';
    el.style.background = 'rgba(4,5,9,0.82)';
    const rows = listSlots().map(({ slot, meta }) => `
      <div class="ds-row save-slot" data-slot="${slot}">
        <span>${slot === 'auto' ? 'Autosave' : `Slot ${slot}`} — ${meta ? `${escapeHtml(meta.label)} (${escapeHtml(meta.playerName)})` : 'empty'}</span>
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
        <div class="actions" style="flex-wrap:wrap">
          <button data-act="export">Export JSON</button>
          <button data-act="import">Import JSON</button>
          <button data-act="settings">Settings</button>
          <button data-act="director">Director</button>
          <button data-act="kit">Kit</button>
          <button data-act="codex">Codex</button>
          <button data-act="close">Resume</button>
          <button data-act="quit" class="danger">Quit to menu</button>
        </div>
      </div>`;
    overlay.appendChild(el);
    this.el = el;

    el.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target);
      const act = btn.dataset?.act;
      if (!act) return;
      if (act === 'close') this.close();
      if (act === 'settings') {
        this.close();
        this.app.directorPanel?.setOpen(true);
        this.app.directorPanel?.showTab('settings');
      }
      if (act === 'director') {
        this.close();
        this.app.directorPanel?.setOpen(true);
      }
      if (act === 'codex') {
        this.close();
        this.app.codex?.show();
      }
      if (act === 'kit') {
        this.close();
        this.app.kitPanel?.show();
      }
      if (act === 'quit') {
        if (confirm('Quit to the main menu? Unsaved progress lives in autosave.')) location.reload();
      }
      if (act === 'export') exportSave(this.app);
      if (act === 'import') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return;
          const text = await file.text();
          const res = importSave(this.app, text);
          feed(res.ok ? 'Save imported.' : `Import failed (${res.reason}).`, res.ok ? 'system' : 'warn');
          this.close();
        });
        input.click();
      }
      if (act === 'save') {
        saveToSlot(this.app, btn.dataset.slot);
        feed(`Saved to slot ${btn.dataset.slot}.`, 'system');
        this.close();
      }
      if (act === 'load') {
        const data = readSlot(btn.dataset.slot === 'auto' ? 'auto' : btn.dataset.slot);
        if (data) {
          // applySave throws on a version mismatch. Uncaught, the exception left
          // the handler before close(), so the menu stayed open still holding its
          // pause token and the player got no message at all. importSave already
          // wrapped the identical call — this path just never did.
          try {
            applySave(this.app, data);
            feed('Save restored.', 'system');
          } catch (err) {
            const why = err instanceof Error ? err.message : 'unknown error';
            feed(`Could not load that save — ${why}.`, 'warn');
            emit('hud.alert', { text: 'Load failed', kind: 'danger' });
          }
        }
        this.close();
      }
    });
  }
}
