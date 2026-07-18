// @ts-check
// Player inventory: discrete carried items (weapons, consumables, valuables, key
// items). Bulk survival stock stays in run.resources. The equipped weapon feeds
// the combat resolver.
import { ITEMS, STARTING_KITS } from '../../data/items.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';

export class Inventory {
  /** @param {import('../core/app.js').App} app */
  constructor(app) {
    this.app = app;
    /** @type {{id:string, qty:number}[]} */
    this.items = [];
    this.equipped = 'fists';   // weapon item id
  }

  /** @param {string} itemId @param {number} [qty] */
  add(itemId, qty = 1) {
    const def = ITEMS[itemId];
    if (!def) return false;
    const existing = this.items.find((i) => i.id === itemId);
    if (existing && def.stack) existing.qty += qty;
    else if (existing && def.type === 'weapon') { /* dup weapon → ignore */ }
    else this.items.push({ id: itemId, qty });
    emit('inventory.changed', this.snapshot());
    feed(`Picked up ${def.name}${qty > 1 ? ` ×${qty}` : ''}.`, 'info');
    return true;
  }

  /** @param {string} itemId @param {number} [qty] */
  remove(itemId, qty = 1) {
    const idx = this.items.findIndex((i) => i.id === itemId);
    if (idx < 0) return false;
    this.items[idx].qty -= qty;
    if (this.items[idx].qty <= 0) {
      this.items.splice(idx, 1);
      if (this.equipped === itemId) this.equipped = 'fists';
    }
    emit('inventory.changed', this.snapshot());
    return true;
  }

  has(itemId) { return this.items.some((i) => i.id === itemId); }
  count(itemId) { return this.items.find((i) => i.id === itemId)?.qty || 0; }

  /** @param {string} itemId */
  equip(itemId) {
    const def = ITEMS[itemId];
    if (!def || def.type !== 'weapon') return false;
    if (itemId !== 'fists' && !this.has(itemId)) return false;
    this.equipped = itemId;
    emit('inventory.equipped', { id: itemId, def });
    feed(`Equipped ${def.name}.`, 'info');
    return true;
  }

  /** the resolver-ready weapon key + whether it needs ammo */
  equippedWeapon() {
    const def = ITEMS[this.equipped] || ITEMS.fists;
    return { key: def.weaponKey || 'shiv', ranged: !!def.ranged, name: def.name };
  }

  /** @param {string} itemId */
  use(itemId) {
    const def = ITEMS[itemId];
    if (!def || !def.use || !this.has(itemId)) return false;
    const msg = def.use(this.app);
    this.remove(itemId, 1);
    // consumables commonly touch player health / resources — refresh both HUDs
    emit('resources.changed', this.app.run.resources);
    emit('player.health', { health: this.app.run.player.health });
    if (msg) emit('hud.alert', { text: msg, kind: 'info' });
    feed(msg || `Used ${def.name}.`, 'info');
    return true;
  }

  /** seed a fresh run's kit from a loadout id (fixer/hoarder/gunhand) */
  applyLoadout(loadoutId) {
    const kit = STARTING_KITS[loadoutId] || STARTING_KITS.fixer;
    this.items = kit.map((k) => ({ ...k }));
    const weapon = this.items.find((i) => ITEMS[i.id]?.type === 'weapon');
    this.equipped = weapon ? weapon.id : 'fists';
    emit('inventory.changed', this.snapshot());
    emit('inventory.equipped', { id: this.equipped, def: ITEMS[this.equipped] });
  }

  snapshot() {
    return { items: this.items.map((i) => ({ ...i })), equipped: this.equipped };
  }
  serialize() { return this.snapshot(); }
  /** @param {any} d */
  deserialize(d) {
    if (!d) return;
    this.items = (d.items || []).map((i) => ({ ...i }));
    this.equipped = d.equipped || 'fists';
    emit('inventory.changed', this.snapshot());
  }
}
