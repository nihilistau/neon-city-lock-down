// @ts-check
// Wardrobe state machine: builds outfit layer sets lazily, toggles visibility,
// emits change events. The `none` state (and explicitness rendering caps) land
// with the Phase 4 intimacy pass — for now every character keeps a base layer.
import { buildOutfit } from '../humanoid/outfitBuilder.js';
import { OUTFITS } from '../../data/outfits.js';
import { EXPLICITNESS_CAP } from './gates.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';

/** what `none`/`underwear` actually RENDER as, per explicitness cap. The
 *  wardrobe state is honest (for stats/warmth); the render is capped for taste. */
function renderState(outfitId, explicitness) {
  if (explicitness === 'full') return outfitId;
  if (explicitness === 'mature') {
    if (outfitId === 'none') return 'underwear';
    return outfitId;
  }
  // suggestive: never render below underwear-equivalent; none/underwear → towel
  if (outfitId === 'none' || outfitId === 'underwear') return 'towel';
  return outfitId;
}

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
   * @param {string} outfitId  the LOGICAL wardrobe state (may be capped in render)
   * @param {boolean} [silent]
   */
  change(outfitId, silent = false) {
    const recipes = OUTFITS[this.c.id];
    if (!recipes || !recipes[outfitId] || outfitId === this.current) return false;

    const explicitness = globalThis.__ncldExplicitness || 'mature';
    const renderId = renderState(outfitId, explicitness);
    const recipe = recipes[renderId] || recipes[outfitId];

    if (!this.layers[renderId]) {
      const meshes = buildOutfit(this.c.persona, this.c.actor.rig, recipe);
      for (const m of meshes) this.c.actor.root.add(m);
      this.layers[renderId] = meshes;
    }
    for (const [id, meshes] of Object.entries(this.layers)) {
      for (const m of meshes) m.visible = id === renderId;
    }
    const prev = this.current;
    this.current = outfitId;      // logical state stays honest
    this._renderId = renderId;
    if (!silent) {
      emit('wardrobe.changed', { id: this.c.id, outfit: outfitId, render: renderId, prev });
      feed(`${this.c.name} changed into ${outfitId.replace('_', ' ')}.`, 'info');
    }
    return true;
  }

  serialize() { return { current: this.current }; }
  deserialize(d) { if (d?.current) this.change(d.current, true); }
}
