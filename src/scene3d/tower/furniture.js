// @ts-check
// Parametric furniture generators. Every piece returns { group, sockets, colliders }.
// Sockets are named Object3D anchors (seat0, lie_center, lean_bar, surface…) that
// ActorQueue / paired poses target. Colliders are local-space AABBs for FP collision.
import * as THREE from 'three';
import { PALETTE } from '../materials/palette.js';
import { fabricTex, woodTex, marbleTex, metalTex, concreteTex } from '../materials/texGen.js';

const concreteTexLazy = (tint) => concreteTex(tint);

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

  rug(opts = {}) {
    const group = new THREE.Group();
    const geo = new THREE.CircleGeometry(opts.radius ?? 1.7, 36);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: fabricTex('#231a2e', 6), roughness: 1,
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.012;
    m.receiveShadow = true;
    group.add(m);
    return { group, sockets: { stand: socket(group, 'stand', 0, 0, 0) }, colliders: [] };
  },

  armchair() {
    const group = new THREE.Group();
    const fab = mat.leather();
    box(group, fab, 0.85, 0.16, 0.8, 0, 0.3, 0);
    box(group, fab, 0.85, 0.5, 0.2, 0, 0.62, -0.32);
    box(group, fab, 0.18, 0.28, 0.8, -0.34, 0.5, 0);
    box(group, fab, 0.18, 0.28, 0.8, 0.34, 0.5, 0);
    box(group, mat.metalDark(), 0.7, 0.1, 0.6, 0, 0.1, 0);
    return {
      group,
      sockets: { seat0: socket(group, 'seat0', 0, 0.46, 0.06, Math.PI) },
      colliders: [{ min: [-0.45, 0, -0.45], max: [0.45, 0.9, 0.45] }],
    };
  },

  fireplace() {
    const group = new THREE.Group();
    box(group, mat.marble(), 2.2, 1.5, 0.4, 0, 0.75, 0);                      // chimney breast
    box(group, mat.metalDark(), 1.2, 0.75, 0.36, 0, 0.42, 0.04);              // firebox frame
    const opening = box(group, mat.glow(PALETTE.fireGlow, 2.6), 0.95, 0.5, 0.1, 0, 0.38, 0.14);
    opening.name = 'fire_glow';
    // logs
    for (const [x, r] of [[-0.2, 0.3], [0.15, -0.4]]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.6, 8), mat.wood());
      log.position.set(x, 0.2, 0.16); log.rotation.z = Math.PI / 2; log.rotation.y = r;
      group.add(log);
    }
    box(group, mat.marble(), 2.4, 0.08, 0.7, 0, 0.04, 0.2);                   // hearth slab
    return {
      group,
      sockets: { hearth: socket(group, 'hearth', 0, 0, 0.9, Math.PI) },
      colliders: [{ min: [-1.2, 0, -0.25], max: [1.2, 1.6, 0.35] }],
    };
  },

  bed() {
    const group = new THREE.Group();
    box(group, mat.metalDark(), 2.0, 0.25, 2.3, 0, 0.18, 0);                  // platform
    const mattress = box(group, mat.fabric(), 1.9, 0.22, 2.15, 0, 0.42, 0);
    mattress.material = new THREE.MeshStandardMaterial({ map: fabricTex('#3a3348', 3), roughness: 0.95 });
    box(group, mattress.material, 1.7, 0.1, 0.5, 0, 0.56, -0.75);             // pillows
    box(group, mat.wood(), 2.0, 0.9, 0.12, 0, 0.65, -1.16);                   // headboard
    const strip = box(group, mat.glow(PALETTE.neonViolet, 1.6), 1.9, 0.03, 0.03, 0, 1.05, -1.14);
    strip.castShadow = false;
    return {
      group,
      sockets: {
        lie_center: socket(group, 'lie_center', 0, 0.55, 0, Math.PI),
        lie_left: socket(group, 'lie_left', -0.5, 0.55, 0.1, Math.PI),
        lie_right: socket(group, 'lie_right', 0.5, 0.55, 0.1, Math.PI),
        seat0: socket(group, 'seat0', 0.7, 0.5, 0.85, Math.PI),
      },
      colliders: [{ min: [-1.0, 0, -1.2], max: [1.0, 0.6, 1.15] }],
    };
  },

  vanity_table() {
    const group = new THREE.Group();
    box(group, mat.wood(), 1.5, 0.05, 0.5, 0, 0.74, 0);
    box(group, mat.wood(), 1.4, 0.7, 0.42, 0, 0.37, 0);
    // mirror with neon rim
    const mirror = box(group, new THREE.MeshStandardMaterial({
      color: 0x8a9bb0, roughness: 0.05, metalness: 0.9,
    }), 0.9, 1.0, 0.04, 0, 1.5, -0.2);
    mirror.name = 'vanity_mirror';
    const rim = box(group, mat.glow(PALETTE.neonMagenta, 1.8), 1.0, 1.1, 0.02, 0, 1.5, -0.23);
    rim.castShadow = false;
    const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.45, 12), mat.leather());
    stool.position.set(0, 0.23, 0.75); stool.castShadow = true;
    group.add(stool);
    return {
      group,
      sockets: { seat0: socket(group, 'seat0', 0, 0.48, 0.75, 0) },
      colliders: [{ min: [-0.75, 0, -0.3], max: [0.75, 2.1, 0.3] }],
    };
  },

  wardrobe_rack() {
    const group = new THREE.Group();
    box(group, mat.metalDark(), 2.2, 0.05, 0.05, 0, 1.8, 0);
    for (const x of [-1.05, 1.05]) box(group, mat.metalDark(), 0.06, 1.8, 0.06, x, 0.9, 0);
    // hanging garments (colored slabs)
    const cols = [0x3d1028, 0x1c1424, 0x5c3a7a, 0xc9a6e8, 0x14202c, 0x8f2360];
    for (let i = 0; i < 6; i++) {
      const g = box(group, new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.85 }),
        0.28, 0.9 + (i % 3) * 0.12, 0.06, -0.85 + i * 0.34, 1.3, 0);
      g.rotation.y = (i % 2 ? 1 : -1) * 0.06;
    }
    return { group, sockets: {}, colliders: [{ min: [-1.15, 0, -0.2], max: [1.15, 1.9, 0.2] }] };
  },

  shower_pod() {
    const group = new THREE.Group();
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.75, 2.3, 18, 1, true),
      new THREE.MeshStandardMaterial({
        color: PALETTE.glass, transparent: true, opacity: 0.22,
        roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide,
      }));
    glass.position.y = 1.15;
    group.add(glass);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.85, 0.12, 18), mat.marble());
    base.position.y = 0.06; base.receiveShadow = true;
    group.add(base);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.06, 12), mat.metal());
    head.position.y = 2.3;
    group.add(head);
    const ring = box(group, mat.glow(PALETTE.neonCyan, 1.4), 0.06, 0.03, 0.06, 0, 2.36, 0);
    ring.castShadow = false;
    return {
      group,
      sockets: { stand: socket(group, 'stand', 0, 0, 0, Math.PI) },
      colliders: [{ min: [-0.8, 0, -0.8], max: [0.8, 2.4, 0.8] }],
    };
  },

  sink_counter() {
    const group = new THREE.Group();
    box(group, mat.marble(), 1.6, 0.06, 0.55, 0, 0.86, 0);
    box(group, mat.wood(), 1.5, 0.8, 0.48, 0, 0.43, 0);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.12, 14), mat.metal());
    basin.position.set(0, 0.9, 0);
    group.add(basin);
    return { group, sockets: { use: socket(group, 'use', 0, 0, 0.55, Math.PI) }, colliders: [{ min: [-0.8, 0, -0.28], max: [0.8, 0.95, 0.28] }] };
  },

  planter_bed() {
    const group = new THREE.Group();
    box(group, mat.wood(), 1.9, 0.4, 0.9, 0, 0.2, 0);
    const soil = box(group, new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 1 }), 1.75, 0.06, 0.75, 0, 0.41, 0);
    soil.castShadow = false;
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e6b3f, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 10; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.3 + (i % 4) * 0.08, 5), leafMat);
      leaf.position.set(-0.75 + (i % 5) * 0.36, 0.55, -0.2 + Math.floor(i / 5) * 0.4);
      leaf.rotation.x = (i % 2 ? 1 : -1) * 0.15;
      group.add(leaf);
    }
    return { group, sockets: { tend: socket(group, 'tend', 0, 0, 0.75, Math.PI) }, colliders: [{ min: [-0.95, 0, -0.45], max: [0.95, 0.6, 0.45] }] };
  },

  helipad() {
    const group = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.08, 28),
      new THREE.MeshStandardMaterial({ map: concreteTexLazy('#1a1e28'), roughness: 0.9 }));
    pad.position.y = 0.04; pad.receiveShadow = true;
    group.add(pad);
    // H marking + rim lights
    const markMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffb347, emissiveIntensity: 0.9 });
    box(group, markMat, 0.25, 0.02, 1.6, -0.45, 0.09, 0);
    box(group, markMat, 0.25, 0.02, 1.6, 0.45, 0.09, 0);
    box(group, markMat, 0.7, 0.02, 0.25, 0, 0.09, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const lamp = box(group, mat.glow(PALETTE.neonAmber, 2), 0.12, 0.06, 0.12, Math.sin(a) * 3, 0.1, Math.cos(a) * 3);
      lamp.castShadow = false;
    }
    return { group, sockets: { center: socket(group, 'center', 0, 0.1, 0) }, colliders: [] };
  },

  security_desk() {
    const group = new THREE.Group();
    box(group, mat.metal(), 2.6, 0.05, 0.8, 0, 0.76, 0);
    box(group, mat.metalDark(), 2.5, 0.72, 0.7, 0, 0.38, 0);
    for (const x of [-0.7, 0, 0.7]) {
      const scr = box(group, mat.glow(PALETTE.neonCyan, 0.7), 0.55, 0.35, 0.03, x, 1.1, -0.2);
      scr.rotation.x = -0.15; scr.castShadow = false;
    }
    const chair = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.22, 0.5, 12), mat.leather());
    chair.position.set(0, 0.25, 0.8); chair.castShadow = true;
    group.add(chair);
    return {
      group,
      sockets: { seat0: socket(group, 'seat0', 0, 0.5, 0.8, 0), use: socket(group, 'use', 0, 0, 0.9, 0) },
      colliders: [{ min: [-1.3, 0, -0.42], max: [1.3, 0.8, 0.42] }],
    };
  },

  monitor_wall() {
    const group = new THREE.Group();
    box(group, mat.metalDark(), 4.4, 2.4, 0.15, 0, 1.4, 0);
    // grid of cam screens — canvases animated by monitors.js (marked by name)
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
      const scr = box(group, mat.glow(0x39e6ff, 0.35), 0.95, 0.62, 0.04,
        -1.575 + c * 1.05, 0.85 + r * 0.95, 0.09);
      scr.name = `cam_${r * 4 + c}`;
      scr.castShadow = false;
    }
    return { group, sockets: {}, colliders: [{ min: [-2.2, 0, -0.15], max: [2.2, 2.7, 0.15] }] };
  },

  server_rack() {
    const group = new THREE.Group();
    box(group, mat.metalDark(), 0.7, 2.1, 0.8, 0, 1.05, 0);
    for (let i = 0; i < 8; i++) {
      const led = box(group, mat.glow(i % 3 ? PALETTE.neonGreen : PALETTE.neonAmber, 1.2),
        0.5, 0.03, 0.02, 0, 0.25 + i * 0.24, 0.41);
      led.castShadow = false;
    }
    return { group, sockets: {}, colliders: [{ min: [-0.35, 0, -0.4], max: [0.35, 2.1, 0.4] }] };
  },

  weapon_rack() {
    const group = new THREE.Group();
    box(group, mat.metalDark(), 2.6, 2.0, 0.2, 0, 1.0, 0);
    // rifles: barrel + body slabs
    for (let i = 0; i < 4; i++) {
      const x = -0.95 + i * 0.63;
      box(group, mat.metal(), 0.08, 1.1, 0.08, x, 1.1, 0.12);
      box(group, mat.metalDark(), 0.14, 0.4, 0.12, x, 0.85, 0.14);
    }
    const strip = box(group, mat.glow(PALETTE.neonRed, 1.4), 2.5, 0.03, 0.02, 0, 1.95, 0.11);
    strip.castShadow = false;
    return {
      group,
      sockets: { use: socket(group, 'use', 0, 0, 0.6, 0) },
      colliders: [{ min: [-1.3, 0, -0.15], max: [1.3, 2.1, 0.2] }],
    };
  },

  locker_bank() {
    const group = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      box(group, mat.metal(), 0.62, 1.9, 0.55, -0.99 + i * 0.66, 0.95, 0);
      box(group, mat.metalDark(), 0.5, 0.04, 0.02, -0.99 + i * 0.66, 1.4, 0.29);
    }
    return { group, sockets: { use: socket(group, 'use', 0, 0, 0.5, 0) }, colliders: [{ min: [-1.35, 0, -0.3], max: [1.35, 1.9, 0.3] }] };
  },

  crate(opts = {}) {
    const group = new THREE.Group();
    box(group, mat.metalDark(), 1.0, 0.7, 0.7, 0, 0.35, 0);
    const lid = box(group, mat.metal(), 1.04, 0.08, 0.74, 0, 0.72, 0);
    const glow = box(group, mat.glow(opts.color ?? PALETTE.neonAmber, 1.2), 0.3, 0.03, 0.02, 0, 0.5, 0.36);
    glow.castShadow = false;
    return {
      group,
      sockets: { use: socket(group, 'use', 0, 0, 0.6, 0) },
      colliders: [{ min: [-0.52, 0, -0.37], max: [0.52, 0.78, 0.37] }],
    };
  },

  gurney() {
    const group = new THREE.Group();
    box(group, new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.6 }), 0.75, 0.1, 2.0, 0, 0.75, 0);
    box(group, mat.fabric(), 0.65, 0.06, 0.4, 0, 0.82, -0.7);
    for (const [x, z] of [[-0.3, -0.85], [0.3, -0.85], [-0.3, 0.85], [0.3, 0.85]]) {
      box(group, mat.metal(), 0.05, 0.7, 0.05, x, 0.35, z);
    }
    return {
      group,
      sockets: { lie_center: socket(group, 'lie_center', 0, 0.85, 0, Math.PI) },
      colliders: [{ min: [-0.4, 0, -1.0], max: [0.4, 0.85, 1.0] }],
    };
  },

  med_cabinet() {
    const group = new THREE.Group();
    box(group, new THREE.MeshStandardMaterial({ color: 0xcfd8e0, roughness: 0.5 }), 1.8, 2.0, 0.5, 0, 1.0, 0);
    const cross = mat.glow(PALETTE.neonRed, 1.5);
    box(group, cross, 0.4, 0.12, 0.02, 0, 1.5, 0.26).castShadow = false;
    box(group, cross, 0.12, 0.4, 0.02, 0, 1.5, 0.26).castShadow = false;
    return { group, sockets: { use: socket(group, 'use', 0, 0, 0.55, 0) }, colliders: [{ min: [-0.9, 0, -0.25], max: [0.9, 2.0, 0.28] }] };
  },

  privacy_screen() {
    const group = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const p = box(group, new THREE.MeshStandardMaterial({
        color: 0xaab8c2, roughness: 0.9, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      }), 0.7, 1.7, 0.03, -0.7 + i * 0.7, 0.95, (i % 2) * 0.12);
      p.rotation.y = (i % 2 ? -1 : 1) * 0.2;
    }
    return { group, sockets: {}, colliders: [{ min: [-1.1, 0, -0.15], max: [1.1, 1.8, 0.2] }] };
  },

  reception_desk() {
    const group = new THREE.Group();
    box(group, mat.marble(), 3.4, 0.07, 0.9, 0, 1.05, 0);
    box(group, mat.wood(), 3.3, 1.0, 0.8, 0, 0.52, 0);
    const sign = box(group, mat.glow(PALETTE.neonCyan, 2.2), 2.6, 0.25, 0.04, 0, 1.7, -0.5);
    sign.castShadow = false;
    return {
      group,
      sockets: { serve: socket(group, 'serve', 0, 0, -0.9, 0), front: socket(group, 'front', 0, 0, 1.0, Math.PI) },
      colliders: [{ min: [-1.7, 0, -0.45], max: [1.7, 1.1, 0.45] }],
    };
  },

  barricade() {
    const group = new THREE.Group();
    // heaped furniture + plates welded over the doors
    box(group, mat.metalDark(), 3.6, 1.3, 0.3, 0, 0.65, 0);
    box(group, mat.wood(), 1.2, 0.8, 0.5, -1.0, 1.5, 0.05, 0.3);
    box(group, mat.metal(), 1.4, 0.9, 0.2, 0.9, 1.6, 0, -0.2);
    const warn = box(group, mat.glow(PALETTE.neonRed, 1.6), 1.8, 0.12, 0.03, 0, 1.1, 0.17);
    warn.castShadow = false;
    return { group, sockets: {}, colliders: [{ min: [-1.9, 0, -0.35], max: [1.9, 2.1, 0.35] }] };
  },

  pillar() {
    const group = new THREE.Group();
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 3.4, 12),
      new THREE.MeshStandardMaterial({ map: concreteTexLazy('#20242e'), roughness: 0.9 }));
    p.position.y = 1.7; p.castShadow = p.receiveShadow = true;
    group.add(p);
    return { group, sockets: {}, colliders: [{ min: [-0.45, 0, -0.45], max: [0.45, 3.4, 0.45] }] };
  },

  car(opts = {}) {
    const group = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: opts.color ?? 0x20242e, roughness: 0.35, metalness: 0.5 });
    box(group, body, 1.9, 0.5, 4.4, 0, 0.55, 0);
    const cabin = box(group, new THREE.MeshStandardMaterial({
      color: PALETTE.glass, transparent: true, opacity: 0.4, roughness: 0.1,
    }), 1.7, 0.45, 2.2, 0, 1.0, -0.2);
    for (const [x, z] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14), mat.metalDark());
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.34, z);
      group.add(wheel);
    }
    return { group, sockets: {}, colliders: [{ min: [-1.0, 0, -2.25], max: [1.0, 1.3, 2.25] }] };
  },

  terminal() {
    const group = new THREE.Group();
    box(group, mat.metalDark(), 0.7, 1.1, 0.5, 0, 0.55, 0);
    const scr = box(group, mat.glow(PALETTE.neonGreen, 1.0), 0.55, 0.4, 0.03, 0, 1.25, -0.05);
    scr.rotation.x = -0.3; scr.castShadow = false;
    return {
      group,
      sockets: { use: socket(group, 'use', 0, 0, 0.5, 0) },
      colliders: [{ min: [-0.35, 0, -0.28], max: [0.35, 1.45, 0.28] }],
    };
  },

  vox_monolith() {
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.3, 3.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x0c1018, roughness: 0.3, metalness: 0.6 }));
    core.position.y = 1.7; core.castShadow = true;
    group.add(core);
    // pulsing rings (animated by props via name)
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.12 + i * 0.02, 0.03, 8, 32),
        new THREE.MeshStandardMaterial({ color: 0x111111, emissive: PALETTE.neonCyan, emissiveIntensity: 1.6 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.7 + i * 0.75;
      ring.name = `vox_ring_${i}`;
      ring.castShadow = false;
      group.add(ring);
    }
    // cable trunks
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.5, 6), mat.metalDark());
      cable.position.set(Math.sin(a) * 2.6, 0.1, Math.cos(a) * 2.6);
      cable.rotation.x = Math.PI / 2 - 0.9;
      cable.lookAt(0, 1.2, 0);
      group.add(cable);
    }
    return {
      group,
      sockets: { commune: socket(group, 'commune', 0, 0, 2.2, 0) },
      colliders: [{ min: [-1.4, 0, -1.4], max: [1.4, 3.5, 1.4] }],
    };
  },

  fish_tank() {
    const group = new THREE.Group();
    box(group, mat.metalDark(), 1.7, 0.55, 0.55, 0, 0.27, 0);
    const tank = box(group, new THREE.MeshStandardMaterial({
      color: 0x0e3344, transparent: true, opacity: 0.35, roughness: 0.05,
    }), 1.6, 0.8, 0.48, 0, 0.95, 0);
    const water = box(group, mat.glow(0x1d7d8f, 0.5), 1.55, 0.72, 0.42, 0, 0.94, 0);
    water.castShadow = false;
    // fish (animated by props via name)
    for (let i = 0; i < 3; i++) {
      const fish = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 6),
        new THREE.MeshBasicMaterial({ color: [0xffb347, 0xff6fc0, 0x6eefff][i] }));
      fish.rotation.z = -Math.PI / 2;
      fish.position.set(-0.4 + i * 0.4, 0.9 + (i % 2) * 0.15, 0);
      fish.name = `fish_${i}`;
      group.add(fish);
    }
    return {
      group,
      sockets: { view: socket(group, 'view', 0, 0, 0.7, 0) },
      colliders: [{ min: [-0.85, 0, -0.3], max: [0.85, 1.4, 0.3] }],
    };
  },

  synth_keys() {
    const group = new THREE.Group();
    box(group, mat.metalDark(), 1.3, 0.08, 0.42, 0, 0.85, 0);
    for (let i = 0; i < 14; i++) {
      const white = box(group, new THREE.MeshStandardMaterial({ color: 0xe8f0f4, roughness: 0.4 }),
        0.075, 0.03, 0.3, -0.585 + i * 0.09, 0.9, 0.02);
      white.name = `key_${i}`;
    }
    for (let i = 0; i < 13; i++) {
      if ([2, 6, 9, 13].includes(i % 7)) continue;
      box(group, mat.metalDark(), 0.05, 0.035, 0.16, -0.54 + i * 0.09, 0.915, -0.05);
    }
    for (const x of [-0.55, 0.55]) box(group, mat.metal(), 0.08, 0.85, 0.35, x, 0.42, 0);
    const strip = box(group, mat.glow(PALETTE.neonViolet, 1.8), 1.25, 0.02, 0.03, 0, 0.92, -0.2);
    strip.castShadow = false;
    return {
      group,
      sockets: { use: socket(group, 'use', 0, 0, 0.55, Math.PI) },
      colliders: [{ min: [-0.68, 0, -0.25], max: [0.68, 0.95, 0.25] }],
    };
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
