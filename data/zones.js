// @ts-check
// Zone + floor definitions for the whole tower. Floors live at large world-X
// offsets in one scene; the elevator teleports between them. Coordinates are
// floor-local meters (y=0 ground) — the builder adds each floor's offset.

/**
 * @typedef {Object} ZoneDef
 * @property {string} id @property {string} name @property {string} floor
 * @property {{x:[number,number], z:[number,number]}} bounds  floor-local
 * @property {[number,number]} anchor
 * @property {Record<string,[number,number]>} waypoints
 * @property {{type:string, at:[number,number], ry?:number, opts?:any, id?:string}[]} furniture
 * @property {Record<string, {via?: [number,number][]}>} adjacent  same-floor edges
 * @property {string} ambience
 */

/** Floor meta: world offset + shell builder key + elevator lobby point. */
export const FLOORS = {
  penthouse: { id: 'penthouse', label: 'Floor 45 — Penthouse', offsetX: 0, shell: 'penthouse', elevator: [-10.6, -5.0], travel: 0 },
  rooftop: { id: 'rooftop', label: 'Rooftop — Garden & Helipad', offsetX: 200, shell: 'rooftop', elevator: [-8, -6], travel: 1 },
  fl40: { id: 'fl40', label: 'Floor 40 — Security', offsetX: 400, shell: 'fl40', elevator: [-8, 0], travel: 2 },
  fl27: { id: 'fl27', label: 'Floor 27 — VOX Core', offsetX: 600, shell: 'fl27', elevator: [-6, 0], travel: 4 },
  fl12: { id: 'fl12', label: 'Floor 12 — Medical', offsetX: 800, shell: 'fl12', elevator: [-6, 0], travel: 6 },
  ground: { id: 'ground', label: 'Ground — Reception', offsetX: 1000, shell: 'ground', elevator: [-8, -6], travel: 8 },
  basement: { id: 'basement', label: 'Basement — Carpark', offsetX: 1200, shell: 'basement', elevator: [-10, -8], travel: 9 },
};

/** @type {Record<string, ZoneDef>} */
export const ZONES = {
  // ─── PENTHOUSE (7 zones) — expanded west wing ───
  lounge: {
    id: 'lounge', name: 'Penthouse Lounge', floor: 'penthouse',
    bounds: { x: [-8, 0.5], z: [-6, 6] },
    anchor: [-3.6, 1.2],
    waypoints: {
      center: [-3.6, 1.2], couch_front: [-4, 0.2], window: [-3, 4.6], corner: [-6.5, -3],
    },
    furniture: [
      { type: 'rug', at: [-4, 0.4] },
      { type: 'couch', at: [-4, -1.3], ry: 0, id: 'couch' },
      { type: 'coffee_table', at: [-4, -0.1] },
      { type: 'floor_lamp', at: [-6.6, -2.6], opts: { color: 0xffb347 } },
      { type: 'planter', at: [-7.2, 4.8] },
      { type: 'fish_tank', at: [-0.5, -5.0], ry: 0, id: 'fish_tank' },
    ],
    adjacent: {
      bar: {}, balcony: { via: [[4.25, 4.6], [4.25, 6.8]] },
      fireplace: {}, bed_alcove: { via: [[-8.6, 1.0]] },
    },
    ambience: 'apartment',
  },
  fireplace: {
    id: 'fireplace', name: 'Fireplace Nook', floor: 'penthouse',
    bounds: { x: [-8, -4.5], z: [-6, -3.4] },
    anchor: [-6.4, -4.5],
    waypoints: { center: [-6.4, -4.5], hearth: [-6.4, -5.2] },
    furniture: [
      { type: 'fireplace', at: [-6.4, -5.85], ry: 0, id: 'fireplace' },
      { type: 'armchair', at: [-7.3, -4.4], ry: 0.9, id: 'armchair0' },
      { type: 'armchair', at: [-5.5, -4.4], ry: -0.9, id: 'armchair1' },
      { type: 'rug', at: [-6.4, -4.6], opts: { radius: 1.2 } },
    ],
    adjacent: { lounge: {} },
    ambience: 'apartment',
  },
  bar: {
    id: 'bar', name: 'Bar & Kitchenette', floor: 'penthouse',
    bounds: { x: [0.5, 8], z: [-6, 0] },
    anchor: [4, -2.2],
    waypoints: { center: [4, -2.2], front: [4.2, -3.1], behind: [4.2, -4.9], corner: [7, -1] },
    furniture: [
      { type: 'bar_counter', at: [4.2, -4.2], ry: 0, id: 'bar_counter' },
      { type: 'bar_shelves', at: [4.2, -5.75], ry: 0 },
      { type: 'bar_stool', at: [3.2, -3.35], id: 'stool0' },
      { type: 'bar_stool', at: [4.2, -3.35], id: 'stool1' },
      { type: 'bar_stool', at: [5.2, -3.35], id: 'stool2' },
      { type: 'vinyl_player', at: [7.3, -4.6], ry: -Math.PI / 2, id: 'vinyl' },
      { type: 'synth_keys', at: [7.3, -2.4], ry: -Math.PI / 2, id: 'synth' },
    ],
    adjacent: { lounge: {}, balcony: { via: [[4.25, 4.6], [4.25, 6.8]] } },
    ambience: 'apartment',
  },
  balcony: {
    id: 'balcony', name: 'Balcony', floor: 'penthouse',
    bounds: { x: [1, 7], z: [6, 9] },
    anchor: [4.2, 7.6],
    waypoints: { center: [4.2, 7.6], rail: [4.2, 8.4], telescope_spot: [5.7, 7.9] },
    furniture: [
      { type: 'telescope', at: [5.7, 8.2], ry: Math.PI, id: 'telescope' },
      { type: 'planter', at: [1.6, 8.4] },
    ],
    adjacent: { lounge: { via: [[4.25, 6.8], [4.25, 4.6]] }, bar: { via: [[4.25, 6.8], [4.25, 4.6]] } },
    ambience: 'balcony',
  },
  bed_alcove: {
    id: 'bed_alcove', name: 'Bed Alcove', floor: 'penthouse',
    bounds: { x: [-14, -8.6], z: [0, 6] },
    anchor: [-11.2, 2.6],
    waypoints: { center: [-11.2, 2.6], bedside: [-12.2, 2.0], window: [-9.6, 4.8] },
    furniture: [
      { type: 'bed', at: [-12.1, 3.6], ry: 0, id: 'bed' },
      { type: 'floor_lamp', at: [-9.4, 0.7], opts: { color: 0x9d6bff } },
      { type: 'rug', at: [-11, 1.6], opts: { radius: 1.3 } },
    ],
    adjacent: { lounge: { via: [[-8.6, 1.0]] }, vanity: {}, shower: { via: [[-11.5, -0.4]] } },
    ambience: 'apartment',
  },
  vanity: {
    id: 'vanity', name: 'Vanity & Dressing', floor: 'penthouse',
    bounds: { x: [-14, -8.6], z: [-3.2, 0] },
    anchor: [-12.4, -1.6],
    waypoints: { center: [-12.4, -1.6], mirror: [-13.2, -1.6] },
    furniture: [
      { type: 'vanity_table', at: [-13.55, -1.6], ry: Math.PI / 2, id: 'vanity_table' },
      { type: 'wardrobe_rack', at: [-9.4, -2.6], ry: 0, id: 'wardrobe_rack' },
    ],
    adjacent: { bed_alcove: {} },
    ambience: 'apartment',
  },
  shower: {
    id: 'shower', name: 'Shower Pod', floor: 'penthouse',
    bounds: { x: [-14, -8.6], z: [-6, -3.2] },
    anchor: [-11.4, -4.4],
    waypoints: { center: [-11.4, -4.4], pod: [-12.6, -4.6] },
    furniture: [
      { type: 'shower_pod', at: [-12.8, -4.6], id: 'shower_pod' },
      { type: 'sink_counter', at: [-9.4, -5.4], ry: Math.PI, id: 'sink' },
    ],
    adjacent: { bed_alcove: { via: [[-11.5, -0.4]] } },
    ambience: 'apartment',
  },

  // ─── ROOFTOP ───
  rooftop: {
    id: 'rooftop', name: 'Rooftop Garden', floor: 'rooftop',
    bounds: { x: [-10, 10], z: [-8, 8] },
    anchor: [0, 0],
    waypoints: { center: [0, 0], helipad: [4.5, 0], garden: [-5, 3], edge: [0, 7] },
    furniture: [
      { type: 'planter_bed', at: [-5, 2], id: 'garden0' },
      { type: 'planter_bed', at: [-5, 4.2], id: 'garden1' },
      { type: 'planter_bed', at: [-7.2, 3.1], ry: Math.PI / 2, id: 'garden2' },
      { type: 'helipad', at: [4.5, 0], id: 'helipad' },
      { type: 'crate', at: [-2, -6], id: 'roof_crate' },
    ],
    adjacent: {},
    ambience: 'balcony',
  },

  // ─── FLOOR 40 — SECURITY + ARMOURY ───
  security: {
    id: 'security', name: 'Security Room', floor: 'fl40',
    bounds: { x: [-10, 0], z: [-6, 6] },
    anchor: [-4, 0],
    waypoints: { center: [-4, 0], desk: [-4, -1.6], monitors: [-4, -3] },
    furniture: [
      { type: 'security_desk', at: [-4, -2.2], ry: 0, id: 'security_desk' },
      { type: 'monitor_wall', at: [-4, -5.6], ry: 0, id: 'monitor_wall' },
      { type: 'server_rack', at: [-9.3, 3], ry: Math.PI / 2 },
      { type: 'server_rack', at: [-9.3, 4.6], ry: Math.PI / 2 },
    ],
    adjacent: { armoury: { via: [[0.5, 0]] } },
    ambience: 'server',
  },
  armoury: {
    id: 'armoury', name: 'Armoury', floor: 'fl40',
    bounds: { x: [0, 10], z: [-6, 6] },
    anchor: [4, 0],
    waypoints: { center: [4, 0], racks: [6, -3], lockers: [6, 3] },
    furniture: [
      { type: 'weapon_rack', at: [8.6, -3], ry: -Math.PI / 2, id: 'weapon_rack' },
      { type: 'locker_bank', at: [8.6, 3], ry: -Math.PI / 2, id: 'lockers' },
      { type: 'crate', at: [3, -4.5], id: 'ammo_crate' },
      { type: 'crate', at: [4.2, -4.7], id: 'supply_crate' },
    ],
    adjacent: { security: { via: [[0.5, 0]] } },
    ambience: 'server',
  },

  // ─── FLOOR 27 — VOX CORE ───
  vox_core: {
    id: 'vox_core', name: 'VOX Core', floor: 'fl27',
    bounds: { x: [-8, 8], z: [-8, 8] },
    anchor: [0, -3],
    waypoints: { center: [0, -3], core: [0, 0.4], terminal: [-3, -2] },
    furniture: [
      { type: 'vox_monolith', at: [0, 2], id: 'vox_monolith' },
      { type: 'server_rack', at: [-6.5, -4], ry: Math.PI / 2 },
      { type: 'server_rack', at: [-6.5, -2], ry: Math.PI / 2 },
      { type: 'server_rack', at: [6.5, -4], ry: -Math.PI / 2 },
      { type: 'server_rack', at: [6.5, -2], ry: -Math.PI / 2 },
      { type: 'terminal', at: [-3.4, -2], ry: Math.PI / 2, id: 'vox_terminal' },
    ],
    adjacent: {},
    ambience: 'server',
  },

  // ─── FLOOR 12 — MEDICAL ───
  medical: {
    id: 'medical', name: 'Medical Bay', floor: 'fl12',
    bounds: { x: [-8, 8], z: [-6, 6] },
    anchor: [0, 0],
    waypoints: { center: [0, 0], gurney: [2, -1.5], cabinet: [-4, -4] },
    furniture: [
      { type: 'gurney', at: [2, -2.4], ry: 0, id: 'gurney0' },
      { type: 'gurney', at: [5, -2.4], ry: 0, id: 'gurney1' },
      { type: 'med_cabinet', at: [-4.5, -5.3], ry: 0, id: 'med_cabinet' },
      { type: 'sink_counter', at: [-6.5, 2], ry: Math.PI / 2, id: 'med_sink' },
      { type: 'privacy_screen', at: [3.5, -1], ry: 0 },
    ],
    adjacent: {},
    ambience: 'medical',
  },

  // ─── GROUND — RECEPTION ───
  reception: {
    id: 'reception', name: 'Reception', floor: 'ground',
    bounds: { x: [-10, 10], z: [-8, 10] },
    anchor: [0, 0],
    waypoints: { center: [0, 0], desk: [-2, -2], doors: [0, 8], barricade: [0, 6] },
    furniture: [
      { type: 'reception_desk', at: [-2, -3], ry: 0, id: 'reception_desk' },
      { type: 'couch', at: [-7, 1], ry: Math.PI / 2, id: 'lobby_couch' },
      { type: 'planter', at: [-7, 5] },
      { type: 'planter', at: [7, 5] },
      { type: 'barricade', at: [0, 6.6], ry: 0, id: 'barricade' },
      { type: 'pillar', at: [-4, 3] }, { type: 'pillar', at: [4, 3] },
    ],
    adjacent: {},
    ambience: 'lobby',
  },

  // ─── BASEMENT — CARPARK ───
  carpark: {
    id: 'carpark', name: 'Basement Carpark', floor: 'basement',
    bounds: { x: [-14, 14], z: [-10, 10] },
    anchor: [0, 0],
    waypoints: { center: [0, 0], ramp: [12, 6], deep: [-10, -6] },
    furniture: [
      { type: 'car', at: [-6, -5], ry: 0.1, opts: { color: 0x20242e } },
      { type: 'car', at: [-1, -5], ry: -0.06, opts: { color: 0x3d1028 } },
      { type: 'car', at: [7, -5], ry: 0.14, opts: { color: 0x14202c } },
      { type: 'car', at: [-8, 5], ry: 3.2, opts: { color: 0x2c2434 } },
      { type: 'pillar', at: [-7, 0] }, { type: 'pillar', at: [0, 0] },
      { type: 'pillar', at: [7, 0] },
      { type: 'crate', at: [11, -7], id: 'stash_crate' },
    ],
    adjacent: {},
    ambience: 'carpark',
  },
};

/** Penthouse shell dims (builder + FP collision). Expanded with the west wing. */
export const PENTHOUSE = {
  floor: { x: [-14, 8], z: [-6, 6] },
  balcony: { x: [1, 7], z: [6, 9] },
  doorGap: { x: [3.55, 4.95] },          // opening in the +z glass wall
  wingDoor: { z: [0.2, 1.8] },           // opening in the x=-8.6 interior wall
  showerDoor: { x: [-12.2, -10.8] },     // opening in the wing's z=-3.2 wall? (bed→shower via z=0 wall gap)
  ceilingY: 3.1,
};
