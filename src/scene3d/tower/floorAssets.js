// @ts-check
// What each floor needs from the asset pipeline before it is built.
// World3D.create() awaits this list per floor, so a floor's materials, props and
// sky are decoded before its geometry exists — nothing pops in. PURE.
import { PBR_SET_IDS } from '../materials/pbr.js';
import { PROP_DRESSING } from '../../../data/propDressing.js';

/**
 * @param {string} floorId
 * @returns {{kind: import('../../assets/assets.js').AssetKind, id: string}[]}
 */
export function assetsForFloor(floorId) {
  // the library's sets are shared by every floor; after the first floor these resolve from cache
  /** @type {{kind: import('../../assets/assets.js').AssetKind, id: string}[]} */
  const list = PBR_SET_IDS.map((id) => ({ kind: 'pbr', id }));
  // this floor's own clutter (data/propDressing.js)
  for (const p of PROP_DRESSING) if (p.floor === floorId) list.push({ kind: 'gltf', id: p.asset });
  return list;
}
