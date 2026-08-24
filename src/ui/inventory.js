// @ts-check
// Inventory panel (I). Grid of carried items; equip weapons, use consumables,
// inspect descriptions. Also shows the equipped-weapon chip on the HUD.
import { ITEMS } from '../../data/items.js';
import { on } from '../core/bus.js';
import { h } from './widgets.js';
import { iconUrl, itemIconSrc } from './icons.js';
import { openModal, closeModal } from './modalStack.js';

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
      // …and <select>: typing 'i' to jump to an option in the chat addressee
      // dropdown used to open this panel and pause the sim
      if (e.code === 'KeyI' && this.app.mode === 'run'
          && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) {
        this.toggle();
      }
    });
  }

  _renderChip(def) {
    const src = itemIconSrc(def.id);
    const ico = src
      ? `<img class="wc-ico" alt="" src="${src}">`
      : `<span class="wc-icon">${def.icon}</span>`;
    this.chip.innerHTML = `${ico} ${def.name}`;
  }

  toggle() { this.open ? this.close() : this.show(); }
  close() { this.open = false; this.el?.remove(); this.el = null; this.app.loop.resume('inventory'); closeModal('inventory'); }

  show() {
    this.open = true;
    this.app.loop.pause('inventory'); openModal('inventory', () => this.close());
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
      const src = itemIconSrc(id);
      const ico = src
        ? h('img', { class: 'inv-ico', src, alt: '' })
        : h('div', { class: 'inv-icon' }, [def.icon]);
      return h('div', { class: `inv-item type-${def.type} ${equipped ? 'equipped' : ''}` }, [
        ico,
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

    const el = h('div', { class: 'plan-wrap' }, [
      h('div', { class: 'plan-scrim', onclick: () => this.close() }),
      h('div', { class: 'plan-drawer clickable inv-drawer' }, [
        h('div', { class: 'game-head' }, [
          h('h1', { class: 'neon-title plan-title' }, [
            h('img', { class: 'chip-ico', src: iconUrl('inventory'), alt: '' }),
            ' INVENTORY',
          ]),
          h('button', { onclick: () => this.close() }, ['Close (I)']),
        ]),
        h('h2', {}, [`equipped: ${ITEMS[inv.equipped].name}`]),
        h('div', { class: 'inv-grid' }, cards.length > 1 || inv.items.length ? cards : [h('p', {}, ['Empty. Loot crates, the armoury, and fallen hostiles for gear.'])]),
      ]),
    ]);
    overlay.appendChild(el);
    this.el = el;
  }
}
