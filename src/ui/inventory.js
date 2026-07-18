// @ts-check
// Inventory panel (I). Grid of carried items; equip weapons, use consumables,
// inspect descriptions. Also shows the equipped-weapon chip on the HUD.
import { ITEMS } from '../../data/items.js';
import { on } from '../core/bus.js';
import { h } from './widgets.js';

export class InventoryUI {
  /** @param {import('../core/app.js').App} app */
  constructor(app) {
    this.app = app;
    this.open = false;
    this.el = null;

    // HUD weapon chip
    this.chip = document.createElement('div');
    this.chip.id = 'weapon-chip';
    document.getElementById('hud')?.appendChild(this.chip);
    on('inventory.equipped', ({ def }) => this._renderChip(def));
    on('inventory.changed', () => { if (this.open) this._render(); });
    this._renderChip(ITEMS.fists);

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyI' && this.app.mode === 'run'
          && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        this.toggle();
      }
    });
  }

  _renderChip(def) {
    this.chip.innerHTML = `<span class="wc-icon">${def.icon}</span> ${def.name}`;
  }

  toggle() { this.open ? this.close() : this.show(); }
  close() { this.open = false; this.el?.remove(); this.el = null; this.app.loop.resume('inventory'); }

  show() {
    this.open = true;
    this.app.loop.pause('inventory');
    this._render();
  }

  _render() {
    const inv = this.app.inventory;
    const overlay = document.getElementById('overlay');
    if (this.el) this.el.remove();
    // ensure fists is always shown as an equip option
    const rows = [{ id: 'fists', qty: 1 }, ...inv.items];
    const cards = rows.map(({ id, qty }) => {
      const def = ITEMS[id];
      const equipped = inv.equipped === id;
      return h('div', { class: `inv-item type-${def.type} ${equipped ? 'equipped' : ''}` }, [
        h('div', { class: 'inv-icon' }, [def.icon]),
        h('div', { class: 'inv-meta' }, [
          h('div', { class: 'inv-name' }, [def.name + (qty > 1 ? ` ×${qty}` : ''), equipped ? h('span', { class: 'inv-eq' }, [' equipped']) : '']),
          h('div', { class: 'inv-desc' }, [def.desc]),
        ]),
        h('div', { class: 'inv-actions' }, [
          def.type === 'weapon' ? h('button', { onclick: () => inv.equip(id) }, [equipped ? '✓' : 'equip']) : '',
          def.use ? h('button', { onclick: () => { inv.use(id); this._render(); } }, ['use']) : '',
        ].filter(Boolean)),
      ]);
    });

    const el = h('div', { class: 'screen', style: 'background:rgba(4,5,9,0.9)' }, [
      h('div', { class: 'panel', style: 'min-width:480px;max-width:560px;max-height:82vh;overflow-y:auto' }, [
        h('h1', { class: 'neon-title', style: 'font-size:24px' }, ['INVENTORY']),
        h('h2', {}, [`equipped: ${ITEMS[inv.equipped].name} · press I to close`]),
        h('div', { class: 'inv-grid' }, cards.length > 1 || inv.items.length ? cards : [h('p', {}, ['Empty. Loot crates, the armoury, and fallen hostiles for gear.'])]),
        h('div', { class: 'actions' }, [h('button', { onclick: () => this.close() }, ['Close (I)'])]),
      ]),
    ]);
    overlay.appendChild(el);
    this.el = el;
  }
}
