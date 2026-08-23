// @ts-check
// Multi-floor tower builder. Each floor lives in its own Group at a large world-X
// offset; only the active floor renders. Exposes per-floor walk rects (FP
// collision), world-space furniture colliders, interactive props, and sockets.
import * as THREE from 'three';
import { ZONES, FLOORS, PENTHOUSE } from '../../../data/zones.js';
import { makeFurniture } from './furniture.js';
import { Curtains } from './curtains.js';
import { tileTex, concreteTex, metalTex, surfaced } from '../materials/texGen.js';
import { neonRun } from '../materials/neon.js';
import { PALETTE } from '../materials/palette.js';

const TAU = Math.PI * 2;

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
// Normal-map strengths are tuned per surface: concrete carries broad grime
// streaks (soft), tile has hard grout channels (deep), brushed metal is fine
// directional grain (shallow but tight).
const mullionMat = () => new THREE.MeshStandardMaterial({
  ...surfaced(metalTex('#1a1f2c'), 1.2, 0.35), roughness: 0.5, metalness: 0.7,
});
const wallMatOf = (tint) => new THREE.MeshStandardMaterial({
  ...surfaced(concreteTex(tint), 1.6, 0.8), roughness: 0.85,
});

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
      // v0.4 added ~100 architecture meshes — dais, cages, server columns, lobby
      // columns, basement pillars, HVAC, the ramp — and registered NONE of them
      // as colliders, so the player walked straight through the lot. Anything
      // tagged `userData.solid` is picked up automatically from here on.
      this._collectSolids(group, floor.id);
      stage.scene.add(group);
    }
    this._buildFurniture();
    this._collectAnimated();
    this.setActiveFloor('penthouse');
  }

  // ── shared helpers ──────────────────────────────────────────────
  /**
   * A floor slab. `y` is the slab CENTRE, so a 0.2-thick slab at the default
   * -0.1 has its walkable top at exactly 0 — which is where actors stand
   * (Actor3D.snapTo pins root.y = 0) and where the FP eye height is measured
   * from. Anything that raises this top buries every character by the
   * difference; v0.4 shipped three such surfaces (fl27 +0.08, ground +0.04,
   * the fl40 dais +0.14 — past the ankle). There is no step-up logic anywhere,
   * so floor FINISHES must stay flush and only the base may sit lower.
   */
  _slab(group, rect, tex, y = -0.1) {
    const w = rect.x[1] - rect.x[0], d = rect.z[1] - rect.z[0];
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), tex);
    m.position.set((rect.x[0] + rect.x[1]) / 2, y, (rect.z[0] + rect.z[1]) / 2);
    m.receiveShadow = true;
    group.add(m);
    return m;
  }

  /**
   * Register every mesh tagged `userData.solid` on this floor as a world-space
   * collider. Tag at construction (`mesh.userData.solid = true`) and it is
   * picked up here — no second list to keep in sync.
   * @param {THREE.Group} group @param {string} floorId
   */
  _collectSolids(group, floorId) {
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!(/** @type {any} */ (o).isMesh) || !o.userData?.solid) return;
      this.collidersByFloor[floorId].push(new THREE.Box3().setFromObject(o));
    });
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

  _practical(group, x, y, z, color, intensity = 24, distance = 9) {
    const l = new THREE.PointLight(color, intensity, distance, 2);
    l.position.set(x, y, z);
    group.add(l);
    return l;
  }

  _walk(floorId, offsetX, rect) {
    this.walkRects[floorId].push({
      x: [rect.x[0] + offsetX, rect.x[1] + offsetX],
      z: [rect.z[0], rect.z[1]],
    });
  }

  /**
   * Architectural neon trim. One PointLight per trim run so the neon actually
   * throws colour onto the wall behind it — affordable because it lives inside a
   * floor group, and only the ONE active floor is ever visible to the renderer.
   */
  _neonTrim(group, x, y, z, w, color = PALETTE.neonMagenta) {
    neonRun(group, {
      x, y, z, length: w, axis: 'x', color, radius: 0.035,
      light: { distance: 6, power: 8 },
    });
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
    const doorMat = new THREE.MeshStandardMaterial({ ...surfaced(metalTex('#232a3a'), 1.2, 0.35), roughness: 0.35, metalness: 0.8 });
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
    const floorTex = new THREE.MeshStandardMaterial({ ...surfaced(tileTex(), 2.2, 1.0), roughness: 0.35, metalness: 0.15 });
    this._slab(group, F, floorTex);
    this._slab(group, P.balcony, new THREE.MeshStandardMaterial({ ...surfaced(concreteTex('#141824'), 1.6, 0.8), roughness: 0.8 }));
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
    // Ceiling light strips + neon trim. These were 2cm-thick slabs — the same
    // sub-pixel shimmer problem as the old trim, three times across the ceiling.
    //
    // These runs now CAST. They used to be pure emissive geometry on the theory
    // that the fixed kit's `cool` point light covered the ceiling wash. It did
    // not: a hue census of the finished frame, averaged over eight camera angles
    // in this room, came back 61.8% warm amber against 3.8% cyan and 1.7%
    // magenta — in the game whose entire identity is cyan and magenta. The three
    // brightest objects in the penthouse lit nothing at all. Spilling from the
    // visible tube is also better-motivated than an invisible point light doing
    // it from somewhere else.
    for (const lx of [-11, -4, 4]) {
      neonRun(group, {
        x: lx, y: ceil - 0.04, z: 0, length: 8, axis: 'z',
        color: PALETTE.neonCyan, radius: 0.028, intensity: 2.0,
        light: { distance: 7.5, power: 14 },
      });
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

    // velvet curtains over the glass walls
    this.curtains = new Curtains(group, ceil);
    for (const p of this.curtains.props) this.props.push(p);

    // ── building defences ──
    // ceiling turret: base + yoke + barrel, watching the stairwell corner
    const turretMat = new THREE.MeshStandardMaterial({ ...surfaced(metalTex('#232a3a'), 1.2, 0.35), roughness: 0.35, metalness: 0.8 });
    const turret = new THREE.Group();
    const tBase = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.18, 12), turretMat);
    tBase.position.y = -0.09;
    const yoke = new THREE.Group();
    yoke.position.y = -0.22;
    const tHead = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), turretMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.42), turretMat);
    barrel.position.z = 0.24;
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffaa33, emissiveIntensity: 0 }));
    muzzle.name = 'turret_muzzle';
    muzzle.position.z = 0.47;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: PALETTE.neonRed, emissiveIntensity: 1.6 }));
    eye.position.set(0, 0.06, 0.1);
    yoke.add(tHead, barrel, muzzle, eye);
    turret.add(tBase, yoke);
    turret.position.set(-3.2, ceil - 0.02, 2.2);
    group.add(turret);
    // stairwell blast shutter: framed slab that slides down over the breach corner
    const shutterFrame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 0.3), mullionMat());
    shutterFrame.position.set(-6.3, ceil - 0.1, 4.55);
    group.add(shutterFrame);
    const shutter = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, ceil, 0.12),
      new THREE.MeshStandardMaterial({ ...surfaced(metalTex('#1c222e'), 1.2, 0.35), roughness: 0.5, metalness: 0.7 }));
    shutter.position.set(-6.3, ceil + ceil / 2 - 0.15, 4.55);   // parked above the ceiling line
    group.add(shutter);
    const warnStripe = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 0.13),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: PALETTE.neonAmber, emissiveIntensity: 1.4 }));
    warnStripe.position.y = -ceil / 2 + 0.2;
    shutter.add(warnStripe);
    this.defences = {
      turret: { group: turret, yoke, muzzle },
      shutter: { mesh: shutter, upY: ceil + ceil / 2 - 0.15, downY: ceil / 2 - 0.05, down: false },
    };

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
    this._slab(group, R, new THREE.MeshStandardMaterial({ ...surfaced(concreteTex('#161a26'), 1.6, 0.8), roughness: 0.95 }));
    const par = wallMatOf('#1a1f2c');
    this._wall(group, par, { alongX: true, at: R.z[0], from: R.x[0], to: R.x[1], h: 1.0, thickness: 0.3 });
    this._wall(group, par, { alongX: true, at: R.z[1], from: R.x[0], to: R.x[1], h: 1.0, thickness: 0.3 });
    this._wall(group, par, { alongX: false, at: R.x[0], from: R.z[0], to: R.z[1], h: 1.0, thickness: 0.3 });
    this._wall(group, par, { alongX: false, at: R.x[1], from: R.z[0], to: R.z[1], h: 1.0, thickness: 0.3 });
    const shed = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3, 2.6), wallMatOf('#141824'));
    shed.position.set(-8, 1.5, -6.8);
    group.add(shed);
    // helipad ring
    const pad = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.05, 28),
      new THREE.MeshStandardMaterial({ color: 0x1a1e28, emissive: PALETTE.neonAmber, emissiveIntensity: 0.55, side: THREE.DoubleSide }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(4.5, 0.03, 0);
    group.add(pad);
    const hMark = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: PALETTE.neonAmber, emissiveIntensity: 1.2 }));
    hMark.position.set(4.5, 0.04, 0);
    group.add(hMark);
    // soil beds under the garden furniture
    for (const [x, z, w, d] of [[-5, 3.1, 4.2, 3.4], [-7.4, 3.1, 1.6, 2.2]]) {
      const soil = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d),
        new THREE.MeshStandardMaterial({ color: 0x1a140e, roughness: 1 }));
      soil.position.set(x, 0.04, z);
      group.add(soil);
    }
    // flood lights
    for (const [x, z] of [[-9.2, -7.2], [9.2, -7.2], [9.2, 7.2]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.4, 8), mullionMat());
      pole.userData.solid = true;
      pole.position.set(x, 1.2, z);
      group.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0xffe6b0, emissiveIntensity: 2.2 }));
      lamp.position.set(x, 2.35, z);
      group.add(lamp);
    }
    // HVAC blocks
    for (const [x, z] of [[-8.4, 5.6], [8.2, -5.4]]) {
      const hvac = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 1.1),
        new THREE.MeshStandardMaterial({ ...surfaced(metalTex('#2a3038'), 1.1, 0.3), metalness: 0.55, roughness: 0.45 }));
      hvac.position.set(x, 0.4, z);
      hvac.userData.solid = true;
      group.add(hvac);
    }
    this._practical(group, 4.5, 2.8, 0, PALETTE.neonAmber, 20, 12);
    this._buildExterior(group, true);
    this._buildRain(group, { x: [-12, 12], z: [-10, 10], y: [0, 14] });
    this._walk('rooftop', floor.offsetX, { x: [-9.6, 9.6], z: [-7.6, 7.6] });
  }

  /**
   * Per-floor room shell. `walls` is N(+Z), E(+X), S(-Z), W(-X):
   * 'solid' | 'open' | 'glass' | 'parapet'
   */
  _roomShell(group, floor, rect, {
    ceilH = 3, tint = '#171b28', floorTint = '#12151f', ceilColor = 0x0a0d14,
    walls = ['solid', 'solid', 'solid', 'solid'],
    floorMat = null,
  } = {}) {
    // base sits 2cm below the nominal top so a floor's own finish layer can be
    // laid flush at 0 without z-fighting; where no finish covers it the 2cm is
    // imperceptible and still walkable.
    this._slab(group, rect, floorMat || new THREE.MeshStandardMaterial({
      ...surfaced(concreteTex(floorTint), 1.6, 0.8), roughness: 0.82,
    }), -0.12);
    this._ceiling(group, rect, ceilH, ceilColor);
    const wall = wallMatOf(tint);
    const glass = glassMat();
    const specs = [
      { alongX: true, at: rect.z[1], from: rect.x[0], to: rect.x[1], kind: walls[0] },
      { alongX: false, at: rect.x[1], from: rect.z[0], to: rect.z[1], kind: walls[1] },
      { alongX: true, at: rect.z[0], from: rect.x[0], to: rect.x[1], kind: walls[2] },
      { alongX: false, at: rect.x[0], from: rect.z[0], to: rect.z[1], kind: walls[3] },
    ];
    for (const s of specs) {
      if (s.kind === 'open') continue;
      if (s.kind === 'parapet') {
        this._wall(group, wall, { alongX: s.alongX, at: s.at, from: s.from, to: s.to, h: 1.08, thickness: 0.3 });
        continue;
      }
      if (s.kind === 'glass') {
        const mid = (s.from + s.to) / 2;
        const span = Math.min(10, (s.to - s.from) * 0.7);
        this._wall(group, wall, {
          alongX: s.alongX, at: s.at, from: s.from, to: s.to, h: ceilH,
          gaps: [[mid - span / 2, mid + span / 2]],
        });
        const g = new THREE.Mesh(
          s.alongX ? new THREE.BoxGeometry(span, ceilH - 0.35, 0.07) : new THREE.BoxGeometry(0.07, ceilH - 0.35, span),
          glass);
        g.position.set(s.alongX ? mid : s.at, ceilH / 2, s.alongX ? s.at : mid);
        group.add(g);
        continue;
      }
      this._wall(group, wall, { alongX: s.alongX, at: s.at, from: s.from, to: s.to, h: ceilH });
    }
    this._walk(floor.id, floor.offsetX, {
      x: [rect.x[0] + 0.3, rect.x[1] - 0.3], z: [rect.z[0] + 0.3, rect.z[1] - 0.3],
    });
  }

  _build_fl40(group, floor) {
    const R = { x: [-10, 10], z: [-6, 6] };
    const ceilH = 3.2;
    this._roomShell(group, floor, R, {
      ceilH, tint: '#1c1218', floorTint: '#141018', ceilColor: 0x12080c,
      walls: ['solid', 'solid', 'solid', 'solid'],
    });
    const split = wallMatOf('#241018');
    this._wall(group, split, { alongX: false, at: 0, from: -6, to: 6, h: ceilH, gaps: [[-1.0, 1.0]] });
    // blast-glass in the split
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 1.8), glassMat());
    port.position.set(0, 1.85, 3.2);
    group.add(port);
    // security dais (west)
    // Reads as a distinct deck via material, not height: at 0.18 thick centred
    // on +0.05 its top was +0.14 and everyone standing on it sank past the ankle.
    const dais = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.04, 10.4),
      new THREE.MeshStandardMaterial({ ...surfaced(metalTex('#1a1520'), 1.1, 0.4), metalness: 0.35, roughness: 0.5 }));
    dais.position.set(-5.2, -0.02, 0);
    group.add(dais);
    // monitor alcove hood
    const hood = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 1.4),
      new THREE.MeshStandardMaterial({ color: 0x111, emissive: PALETTE.neonRed, emissiveIntensity: 0.35 }));
    hood.position.set(-4, 2.85, -4.6);
    group.add(hood);
    // armoury range
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.02, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x111, emissive: PALETTE.neonAmber, emissiveIntensity: 0.9 }));
    stripe.position.set(5, 0.02, 0);
    group.add(stripe);
    const lane = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.018, 1.15),
      new THREE.MeshStandardMaterial({ color: 0x1a1520, roughness: 0.7 }));
    lane.position.set(4.4, 0.02, -3.5);
    group.add(lane);
    const backstop = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.6, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x2a1818, roughness: 0.9 }));
    backstop.position.set(9.3, 0.85, -3.5);
    backstop.userData.solid = true;
    group.add(backstop);
    neonRun(group, { x: 5, y: ceilH - 0.12, z: -5.4, length: 8, axis: 'x', color: PALETTE.neonRed, radius: 0.03, intensity: 1.7, light: { distance: 8, power: 16 } });
    neonRun(group, { x: -5, y: ceilH - 0.12, z: 0, length: 8, axis: 'x', color: PALETTE.neonRed, radius: 0.025, intensity: 1.2 });
    const cage = new THREE.MeshStandardMaterial({ color: 0x1a1520, metalness: 0.55, roughness: 0.4 });
    for (const z of [-4.4, -0.2, 4.0]) {
      const bay = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.5, 0.05), cage);
      bay.position.set(8.4, 1.25, z);
      group.add(bay);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.5, 2.2), cage);
      mesh.position.set(7.2, 1.25, z);
      group.add(mesh);
    }
    // ceiling beams
    for (const x of [-6, -2, 2, 6]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 11.6),
        new THREE.MeshStandardMaterial({ ...surfaced(metalTex('#2a1820'), 1.0, 0.3), metalness: 0.5, roughness: 0.45 }));
      beam.position.set(x, ceilH - 0.08, 0);
      group.add(beam);
    }
    this._practical(group, -5, 2.4, 0, PALETTE.neonRed, 28, 10);
    this._practical(group, 5, 2.2, -3.2, PALETTE.neonAmber, 16, 8);
  }

  _build_fl27(group, floor) {
    const R = { x: [-8, 8], z: [-8, 8] };
    const ceilH = 3.4;
    this._roomShell(group, floor, R, {
      ceilH, tint: '#0c141c', floorTint: '#0a1018', ceilColor: 0x060c12,
      walls: ['solid', 'solid', 'solid', 'solid'],
    });
    // raised access floor (server tiles)
    const tile = new THREE.MeshStandardMaterial({ ...surfaced(metalTex('#15202c'), 1.4, 0.35), metalness: 0.45, roughness: 0.4 });
    this._slab(group, { x: [-7.4, 7.4], z: [-7.4, 7.4] }, tile);   // flush: top = 0
    // concentric ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.7, 32),
      new THREE.MeshStandardMaterial({ color: 0x111, emissive: PALETTE.neonCyan, emissiveIntensity: 0.7, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.04, 1.4);
    group.add(ring);
    const face = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.5, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x0a1018, emissive: PALETTE.neonCyan, emissiveIntensity: 0.4, roughness: 0.22, metalness: 0.45 }));
    face.position.set(0, 1.6, 7.35);
    group.add(face);
    for (const [x, s] of [[-1.3, 0.2], [0, 0.32], [1.3, 0.2]]) {
      const eye = new THREE.Mesh(new THREE.CircleGeometry(s, 16),
        new THREE.MeshStandardMaterial({ color: 0x061018, emissive: PALETTE.neonCyan, emissiveIntensity: 2.6, side: THREE.DoubleSide }));
      eye.position.set(x, 1.95, 7.44);
      group.add(eye);
    }
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.95, 0.24, 24),
      new THREE.MeshStandardMaterial({ ...surfaced(metalTex('#1a2430'), 1.2, 0.4), metalness: 0.55, roughness: 0.4 }));
    dais.position.set(0, 0.12, 1.4);
    group.add(dais);
    neonRun(group, { x: 0, y: ceilH - 0.1, z: 0, length: 12, axis: 'x', color: PALETTE.neonCyan, radius: 0.032, intensity: 2.0, light: { distance: 9, power: 20 } });
    // hex of server columns
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.9, 0.32),
        new THREE.MeshStandardMaterial({ color: 0x0c141c, metalness: 0.55, roughness: 0.32, emissive: PALETTE.neonCyan, emissiveIntensity: 0.14 }));
      col.position.set(Math.cos(a) * 5.2, 1.45, Math.sin(a) * 5.2);
      col.userData.solid = true;
      group.add(col);
    }
    // floor vents
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x0a1016, metalness: 0.6, roughness: 0.35 });
    for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.9), ventMat);
      v.position.set(x, 0.03, z);
      group.add(v);
    }
    this._practical(group, 0, 2.6, 1.4, PALETTE.neonCyan, 36, 11);
  }

  _build_fl12(group, floor) {
    const R = { x: [-8, 8], z: [-6, 6] };
    const ceilH = 3.05;
    const tile = new THREE.MeshStandardMaterial({ ...surfaced(tileTex('#d8e4ee'), 2.2, 0.7), roughness: 0.42, metalness: 0.06 });
    this._roomShell(group, floor, R, {
      ceilH, tint: '#243040', floorTint: '#1b2430', ceilColor: 0x1a222c,
      walls: ['solid', 'solid', 'solid', 'solid'],
      floorMat: tile,
    });
    // wet stripe
    const wet = new THREE.Mesh(new THREE.BoxGeometry(15.4, 0.015, 1.1),
      new THREE.MeshStandardMaterial({ color: 0xbfe8ff, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.35 }));
    wet.position.set(0, 0.02, 0);
    group.add(wet);
    // treatment alcoves
    const screen = new THREE.MeshStandardMaterial({ color: 0xe8f0f6, roughness: 0.7 });
    for (const x of [1.4, 5.2]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.0, 2.6), screen);
      wall.position.set(x, 1.05, -3.2);
      group.add(wall);
    }
    for (const x of [3.5, -3.2]) {
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16),
        new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0xe8f4ff, emissiveIntensity: 2.8, side: THREE.DoubleSide }));
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(x, ceilH - 0.08, -2.2);
      group.add(lamp);
    }
    neonRun(group, { x: 0, y: ceilH - 0.1, z: -5.5, length: 13, axis: 'x', color: 0xbfe8ff, radius: 0.022, intensity: 1.5, light: { distance: 8, power: 14 } });
    neonRun(group, { x: 0, y: ceilH - 0.1, z: 5.5, length: 13, axis: 'x', color: 0xbfe8ff, radius: 0.022, intensity: 1.1 });
    // cabinet glow strip
    const glow = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0x3dff9a, emissiveIntensity: 1.4 }));
    glow.position.set(-4.5, 1.7, -5.15);
    group.add(glow);
    this._practical(group, 3.5, 2.4, -2.2, 0xe8f4ff, 22, 8);
    this._practical(group, -3.2, 2.4, 1.5, 0xbfe8ff, 14, 7);
  }

  _build_ground(group, floor) {
    const R = { x: [-10, 10], z: [-8, 10] };
    const ceilH = 4.4;
    this._roomShell(group, floor, R, {
      ceilH, tint: '#161c28', floorTint: '#121820', ceilColor: 0x0c1018,
      walls: ['glass', 'solid', 'solid', 'solid'],
    });
    const marble = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.22, metalness: 0.18 });
    this._slab(group, { x: [-9.4, 9.4], z: [-7.4, 6.4] }, marble);   // flush: top = 0
    this._neonTrim(group, 0, 3.7, R.z[0] + 0.16, 16, PALETTE.neonCyan);
    this._neonTrim(group, 0, 4.15, R.z[1] - 0.2, 16, PALETTE.neonMagenta);
    // mezzanine strip along -Z
    const mez = new THREE.Mesh(new THREE.BoxGeometry(18.4, 0.12, 2.2),
      new THREE.MeshStandardMaterial({ ...surfaced(metalTex('#1a2230'), 1.2, 0.35), metalness: 0.4, roughness: 0.45 }));
    mez.position.set(0, 3.05, -6.6);
    group.add(mez);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(18.4, 0.06, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x111, emissive: PALETTE.neonCyan, emissiveIntensity: 0.8 }));
    rail.position.set(0, 3.45, -5.55);
    group.add(rail);
    // columns
    const colMat = new THREE.MeshStandardMaterial({ ...surfaced(concreteTex('#2a3140'), 1.4, 0.5), roughness: 0.55, metalness: 0.12 });
    for (const x of [-6.5, 0, 6.5]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, ceilH, 12), colMat);
      col.position.set(x, ceilH / 2, 2.4);
      col.userData.solid = true;
      group.add(col);
    }
    const sign = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.85, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x0a0c12, emissive: PALETTE.neonCyan, emissiveIntensity: 1.05 }));
    sign.position.set(0, 3.55, -7.85);
    group.add(sign);
    neonRun(group, { x: 0, y: ceilH - 0.12, z: 0, length: 16, axis: 'x', color: PALETTE.neonCyan, radius: 0.045, intensity: 2.4, light: { distance: 10, power: 24 } });
    // vestibule mats
    const mat = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.04, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x1a1020, roughness: 0.9 }));
    mat.position.set(0, 0.03, 7.4);
    group.add(mat);
    this._practical(group, 0, 3.2, 2.4, PALETTE.neonCyan, 32, 12);
    this._practical(group, 0, 2.4, -4, PALETTE.neonMagenta, 18, 9);
  }

  _build_basement(group, floor) {
    const R = { x: [-14, 14], z: [-10, 10] };
    const ceilH = 2.55;
    this._roomShell(group, floor, R, {
      ceilH, tint: '#12141a', floorTint: '#0c0e12', ceilColor: 0x0a0c10,
      walls: ['solid', 'open', 'solid', 'solid'],
    });
    // ramp volume on +X (open wall)
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.2, 8),
      new THREE.MeshStandardMaterial({ ...surfaced(concreteTex('#1a1c22'), 1.4, 0.7), roughness: 0.9 }));
    ramp.rotation.z = -0.12;
    ramp.position.set(11.2, 0.35, 4);
    ramp.userData.solid = true;
    group.add(ramp);
    for (let i = 0; i < 7; i++) {
      const stain = new THREE.Mesh(new THREE.CircleGeometry(0.45 + this.rng.next() * 0.9, 12),
        new THREE.MeshStandardMaterial({ color: 0x07080c, roughness: 0.28 }));
      stain.rotation.x = -Math.PI / 2;
      stain.position.set(this.rng.range(-12, 10), 0.014, this.rng.range(-8, 8));
      group.add(stain);
    }
    const lineMat = new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0xffc14a, emissiveIntensity: 0.4 });
    for (const x of [-9, -4, 1, 6]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 4.6), lineMat);
      line.position.set(x, 0.03, -5.2);
      group.add(line);
      const stop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x2a2010, roughness: 0.8 }));
      stop.position.set(x, 0.05, -7.4);
      group.add(stop);
    }
    for (const z of [-6.5, -2, 2.5, 7]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 26, 8),
        new THREE.MeshStandardMaterial({ ...surfaced(metalTex('#3a4038'), 1.0, 0.3), metalness: 0.7, roughness: 0.4 }));
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(0, ceilH - 0.18, z);
      group.add(pipe);
    }
    // structural columns grid
    const colM = new THREE.MeshStandardMaterial({ ...surfaced(concreteTex('#1a1c20'), 1.2, 0.6), roughness: 0.75 });
    for (const x of [-7, 0, 7]) {
      for (const z of [-4, 4]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, ceilH, 10), colM);
        col.position.set(x, ceilH / 2, z);
        col.userData.solid = true;
        group.add(col);
      }
    }
    const sodium = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0xffb347, emissiveIntensity: 2.0 }));
    sodium.position.set(0, ceilH - 0.08, 0);
    group.add(sodium);
    neonRun(group, { x: 0, y: 0.04, z: 8.8, length: 20, axis: 'x', color: 0xffb347, radius: 0.02, intensity: 0.6, light: { distance: 5, power: 6 } });
    this._practical(group, 0, 2.1, 0, 0xffb347, 22, 10);
  }

  _buildExterior(group, fromRoof = false) {
    const tex = cityWindowsTexture();
    // matC is declared FIRST: the loader callbacks below close over it, and it
    // used to be read in a callback declared above its own `const` — a TDZ read
    // that only survived because TextureLoader is always async. Any cache hit or
    // sync path would have thrown a ReferenceError at world build.
    const matC = new THREE.MeshBasicMaterial({ map: tex, fog: true });
    const loader = new THREE.TextureLoader();
    loader.load('/assets/city/windows.jpg', (map) => {
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      // Scale the tiling to the tower's real height so window aspect stays
      // constant: a flat repeat(2,4) gave ~32x64 windows per box face — windows
      // about 15cm wide — which aliased into moire that bloom then amplified.
      map.repeat.set(2, 4);
      map.anisotropy = Math.min(8, this.stage.renderer.capabilities.getMaxAnisotropy?.() ?? 1);
      matC.map = map;
      matC.needsUpdate = true;
    });
    loader.load('/assets/city/skyline.jpg', (map) => {
      map.colorSpace = THREE.SRGBColorSpace;
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(90, 40),
        new THREE.MeshBasicMaterial({ map, fog: true }));
      plate.position.set(4, fromRoof ? 8 : 2, fromRoof ? 42 : 48);
      plate.lookAt(4, fromRoof ? 8 : 2, 0);
      group.add(plate);
    });
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
    // Cached so update() doesn't run getObjectByName() — a full recursive
    // traversal of the entire active floor group — every single frame just to
    // rediscover this one object.
    group.userData.rain = pts;
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
          // mystery-case clue props. Without these four the `ledger` clue was
          // unobtainable (its zone `vanity` has no other interactable), so
          // `ask_kai` never unlocked and the dead-drop case degraded to a guess.
          vanity_table: 'Search the vanity', shower_pod: 'Inspect the shower pod',
          security_desk: 'Read the camera logs', monitor_wall: 'Study the monitor wall',
          reception_desk: 'Search the reception desk', helipad: 'Inspect the helipad rail',
        };
        if (PROP_PROMPTS[f.id]) {
          // Clone materials on prop meshes so hover-highlight can't mutate the
          // shared cached materials used by non-interactive furniture.
          // Deduped per source material: this used to clone PER MESH, so a prop
          // like weapon_rack or bar_shelves turned one shared cached material
          // into 10-30 identical copies and threw away _matCache's whole point.
          // One clone per distinct source material keeps the isolation and the
          // intra-prop sharing.
          const clones = new Map();
          item.group.traverse((o) => {
            const m = /** @type {THREE.Mesh} */ (o);
            if (!m.isMesh || !m.material || Array.isArray(m.material)) return;
            let c = clones.get(m.material);
            if (!c) clones.set(m.material, (c = m.material.clone()));
            m.material = c;
          });
          this.props.push({ mesh: item.group, id: f.id, prompt: PROP_PROMPTS[f.id], floor: zone.floor });
        }
      }
    }
  }

  _collectAnimated() {
    for (const group of Object.values(this.floorGroups)) {
      group.traverse((o) => {
        // `cam_` and `vinyl_disc` were named for animation that was never
        // written — monitors.js only ever implemented NewsTicker, despite the
        // comment in furniture.js claiming it drove the cam screens.
        if (/^(fish_|vox_ring_|fire_glow|cam_|vinyl_disc)/.test(o.name)) this.animated.push(o);
      });
    }
  }

  /**
   * Compile every floor's shaders up front, while a loading screen is up.
   *
   * A forward renderer bakes the scene's LIGHT COUNT into each material's
   * program, and the floors deliberately differ (measured: 8 to 12 lights), so
   * arriving somewhere new meant compiling a fresh variant of every material on
   * it. Measured across one visit to all seven floors, the program count climbed
   * 41 -> 77 — seventy-odd link steps, each landing as a stall the moment the
   * elevator doors opened. Programs are cached by the renderer, so paying for
   * all of them here means the ride is the only thing the player waits on.
   *
   * Best-effort: a driver that chokes on this must not take the boot with it.
   * @param {THREE.WebGLRenderer} renderer @param {THREE.Camera} camera
   */
  precompile(renderer, camera) {
    const wasActive = this.activeFloor;
    try {
      for (const id of Object.keys(this.floorGroups)) {
        this.setActiveFloor(id);
        renderer.compile(this.stage.scene, camera);
      }
    } catch (err) {
      console.warn('[world] shader precompile skipped', err);
    }
    if (wasActive) this.setActiveFloor(wasActive);
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
    const dt = this._lastT ? Math.min(0.1, t - this._lastT) : 0.016;
    this._lastT = t;
    if (this.curtains && this.activeFloor === 'penthouse') this.curtains.update(dt);
    // shutter slide + turret muzzle cool-off
    if (this.defences) {
      const sh = this.defences.shutter;
      const targetY = sh.down ? sh.downY : sh.upY;
      if (Math.abs(sh.mesh.position.y - targetY) > 0.005) {
        sh.mesh.position.y += (targetY - sh.mesh.position.y) * Math.min(1, dt * 2.2);
      }
      const mz = this.defences.turret.muzzle.material;
      if (mz.emissiveIntensity > 0) mz.emissiveIntensity = Math.max(0, mz.emissiveIntensity - dt * 14);
    }
    for (let i = 0; i < this.fireSprites.length; i++) {
      const s = this.fireSprites[i];
      s.material.opacity = 0.35 + 0.25 * Math.abs(Math.sin(t * (1.3 + i * 0.7) + i * 2));
    }
    const group = this.floorGroups[this.activeFloor];
    if (!group) return;
    for (const o of this.animated) {
      // `group` is by definition the ACTIVE floor, whose visible is always true,
      // so the old `&& !group.visible` made this guard dead and animated all
      // seven floors (including per-frame emissive writes) every frame.
      if (!o.parent?.visible) continue;
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
        // wrapped: `t` is seconds-since-load, so an unwrapped angle climbs into
        // the range where fp32 has no mantissa left for the fraction of a turn
        o.rotation.z = (t * (0.1 + i * 0.05)) % TAU;
      } else if (o.name === 'fire_glow') {
        const mat3 = /** @type {THREE.MeshStandardMaterial} */ (o.material);
        mat3.emissiveIntensity = 2.2 + Math.sin(t * 7.3) * 0.5 + Math.sin(t * 13.7) * 0.3;
      } else if (o.name.startsWith('cam_')) {
        // security feed: slow per-screen brightness drift plus a brief dropout,
        // each screen on its own phase so the wall never pulses as one block
        const i = Number(o.name.slice(4));
        const mat3 = /** @type {THREE.MeshStandardMaterial} */ (o.material);
        const drift = 0.32 + Math.sin(t * (0.7 + i * 0.13) + i * 1.7) * 0.09;
        // dropout: ~1 frame in 12 of a 3.1s cycle, offset per screen
        const cycle = (t * 0.32 + i * 0.37) % 1;
        mat3.emissiveIntensity = cycle > 0.97 ? 0.06 : drift;
      } else if (o.name === 'vinyl_disc') {
        // 33 1/3 RPM = 0.5556 rev/s. The deck is powered, so it turns.
        o.rotation.y = (t * 0.5556 * TAU) % TAU;
      }
    }
    // rain fall
    const rain = group.userData.rain;
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
