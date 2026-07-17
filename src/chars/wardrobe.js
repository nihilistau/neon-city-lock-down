// @ts-check
// Wardrobe state machine: builds outfit layer sets lazily, toggles visibility,
// emits change events. The `none` state (and explicitness rendering caps) land
// with the Phase 4 intimacy pass — for now every character keeps a base layer.
import { buildOutfit } from '../humanoid/outfitBuilder.js';
import { OUTFITS } from '../../data/outfits.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';

export class Wardrobe {
  /**
   * @param {import('./character.js').Character} character
   * @param {string} initial outfit id
   */
  constructor(character, initial) {
    this.c = character;
    /** @type {Record<string, import('three').SkinnedMesh[]>} built layer cache */
    this.layers = {};
    this.current = null;
    this.change(initial, true);
  }

  available() {
    return Object.keys(OUTFITS[this.c.id] || {});
  }

  /**
   * @param {string} outfitId
   * @param {boolean} [silent]
   */
  change(outfitId, silent = false) {
    const recipes = OUTFITS[this.c.id];
    if (!recipes || !recipes[outfitId] || outfitId === this.current) return false;

    if (!this.layers[outfitId]) {
      const meshes = buildOutfit(this.c.persona, this.c.actor.rig, recipes[outfitId]);
      for (const m of meshes) this.c.actor.root.add(m);
      this.layers[outfitId] = meshes;
    }
    for (const [id, meshes] of Object.entries(this.layers)) {
      for (const m of meshes) m.visible = id === outfitId;
    }
    const prev = this.current;
    this.current = outfitId;
    if (!silent) {
      emit('wardrobe.changed', { id: this.c.id, outfit: outfitId, prev });
      feed(`${this.c.name} changed into ${outfitId.replace('_', ' ')}.`, 'info');
    }
    return true;
  }

  serialize() { return { current: this.current }; }
  deserialize(d) { if (d?.current) this.change(d.current, true); }
}
