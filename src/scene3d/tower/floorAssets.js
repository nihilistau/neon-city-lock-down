// @ts-check
// What each floor needs from the asset pipeline before it is built.
// World3D.create() awaits this list per floor, so a floor's materials, props and
// sky are decoded before its geometry exists — nothing pops in. PURE.
import { PBR_SET_IDS } from '../materials/pbr.js';
import { PROP_DRESSING } from '../../../data/propDressing.js';

/** Floors whose exterior shows the sky dome (zoneBuilder `_buildExterior`). */
export const SKY_FLOORS = ['penthouse', 'rooftop'];

/**
 * @param {string} floorId
 * @param {{equirect?: string|null}} [opts] the HDRI equirect id the sky dome uses; null = no HDRI
 * @returns {{kind: import('../../assets/assets.js').AssetKind, id: string}[]}
 */
export function assetsForFloor(floorId, { equirect = null } = {}) {
  // the library's sets are shared by every floor; after the first floor these resolve from cache
  /** @type {{kind: import('../../assets/assets.js').AssetKind, id: string}[]} */
  const list = PBR_SET_IDS.map((id) => ({ kind: 'pbr', id }));
  if (equirect && SKY_FLOORS.includes(floorId)) list.push({ kind: 'equirect', id: equirect });
  // this floor's own clutter (data/propDressing.js)
  for (const p of PROP_DRESSING) if (p.floor === floorId) list.push({ kind: 'gltf', id: p.asset });
  return list;
}
