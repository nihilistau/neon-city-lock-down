// @ts-check
// Parametric furniture generators. Every piece returns { group, sockets, colliders }.
// Sockets are named Object3D anchors (seat0, lie_center, lean_bar, surface…) that
// ActorQueue / paired poses target. Colliders are local-space AABBs for FP collision.
import * as THREE from 'three';
import { PALETTE } from '../materials/palette.js';
import { fabricTex, woodTex, marbleTex, metalTex } from '../materials/texGen.js';

/** @typedef {{ group: THREE.Group, sockets: Record<string, THREE.Object3D>,
 *              colliders: {min:[number,number,number], max:[number,number,number]}[] }} Furniture */

const mat = {
  fabric: () => new THREE.MeshStandardMaterial({ map: fabricTex(), roughness: 0.9 }),
  leather: () => new THREE.MeshStandardMaterial({ color: PALETTE.leather, roughness: 0.55, metalness: 0.05 }),
  wood: () => new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.7 }),
  marble: () => new THREE.MeshStandardMaterial({ map: marbleTex(), roughness: 0.25, metalness: 0.1 }),
  metal: () => new THREE.MeshStandardMaterial({ map: metalTex(), roughness: 0.4, metalness: 0.7 }),
  metalDark: () => new THREE.MeshStandardMaterial({ color: PALETTE.metalDark, roughness: 0.5, metalness: 0.6 }),
  glow: (color, intensity = 2) => new THREE.MeshStandardMaterial({
    color: 0x111111, emissive: new THREE.Color(color), emissiveIntensity: intensity,
  }),
};

function socket(group, name, x, y, z, yaw = 0) {
  const s = new THREE.Object3D();
  s.name = `socket_${name}`;
  s.position.set(x, y, z);
  s.rotation.y = yaw;
  group.add(s);
  return s;
}

function box(group, material, w, h, d, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = m.receiveShadow = true;
  group.add(m);
  return m;
}

/** @type {Record<string, (opts?: any) => Furniture>} */
export const FURNITURE = {

  couch(opts = {}) {
    const group = new THREE.Group();
    const w = opts.width ?? 2.3;
    const fab = mat.fabric();
    const dark = mat.metalDark();
    box(group, fab, w, 0.16, 0.95, 0, 0.28, 0);            // seat base
    box(group, fab, w, 0.42, 0.22, 0, 0.62, -0.38);        // backrest
    box(group, fab, 0.22, 0.30, 0.95, -w / 2 + 0.11, 0.51, 0); // arms
    box(group, fab, 0.22, 0.30, 0.95, w / 2 - 0.11, 0.51, 0);
    // seat cushions
    const n = Math.round(w / 0.75);
    for (let i = 0; i < n; i++) {
      const cx = -w / 2 + (i + 0.5) * (w / n);
      box(group, fab, w / n - 0.04, 0.12, 0.8, cx, 0.42, 0.04);
    }
    box(group, dark, w - 0.2, 0.09, 0.8, 0, 0.1, 0);        // plinth
    const sockets = {
      seat0: socket(group, 'seat0', -w / 4, 0.46, 0.1, Math.PI),
      seat1: socket(group, 'seat1', w / 4, 0.46, 0.1, Math.PI),
      lie_center: socket(group, 'lie_center', 0, 0.5, 0.05, Math.PI),
      lean_back: socket(group, 'lean_back', 0, 0, -0.65, 0),
    };
    return { group, sockets, colliders: [{ min: [-w / 2, 0, -0.5], max: [w / 2, 0.9, 0.5] }] };
  },

  coffee_table() {
    const group = new THREE.Group();
    box(group, mat.marble(), 1.2, 0.05, 0.62, 0, 0.36, 0);
    box(group, mat.metalDark(), 1.05, 0.34, 0.5, 0, 0.17, 0);
    const sockets = { surface: socket(group, 'surface', 0, 0.39, 0) };
    return { group, sockets, colliders: [{ min: [-0.6, 0, -0.31], max: [0.6, 0.42, 0.31] }] };
  },

  rug() {
    const group = new THREE.Group();
    const geo = new THREE.CircleGeometry(1.7, 36);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: fabricTex('#231a2e', 6), roughness: 1,
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.012;
    m.receiveShadow = true;
    group.add(m);
    return { group, sockets: { stand: socket(group, 'stand', 0, 0, 0) }, colliders: [] };
  },

  bar_counter(opts = {}) {
    const group = new THREE.Group();
    const w = opts.width ?? 2.6;
    box(group, mat.marble(), w, 0.06, 0.68, 0, 1.06, 0);         // top
    box(group, mat.wood(), w - 0.06, 1.0, 0.58, 0, 0.52, 0);     // body
    // neon underglow strip
    const strip = box(group, mat.glow(PALETTE.neonMagenta, 3), w - 0.1, 0.03, 0.02, 0, 0.96, 0.31);
    strip.castShadow = false;
    const sockets = {
      lean_bar: socket(group, 'lean_bar', 0, 0, 0.62, Math.PI),
      serve: socket(group, 'serve', 0, 0, -0.6, 0),
      surface: socket(group, 'surface', 0, 1.1, 0),
    };
    return { group, sockets, colliders: [{ min: [-w / 2, 0, -0.34], max: [w / 2, 1.1, 0.34] }] };
  },

  bar_stool() {
    const group = new THREE.Group();
    box(group, mat.leather(), 0.4, 0.07, 0.4, 0, 0.72, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.7, 10), mat.metal());
    leg.position.y = 0.36; leg.castShadow = true;
    group.add(leg);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 14), mat.metalDark());
    base.position.y = 0.02;
    group.add(base);
    return {
      group,
      sockets: { seat0: socket(group, 'seat0', 0, 0.76, 0) },
      colliders: [{ min: [-0.2, 0, -0.2], max: [0.2, 0.78, 0.2] }],
    };
  },

  bar_shelves() {
    const group = new THREE.Group();
    box(group, mat.wood(), 2.2, 2.2, 0.28, 0, 1.1, 0);
    // glowing bottle rows
    const bottleMats = [
      mat.glow(PALETTE.neonCyan, 1.6), mat.glow(PALETTE.neonAmber, 1.4),
      mat.glow(PALETTE.neonViolet, 1.6), mat.glow(PALETTE.neonGreen, 1.2),
    ];
    for (let row = 0; row < 3; row++) {
      const y = 0.6 + row * 0.55;
      box(group, mat.metalDark(), 2.0, 0.04, 0.24, 0, y, 0.02);
      for (let i = 0; i < 9; i++) {
        const bm = bottleMats[(row * 3 + i) % bottleMats.length];
        const b = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.045, 0.24 + Math.random() * 0.12, 8), bm);
        b.position.set(-0.9 + i * 0.22 + (Math.random() - 0.5) * 0.04, y + 0.17, 0.02);
        b.castShadow = false;
        group.add(b);
      }
    }
    return { group, sockets: {}, colliders: [{ min: [-1.1, 0, -0.14], max: [1.1, 2.2, 0.14] }] };
  },

  vinyl_player() {
    const group = new THREE.Group();
    box(group, mat.wood(), 0.6, 0.5, 0.42, 0, 0.25, 0);
    box(group, mat.metalDark(), 0.56, 0.06, 0.38, 0, 0.53, 0);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.01, 24), mat.metal());
    disc.position.set(-0.04, 0.575, 0);
    disc.name = 'vinyl_disc';
    group.add(disc);
    const arm = box(group, mat.metal(), 0.02, 0.02, 0.2, 0.16, 0.59, -0.06, 0.4);
    arm.castShadow = false;
    return {
      group,
      sockets: { use: socket(group, 'use', 0, 0, 0.5, Math.PI) },
      colliders: [{ min: [-0.3, 0, -0.21], max: [0.3, 0.6, 0.21] }],
    };
  },

  telescope() {
    const group = new THREE.Group();
    const tripod = mat.metalDark();
    for (const a of [0, 2.1, 4.2]) {
      const leg = box(group, tripod, 0.03, 1.1, 0.03, Math.sin(a) * 0.25, 0.55, Math.cos(a) * 0.25);
      leg.lookAt(0, 1.15, 0);
    }
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.7, 12), mat.metal());
    tube.position.set(0, 1.22, 0);
    tube.rotation.x = Math.PI / 2 - 0.35;
    tube.castShadow = true;
    group.add(tube);
    return {
      group,
      sockets: { use: socket(group, 'use', 0, 0, -0.45, 0) },
      colliders: [{ min: [-0.3, 0, -0.3], max: [0.3, 1.3, 0.3] }],
    };
  },

  floor_lamp(opts = {}) {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.7, 8), mat.metalDark());
    pole.position.y = 0.85;
    group.add(pole);
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.18, 0.24, 12, 1, true),
      mat.glow(opts.color ?? PALETTE.neonAmber, 1.8)
    );
    shade.position.y = 1.72;
    group.add(shade);
    return { group, sockets: {}, colliders: [{ min: [-0.15, 0, -0.15], max: [0.15, 1.85, 0.15] }] };
  },

  planter() {
    const group = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.19, 0.42, 12), mat.metalDark());
    pot.position.y = 0.21; pot.castShadow = true;
    group.add(pot);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x1e4d35, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.7 + Math.random() * 0.4, 5), leafMat);
      const a = (i / 7) * Math.PI * 2;
      leaf.position.set(Math.sin(a) * 0.1, 0.75, Math.cos(a) * 0.1);
      leaf.rotation.set(Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
      group.add(leaf);
    }
    return { group, sockets: {}, colliders: [{ min: [-0.25, 0, -0.25], max: [0.25, 1.1, 0.25] }] };
  },
};

/**
 * Instantiate a furniture piece.
 * @param {string} type @param {any} [opts]
 * @returns {Furniture}
 */
export function makeFurniture(type, opts) {
  const gen = FURNITURE[type];
  if (!gen) throw new Error(`unknown furniture type: ${type}`);
  return gen(opts);
}
