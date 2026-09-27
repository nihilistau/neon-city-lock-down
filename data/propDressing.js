// @ts-check
// Opt-in CC0 clutter. Each entry places ONE model from a Kenney pack
// (assets/manifest.json → kenney_*) on a floor, re-skinned with a PBR library
// material so it shares the room's surfaces instead of Kenney's flat palette.
// Clutter only: the hero furniture stays procedural (src/scene3d/tower/
// furniture.js) — Kenney's chunky style reads as detail at hand scale and as a
// toy at room scale.
//
// A model that did not load is simply absent: dressing never falls back to a
// placeholder, so ?noassets=1 shows the v0.6 room.
//
// PURE DATA. tools/lint-assets.mjs checks every `asset` against the manifest
// and every `skin` against the PBR library.

/**
 * @typedef {object} PropDressing
 * @property {string} asset 'pack/model' — a model `as` name in assets/manifest.json
 * @property {string} floor
 * @property {[number, number]} at floor-local x, z in metres
 * @property {number} [y] base height: the top of whatever it stands on (default 0, the floor)
 * @property {number} [ry] yaw in radians
 * @property {number} height fitted height in metres (the model is scaled uniformly to it)
 * @property {string} skin a PBR_LIBRARY material name
 * @property {boolean} [solid] register its bounding box as an FP collider
 */

/** @type {PropDressing[]} */
export const PROP_DRESSING = [
  // penthouse — bar counter top y 1.09, coffee table top y 0.39
  { asset: 'kenney_furniture/books', floor: 'penthouse', at: [5.3, -4.3], y: 1.09, ry: 0.3, height: 0.2, skin: 'fabric' },
  { asset: 'kenney_furniture/plant_small', floor: 'penthouse', at: [-3.55, -0.2], y: 0.39, ry: 0.8, height: 0.32, skin: 'fabric' },
  { asset: 'kenney_furniture/trashcan', floor: 'penthouse', at: [2.7, -5.5], height: 0.5, skin: 'metal' },
  // fl40 — security desk top y 0.785
  { asset: 'kenney_furniture/laptop', floor: 'fl40', at: [-4.7, -2.3], y: 0.785, ry: 0.15, height: 0.22, skin: 'metalDark' },
  // basement — boxes stacked by the stash crate
  { asset: 'kenney_furniture/box_closed', floor: 'basement', at: [9.6, -7.1], ry: 0.4, height: 0.5, skin: 'wood', solid: true },
  { asset: 'kenney_furniture/box_closed', floor: 'basement', at: [9.9, -6.3], ry: -0.2, height: 0.42, skin: 'wood', solid: true },
  // rooftop — clear of the helipad (centre 4.5,0, r 3.2), the planters and the HVAC units
  { asset: 'kenney_industrial/tank', floor: 'rooftop', at: [8.2, 5.6], height: 2.4, skin: 'rust', solid: true },
  { asset: 'kenney_industrial/solar_panel', floor: 'rooftop', at: [-2.5, 6.4], ry: Math.PI, height: 1.1, skin: 'metal', solid: true },
];
