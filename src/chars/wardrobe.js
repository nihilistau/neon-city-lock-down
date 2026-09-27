// @ts-check
// Wardrobe state machine: builds outfit layer sets lazily, toggles visibility,
// emits change events.
import { buildOutfit } from '../humanoid/outfitBuilder.js';
import { OUTFITS, DEFAULT_OUTFIT } from '../../data/outfits.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';

export class Wardrobe {
  /**
   * @param {import('./character.js').Character} character
   * @param {string} [initial] outfit id; defaults to data/outfits.js DEFAULT_OUTFIT
   */
  constructor(character, initial) {
    this.c = character;
    /** @type {Record<string, import('three').SkinnedMesh[]>} built layer cache */
    this.layers = {};
    this.current = null;
    // `initial` is optional so every character in OUTFITS can be given a wardrobe
    // with one uniform line. Kai has had the full outfit matrix in data/outfits.js
    // from the start but no Wardrobe was ever constructed for him, so every
    // [[outfit:X]] the LLM emitted for Kai was a silent no-op (the call sites are
    // all `wardrobe?.change(...)`, so nothing even warned).
    this.change(initial || DEFAULT_OUTFIT[character.id] || this.available()[0], true);
  }

  available() {
    return Object.keys(OUTFITS[this.c.id] || {});
  }

  /** true when this character has any outfit recipes at all */
  static supports(id) { return !!OUTFITS[id]; }

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
