// @ts-check
// Zone definitions. Slice: three penthouse zones on one open floor.
// Coordinates are world meters on the penthouse floor plane (y=0).
// The full 15-zone tower graph lands in Phase 2 — same schema, more floors.

/**
 * @typedef {Object} ZoneDef
 * @property {string} id
 * @property {string} name
 * @property {string} floor
 * @property {{x:[number,number], z:[number,number]}} bounds
 * @property {[number,number]} anchor          default stand point (x,z)
 * @property {Record<string,[number,number]>} waypoints
 * @property {{type:string, at:[number,number], ry?:number, opts?:any, id?:string}[]} furniture
 * @property {Record<string, {via?: [number,number][]}>} adjacent
 * @property {string} ambience
 */

/** @type {Record<string, ZoneDef>} */
export const ZONES = {
  lounge: {
    id: 'lounge',
    name: 'Penthouse Lounge',
    floor: 'penthouse',
    bounds: { x: [-8, 0.5], z: [-6, 6] },
    anchor: [-3.6, 1.2],
    waypoints: {
      center: [-3.6, 1.2],
      couch_front: [-4, 0.2],
      window: [-3, 4.6],
      corner: [-6.5, -3],
    },
    furniture: [
      { type: 'rug', at: [-4, 0.4] },
      { type: 'couch', at: [-4, -1.3], ry: 0, id: 'couch' },
      { type: 'coffee_table', at: [-4, -0.1] },
      { type: 'floor_lamp', at: [-6.6, -2.6], opts: { color: 0xffb347 } },
      { type: 'planter', at: [-7.2, 4.8] },
      { type: 'planter', at: [-0.4, -5.2] },
    ],
    adjacent: {
      bar: {},
      balcony: { via: [[4.25, 4.6], [4.25, 6.8]] },
    },
    ambience: 'apartment',
  },

  bar: {
    id: 'bar',
    name: 'Bar',
    floor: 'penthouse',
    bounds: { x: [0.5, 8], z: [-6, 0] },
    anchor: [4, -2.2],
    waypoints: {
      center: [4, -2.2],
      front: [4.2, -3.1],
      behind: [4.2, -4.9],
      corner: [7, -1],
    },
    furniture: [
      { type: 'bar_counter', at: [4.2, -4.2], ry: 0, id: 'bar_counter' },
      { type: 'bar_shelves', at: [4.2, -5.75], ry: 0 },
      { type: 'bar_stool', at: [3.2, -3.35], id: 'stool0' },
      { type: 'bar_stool', at: [4.2, -3.35], id: 'stool1' },
      { type: 'bar_stool', at: [5.2, -3.35], id: 'stool2' },
      { type: 'vinyl_player', at: [7.3, -4.6], ry: -Math.PI / 2, id: 'vinyl' },
    ],
    adjacent: {
      lounge: {},
      balcony: { via: [[4.25, 4.6], [4.25, 6.8]] },
    },
    ambience: 'apartment',
  },

  balcony: {
    id: 'balcony',
    name: 'Balcony',
    floor: 'penthouse',
    bounds: { x: [1, 7], z: [6, 9] },
    anchor: [4.2, 7.6],
    waypoints: {
      center: [4.2, 7.6],
      rail: [4.2, 8.4],
      telescope_spot: [5.7, 7.9],
    },
    furniture: [
      { type: 'telescope', at: [5.7, 8.2], ry: Math.PI, id: 'telescope' },
      { type: 'planter', at: [1.6, 8.4] },
    ],
    adjacent: {
      lounge: { via: [[4.25, 6.8], [4.25, 4.6]] },
      bar: { via: [[4.25, 6.8], [4.25, 4.6]] },
    },
    ambience: 'balcony',
  },
};

/** Penthouse shell dimensions used by the builder + FP collision. */
export const PENTHOUSE = {
  floor: { x: [-8, 8], z: [-6, 6] },
  balcony: { x: [1, 7], z: [6, 9] },
  doorGap: { x: [3.55, 4.95] },   // opening in the +z glass wall
  ceilingY: 3.1,
};
