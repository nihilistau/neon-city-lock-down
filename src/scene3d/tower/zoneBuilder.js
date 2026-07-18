// @ts-check
// Multi-floor tower builder. Each floor lives in its own Group at a large world-X
// offset; only the active floor renders. Exposes per-floor walk rects (FP
// collision), world-space furniture colliders, interactive props, and sockets.
import * as THREE from 'three';
import { ZONES, FLOORS, PENTHOUSE } from '../../../data/zones.js';
import { makeFurniture } from './furniture.js';
import { tileTex, concreteTex, metalTex } from '../materials/texGen.js';
import { PALETTE } from '../materials/palette.js';

function cityWindowsTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#04050a';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      if (Math.random() < 0.42) {
        ctx.fillStyle = Math.random() < 0.16 ? '#ff6fc0' : (Math.random() < 0.5 ? '#6eefff' : '#ffd9a0');
        ctx.globalAlpha = 0.35 + Math.random() * 0.65;
        ctx.fillRect(x, y, 4, 3);
      }
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const glassMat = () => new THREE.MeshStandardMaterial({
  color: PALETTE.glass, transparent: true, opacity: 0.18,
  roughness: 0.08, metalness: 0.2, side: THREE.DoubleSide,
});
const mullionMat = () => new THREE.MeshStandardMaterial({ map: metalTex('#1a1f2c'), roughness: 0.5, metalness: 0.7 });
const wallMatOf = (tint) => new THREE.MeshStandardMaterial({ map: concreteTex(tint), roughness: 0.85 });

export class World3D {
  /** @param {import('../stage.js').Stage} stage @param {import('../../core/rng.js').RngStream} rng */
  constructor(stage, rng) {
    this.stage = stage;
    this.rng = rng;
    /** @type {Record<string, THREE.Group>} */
    this.floorGroups = {};
    /** @type {Record<string, {x:[number,number], z:[number,number]}[]>} WORLD-space walk rects */
    this.walkRects = {};
    /** @type {Record<string, THREE.Box3[]>} WORLD-space furniture colliders */
    this.collidersByFloor = {};
    /** @type {Record<string, Record<string, THREE.Object3D>>} furnitureId → sockets */
    this.sockets = {};
    /** @type {{mesh: THREE.Object3D, id:string, prompt:string, floor:string}[]} */
    this.props = [];
    /** @type {THREE.Object3D[]} animated bits (fish, rings, fire) found by name */
    this.animated = [];
    this.fireSprites = [];
    this.activeFloor = 'penthouse';

    for (const floor of Object.values(FLOORS)) {
      const group = new THREE.Group();
      group.name = `floor_${floor.id}`;
      group.position.x = floor.offsetX;
      this.floorGroups[floor.id] = group;
      this.walkRects[floor.id] = [];
      this.collidersByFloor[floor.id] = [];
      this[`_build_${floor.shell}`](group, floor);
      this._buildElevatorDoor(group, floor);
      stage.scene.add(group);
    }
    this._buildFurniture();
    this._collectAnimated();
    this.setActiveFloor('penthouse');
  }

  // ── shared helpers ──────────────────────────────────────────────
  _slab(group, rect, tex, y = -0.1) {
    const w = rect.x[1] - rect.x[0], d = rect.z[1] - rect.z[0];
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), tex);
    m.position.set((rect.x[0] + rect.x[1]) / 2, y, (rect.z[0] + rect.z[1]) / 2);
    m.receiveShadow = true;
    group.add(m);
    return m;
  }

  _ceiling(group, rect, y, color = 0x0c0f18) {
    const w = rect.x[1] - rect.x[0], d = rect.z[1] - rect.z[0];
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    m.position.set((rect.x[0] + rect.x[1]) / 2, y + 0.075, (rect.z[0] + rect.z[1]) / 2);
    group.add(m);
  }

  /** wall along X (fixed z) or Z (fixed x) with optional gaps (ranges on the run axis) */
  _wall(group, mat3, { alongX, at, from, to, gaps = [], h, thickness = 0.2 }) {
    const segs = [];
    let cur = from;
    const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
    for (const [g0, g1] of sorted) { if (g0 > cur) segs.push([cur, g0]); cur = Math.max(cur, g1); }
    if (cur < to) segs.push([cur, to]);
    for (const [a, b] of segs) {
      const len = b - a;
      const m = new THREE.Mesh(
        alongX ? new THREE.BoxGeometry(len, h, thickness) : new THREE.BoxGeometry(thickness, h, len),
        mat3);
      m.position.set(alongX ? (a + b) / 2 : at, h / 2, alongX ? at : (a + b) / 2);
      m.receiveShadow = m.castShadow = true;
      group.add(m);
    }
  }

  _walk(floorId, offsetX, rect) {
    this.walkRects[floorId].push({
      x: [rect.x[0] + offsetX, rect.x[1] + offsetX],
      z: [rect.z[0], rect.z[1]],
    });
  }

  _neonTrim(group, x, y, z, w, color = PALETTE.neonMagenta) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 2.2 }));
    m.position.set(x, y, z);
    group.add(m);
  }

  _buildElevatorDoor(group, floor) {
    const [ex, ez] = floor.elevator;
    const shaft = new THREE.Group();
    shaft.position.set(ex, 0, ez);
    const frame = mullionMat();
    // shaft box behind the doors
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 0.9), wallMatOf('#141824'));
    backWall.position.set(0, 1.3, -0.55);
    shaft.add(backWall);
    // door panels
    const doorMat = new THREE.MeshStandardMaterial({ map: metalTex('#232a3a'), roughness: 0.35, metalness: 0.8 });
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.3, 0.08), doorMat);
      panel.position.set(side * 0.44, 1.15, -0.06);
      shaft.add(panel);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.3, 0.2), frame);
    lintel.position.set(0, 2.45, 0);
    shaft.add(lintel);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: PALETTE.neonAmber, emissiveIntensity: 2 }));
    lamp.position.set(0, 2.62, 0.02);
    shaft.add(lamp);
    group.add(shaft);
    this.collidersByFloor[floor.id].push(new THREE.Box3(
      new THREE.Vector3(ex - 1.1 + floor.offsetX, 0, ez - 1.0),
      new THREE.Vector3(ex + 1.1 + floor.offsetX, 2.6, ez + 0.05)));
    this.props.push({
      mesh: shaft, id: `elevator_${floor.id}`, floor: floor.id,
      prompt: 'Call the elevator',
    });
  }

  // ── floor shells ────────────────────────────────────────────────
  _build_penthouse(group, floor) {
    const P = PENTHOUSE;
    const F = P.floor, ceil = P.ceilingY;
    const floorTex = new THREE.MeshStandardMaterial({ map: tileTex(), roughness: 0.35, metalness: 0.15 });
    this._slab(group, F, floorTex);
    this._slab(group, P.balcony, new THREE.MeshStandardMaterial({ map: concreteTex('#141824'), roughness: 0.8 }));
    this._ceiling(group, F, ceil);

    const wall = wallMatOf('#181c2a');
    // solid: -z wall full width, -x wall (west end), interior wing wall at x=-8.6
    this._wall(group, wall, { alongX: true, at: F.z[0] - 0.1, from: F.x[0], to: F.x[1], h: ceil });
    this._wall(group, wall, { alongX: false, at: F.x[0] - 0.1, from: F.z[0], to: F.z[1], h: ceil });
    this._wall(group, wall, { alongX: false, at: -8.6, from: F.z[0], to: F.z[1], h: ceil, gaps: [P.wingDoor.z] });
    // wing internal walls: z=0 (bed|vanity) and z=-3.2 (vanity|shower)
    this._wall(group, wall, { alongX: true, at: 0, from: F.x[0], to: -8.6, h: ceil, gaps: [[-12.3, -11.1]] });
    this._wall(group, wall, { alongX: true, at: -3.2, from: F.x[0], to: -8.6, h: ceil, gaps: [[-12.0, -10.9]] });
    // wing window wall (+z side of bed alcove is glass)
    const glass = glassMat(), frame = mullionMat();
    const paneEdgesWing = [F.x[0], -11.3, -8.6];
    for (let i = 0; i < paneEdgesWing.length - 1; i++) {
      const [a, b] = [paneEdgesWing[i], paneEdgesWing[i + 1]];
      const pane = new THREE.Mesh(new THREE.BoxGeometry(b - a - 0.08, ceil, 0.05), glass);
      pane.position.set((a + b) / 2, ceil / 2, F.z[1]);
      group.add(pane);
    }
    for (const mx of paneEdgesWing) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, ceil, 0.12), frame);
      post.position.set(mx, ceil / 2, F.z[1]);
      group.add(post);
    }
    // main glass curtain +z with balcony door gap
    const edges = [-8.6, -4, 0, P.doorGap.x[0], P.doorGap.x[1], F.x[1]];
    for (let i = 0; i < edges.length - 1; i++) {
      const a = edges[i], b = edges[i + 1];
      if (a === P.doorGap.x[0] && b === P.doorGap.x[1]) continue;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(b - a - 0.08, ceil, 0.05), glass);
      pane.position.set((a + b) / 2, ceil / 2, F.z[1]);
      group.add(pane);
    }
    for (const mx of edges) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, ceil, 0.12), frame);
      post.position.set(mx, ceil / 2, F.z[1]);
      group.add(post);
    }
    // +x glass wall
    const paneEdgesZ = [F.z[0], -2, 2, F.z[1]];
    for (let i = 0; i < paneEdgesZ.length - 1; i++) {
      const a = paneEdgesZ[i], b = paneEdgesZ[i + 1];
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.05, ceil, b - a - 0.08), glass);
      pane.position.set(F.x[1], ceil / 2, (a + b) / 2);
      group.add(pane);
    }
    for (const mz of paneEdgesZ) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, ceil, 0.09), frame);
      post.position.set(F.x[1], ceil / 2, mz);
      group.add(post);
    }
    // ceiling light strips + neon trim
    for (const lx of [-11, -4, 4]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 8),
        new THREE.MeshStandardMaterial({ color: 0x111111, emissive: PALETTE.neonCyan, emissiveIntensity: 1.2 }));
      strip.position.set(lx, ceil - 0.01, 0);
      group.add(strip);
    }
    this._neonTrim(group, (F.x[0] + F.x[1]) / 2, 2.4, F.z[0] + 0.03, F.x[1] - F.x[0]);

    // balcony rail
    const B = P.balcony;
    const bw = B.x[1] - B.x[0], bd = B.z[1] - B.z[0];
    const rail = (x, z, wRail, dRail) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(wRail, 0.05, dRail), frame);
      r.position.set(x, 1.06, z);
      group.add(r);
      const g = new THREE.Mesh(new THREE.BoxGeometry(Math.max(wRail - 0.05, 0.04), 0.95, Math.max(dRail - 0.05, 0.04)), glass);
      g.position.set(x, 0.55, z);
      group.add(g);
    };
    rail((B.x[0] + B.x[1]) / 2, B.z[1], bw, 0.06);
    rail(B.x[0], (B.z[0] + B.z[1]) / 2 + 0.03, 0.06, bd);
    rail(B.x[1], (B.z[0] + B.z[1]) / 2 + 0.03, 0.06, bd);

    this._buildExterior(group);
    this._buildRain(group, { x: [-16, 30], z: [5, 40], y: [0, 18] });

    // walk rects
    const o = floor.offsetX;
    this._walk('penthouse', o, { x: [-8.35, 7.75], z: [-5.75, 5.75] });
    this._walk('penthouse', o, { x: [1.2, 6.8], z: [6.05, 8.75] });
    this._walk('penthouse', o, { x: [P.doorGap.x[0], P.doorGap.x[1]], z: [5.5, 6.3] });
    this._walk('penthouse', o, { x: [-8.85, -8.35], z: [P.wingDoor.z[0], P.wingDoor.z[1]] });
    this._walk('penthouse', o, { x: [-13.75, -8.85], z: [0.25, 5.75] });
    this._walk('penthouse', o, { x: [-13.75, -8.85], z: [-2.95, -0.25] });
    this._walk('penthouse', o, { x: [-12.3, -11.1], z: [-0.35, 0.35] });
    this._walk('penthouse', o, { x: [-13.75, -8.85], z: [-5.75, -3.45] });
    this._walk('penthouse', o, { x: [-12.0, -10.9], z: [-3.5, -2.9] });
  }

  _build_rooftop(group, floor) {
    const R = { x: [-10, 10], z: [-8, 8] };
    this._slab(group, R, new THREE.MeshStandardMaterial({ map: concreteTex('#161a26'), roughness: 0.95 }));
    // parapet
    const par = wallMatOf('#1a1f2c');
    this._wall(group, par, { alongX: true, at: R.z[0], from: R.x[0], to: R.x[1], h: 1.0, thickness: 0.3 });
    this._wall(group, par, { alongX: true, at: R.z[1], from: R.x[0], to: R.x[1], h: 1.0, thickness: 0.3 });
    this._wall(group, par, { alongX: false, at: R.x[0], from: R.z[0], to: R.z[1], h: 1.0, thickness: 0.3 });
    this._wall(group, par, { alongX: false, at: R.x[1], from: R.z[0], to: R.z[1], h: 1.0, thickness: 0.3 });
    // elevator head shed
    const shed = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3, 2.6), wallMatOf('#141824'));
    shed.position.set(-8, 1.5, -6.8);
    group.add(shed);
    this._buildExterior(group, true);
    this._buildRain(group, { x: [-12, 12], z: [-10, 10], y: [0, 14] });
    this._walk('rooftop', floor.offsetX, { x: [-9.6, 9.6], z: [-7.6, 7.6] });
  }

  _genericInterior(group, floor, rect, { tint = '#171b28', windows = false, ceilH = 3.0, lightColor = PALETTE.neonCyan } = {}) {
    this._slab(group, rect, new THREE.MeshStandardMaterial({ map: concreteTex('#12151f'), roughness: 0.8 }));
    this._ceiling(group, rect, ceilH, 0x0a0d14);
    const wall = wallMatOf(tint);
    this._wall(group, wall, { alongX: true, at: rect.z[0], from: rect.x[0], to: rect.x[1], h: ceilH });
    this._wall(group, wall, { alongX: true, at: rect.z[1], from: rect.x[0], to: rect.x[1], h: ceilH });
    this._wall(group, wall, { alongX: false, at: rect.x[0], from: rect.z[0], to: rect.z[1], h: ceilH });
    this._wall(group, wall, { alongX: false, at: rect.x[1], from: rect.z[0], to: rect.z[1], h: ceilH });
    if (windows) {
      const glass = glassMat();
      for (let i = 0; i < 3; i++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.08), glass);
        win.position.set(rect.x[0] + 2.5 + i * 3, 1.7, rect.z[1] + 0.02);
        group.add(win);
      }
    }
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry((rect.x[1] - rect.x[0]) * 0.6, 0.02, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: lightColor, emissiveIntensity: 1.1 }));
    strip.position.set((rect.x[0] + rect.x[1]) / 2, ceilH - 0.02, (rect.z[0] + rect.z[1]) / 2);
    group.add(strip);
    this._walk(floor.id, floor.offsetX, {
      x: [rect.x[0] + 0.3, rect.x[1] - 0.3], z: [rect.z[0] + 0.3, rect.z[1] - 0.3],
    });
  }

  _build_fl40(group, floor) {
    this._genericInterior(group, floor, { x: [-10, 10], z: [-6, 6] }, { lightColor: PALETTE.neonRed });
    // dividing wall security|armoury with door gap
    this._wall(group, wallMatOf('#171b28'), { alongX: false, at: 0, from: -6, to: 6, h: 3.0, gaps: [[-0.9, 0.9]] });
  }

  _build_fl27(group, floor) {
    this._genericInterior(group, floor, { x: [-8, 8], z: [-8, 8] }, { tint: '#101622', lightColor: PALETTE.neonCyan });
  }

  _build_fl12(group, floor) {
    this._genericInterior(group, floor, { x: [-8, 8], z: [-6, 6] }, { tint: '#1b2430', lightColor: 0xbfe8ff });
  }

  _build_ground(group, floor) {
    const R = { x: [-10, 10], z: [-8, 10] };
    this._genericInterior(group, floor, R, { tint: '#1a1e2c', ceilH: 4.2, lightColor: PALETTE.neonCyan });
    // glass front (behind the barricade) replacing the +z wall visually
    const glass = glassMat();
    const front = new THREE.Mesh(new THREE.BoxGeometry(16, 4.0, 0.06), glass);
    front.position.set(0, 2.0, R.z[1] - 0.4);
    group.add(front);
    this._neonTrim(group, 0, 3.6, R.z[0] + 0.15, 14, PALETTE.neonCyan);
  }

  _build_basement(group, floor) {
    const R = { x: [-14, 14], z: [-10, 10] };
    this._genericInterior(group, floor, R, { tint: '#14161c', ceilH: 2.6, lightColor: 0x8899aa });
    // oil stains
    for (let i = 0; i < 5; i++) {
      const stain = new THREE.Mesh(new THREE.CircleGeometry(0.5 + this.rng.next() * 0.8, 12),
        new THREE.MeshStandardMaterial({ color: 0x07080c, roughness: 0.3 }));
      stain.rotation.x = -Math.PI / 2;
      stain.position.set(this.rng.range(-12, 12), 0.012, this.rng.range(-8, 8));
      group.add(stain);
    }
  }

  _buildExterior(group, fromRoof = false) {
    const tex = cityWindowsTexture();
    const matC = new THREE.MeshBasicMaterial({ map: tex, fog: true });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, matC, 80);
    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    let i = 0;
    while (i < 80) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(30, 90);
      const x = Math.cos(a) * r + 4;
      const z = fromRoof ? Math.sin(a) * r : Math.abs(Math.sin(a)) * r + 8;
      const hgt = this.rng.range(10, 55);
      quat.setFromEuler(new THREE.Euler(0, this.rng.range(0, Math.PI), 0));
      scale.set(this.rng.range(4, 10), hgt, this.rng.range(4, 10));
      m4.compose(new THREE.Vector3(x, hgt / 2 - (fromRoof ? 30 : 22), z), quat, scale);
      mesh.setMatrixAt(i++, m4);
    }
    group.add(mesh);
    for (let f = 0; f < 3; f++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(this.rng.range(1.5, 3), 8, 6),
        new THREE.MeshBasicMaterial({ color: PALETTE.fireGlow, transparent: true, opacity: 0.5 }));
      s.position.set(this.rng.range(-30, 40), this.rng.range(-18, -6), this.rng.range(25, 80));
      group.add(s);
      this.fireSprites.push(s);
    }
  }

  _buildRain(group, vol) {
    const count = 500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = vol.x[0] + Math.random() * (vol.x[1] - vol.x[0]);
      positions[i * 3 + 1] = vol.y[0] + Math.random() * (vol.y[1] - vol.y[0]);
      positions[i * 3 + 2] = vol.z[0] + Math.random() * (vol.z[1] - vol.z[0]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x8ab8d0, size: 0.05, transparent: true, opacity: 0.55, fog: true,
    }));
    pts.userData.rainVol = vol;
    pts.name = 'rain';
    group.add(pts);
  }

  _buildFurniture() {
    for (const zone of Object.values(ZONES)) {
      const floor = FLOORS[zone.floor];
      const group = this.floorGroups[zone.floor];
      for (const f of zone.furniture) {
        const item = makeFurniture(f.type, f.opts);
        item.group.position.set(f.at[0], 0, f.at[1]);
        item.group.rotation.y = f.ry ?? 0;
        group.add(item.group);
        item.group.updateMatrixWorld(true);

        const fid = f.id ?? `${zone.id}_${f.type}`;
        if (Object.keys(item.sockets).length) this.sockets[fid] = item.sockets;
        for (const c of item.colliders) {
          const box = new THREE.Box3(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max));
          box.applyMatrix4(item.group.matrixWorld);
          this.collidersByFloor[zone.floor].push(box);
        }
        const PROP_PROMPTS = {
          vinyl: 'Play the vinyl deck', telescope: 'Look through the telescope',
          synth: 'Play the synth keys', fish_tank: 'Watch the fish',
          fireplace: 'Stoke the fire', vox_terminal: 'Access the VOX terminal',
          med_cabinet: 'Search for meds', weapon_rack: 'Take stock of weapons',
          ammo_crate: 'Open the crate', stash_crate: 'Pry open the stash',
          roof_crate: 'Open the crate', supply_crate: 'Open the crate',
          vox_monolith: 'Touch the core',
          gurney0: 'Treat the wounded', gurney1: 'Treat the wounded',
        };
        if (PROP_PROMPTS[f.id]) {
          this.props.push({ mesh: item.group, id: f.id, prompt: PROP_PROMPTS[f.id], floor: zone.floor });
        }
      }
    }
  }

  _collectAnimated() {
    for (const group of Object.values(this.floorGroups)) {
      group.traverse((o) => {
        if (/^(fish_|vox_ring_|fire_glow)/.test(o.name)) this.animated.push(o);
      });
    }
  }

  /** @param {string} floorId */
  setActiveFloor(floorId) {
    this.activeFloor = floorId;
    for (const [id, group] of Object.entries(this.floorGroups)) {
      group.visible = id === floorId;
    }
  }

  /** colliders for the active floor (FP push-out + combat spawn checks) */
  get colliders() { return this.collidersByFloor[this.activeFloor] || []; }

  /** Resolve "furnitureId.socketName" → Object3D or null. */
  getSocket(ref) {
    const [fid, name] = ref.split('.');
    return this.sockets[fid]?.[name] ?? null;
  }

  /** @param {number} t seconds — ambient animation on the active floor */
  update(t) {
    for (let i = 0; i < this.fireSprites.length; i++) {
      const s = this.fireSprites[i];
      s.material.opacity = 0.35 + 0.25 * Math.abs(Math.sin(t * (1.3 + i * 0.7) + i * 2));
    }
    const group = this.floorGroups[this.activeFloor];
    if (!group) return;
    for (const o of this.animated) {
      if (!o.parent?.visible && !group.visible) continue;
      if (o.name.startsWith('fish_')) {
        const i = Number(o.name.slice(5));
        if (o.userData.dead) {
          o.position.y = Math.min(1.24, o.position.y + 0.002);
          o.rotation.x = Math.PI;
        } else {
          o.position.x = Math.sin(t * (0.5 + i * 0.2) + i * 2) * 0.55;
          o.position.y = 0.85 + Math.sin(t * (0.8 + i * 0.3)) * 0.14;
          o.rotation.y = Math.cos(t * (0.5 + i * 0.2) + i * 2) > 0 ? 0 : Math.PI;
        }
      } else if (o.name.startsWith('vox_ring_')) {
        const i = Number(o.name.slice(9));
        const mat3 = /** @type {THREE.MeshStandardMaterial} */ (o.material);
        mat3.emissiveIntensity = 1.2 + Math.sin(t * 2 + i * 1.4) * 0.7 + (o.userData.excite || 0);
        o.rotation.z = t * (0.1 + i * 0.05);
      } else if (o.name === 'fire_glow') {
        const mat3 = /** @type {THREE.MeshStandardMaterial} */ (o.material);
        mat3.emissiveIntensity = 2.2 + Math.sin(t * 7.3) * 0.5 + Math.sin(t * 13.7) * 0.3;
      }
    }
    // rain fall
    const rain = group.getObjectByName('rain');
    if (rain) {
      const pos = /** @type {THREE.BufferAttribute} */ (rain.geometry.getAttribute('position'));
      const vol = rain.userData.rainVol;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - 0.35;
        if (y < vol.y[0]) y = vol.y[1];
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
  }
}
