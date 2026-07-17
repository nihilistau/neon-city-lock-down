// @ts-check
// Builds the penthouse floor: shell (floor/walls/glass/balcony), furniture from
// zone defs, exterior city backdrop. Returns a world handle with sockets,
// colliders, and interactive prop meshes for the picker.
import * as THREE from 'three';
import { ZONES, PENTHOUSE } from '../../../data/zones.js';
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

export class World3D {
  /** @param {import('../stage.js').Stage} stage @param {import('../../core/rng.js').RngStream} rng */
  constructor(stage, rng) {
    this.stage = stage;
    this.group = new THREE.Group();
    this.group.name = 'world';
    /** @type {Record<string, Record<string, THREE.Object3D>>} furnitureId → sockets */
    this.sockets = {};
    /** @type {THREE.Box3[]} world-space furniture colliders */
    this.colliders = [];
    /** @type {{mesh: THREE.Object3D, id:string, prompt:string}[]} */
    this.props = [];

    this._buildShell();
    this._buildExterior(rng);
    this._buildFurniture();
    stage.scene.add(this.group);
  }

  _buildShell() {
    const P = PENTHOUSE;
    const [x0, x1] = P.floor.x, [z0, z1] = P.floor.z;
    const w = x1 - x0, d = z1 - z0;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;

    const floorMat = new THREE.MeshStandardMaterial({ map: tileTex(), roughness: 0.35, metalness: 0.15 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), floorMat);
    floor.position.set(cx, -0.1, cz);
    floor.receiveShadow = true;
    this.group.add(floor);

    // balcony slab
    const B = P.balcony;
    const bw = B.x[1] - B.x[0], bd = B.z[1] - B.z[0];
    const slab = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.2, bd),
      new THREE.MeshStandardMaterial({ map: concreteTex('#141824'), roughness: 0.8 }));
    slab.position.set((B.x[0] + B.x[1]) / 2, -0.1, (B.z[0] + B.z[1]) / 2);
    slab.receiveShadow = true;
    this.group.add(slab);

    // ceiling (interior only)
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, d),
      new THREE.MeshStandardMaterial({ color: 0x0c0f18, roughness: 0.9 }));
    ceil.position.set(cx, P.ceilingY + 0.075, cz);
    this.group.add(ceil);

    // recessed light strips in the ceiling
    for (const lx of [-4, 4]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, d * 0.7),
        new THREE.MeshStandardMaterial({ color: 0x111111, emissive: PALETTE.neonCyan, emissiveIntensity: 1.2 }));
      strip.position.set(lx, P.ceilingY - 0.01, cz);
      this.group.add(strip);
    }

    // solid walls: -z (behind bar) and -x
    const wallMat = new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.85 });
    const wallBack = new THREE.Mesh(new THREE.BoxGeometry(w, P.ceilingY, 0.2), wallMat);
    wallBack.position.set(cx, P.ceilingY / 2, z0 - 0.1);
    wallBack.receiveShadow = true;
    this.group.add(wallBack);
    const wallLeft = new THREE.Mesh(new THREE.BoxGeometry(0.2, P.ceilingY, d), wallMat);
    wallLeft.position.set(x0 - 0.1, P.ceilingY / 2, cz);
    wallLeft.receiveShadow = true;
    this.group.add(wallLeft);

    // neon trim line along the solid walls
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: PALETTE.neonMagenta, emissiveIntensity: 2.2 }));
    trim.position.set(cx, 2.4, z0 + 0.03);
    this.group.add(trim);

    // glass curtain walls: +z (with door gap) and +x
    const glassMat = new THREE.MeshStandardMaterial({
      color: PALETTE.glass, transparent: true, opacity: 0.18,
      roughness: 0.08, metalness: 0.2, side: THREE.DoubleSide,
    });
    const mullionMat = new THREE.MeshStandardMaterial({ map: metalTex('#1a1f2c'), roughness: 0.5, metalness: 0.7 });
    const gap = P.doorGap;
    // +z wall panes
    const paneEdges = [x0, -4, 0, gap.x[0], gap.x[1], x1];
    for (let i = 0; i < paneEdges.length - 1; i++) {
      const a = paneEdges[i], b = paneEdges[i + 1];
      if (a === gap.x[0] && b === gap.x[1]) continue; // doorway
      const pane = new THREE.Mesh(new THREE.BoxGeometry(b - a - 0.08, P.ceilingY, 0.05), glassMat);
      pane.position.set((a + b) / 2, P.ceilingY / 2, z1);
      this.group.add(pane);
    }
    for (const mx of paneEdges) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, P.ceilingY, 0.12), mullionMat);
      post.position.set(mx, P.ceilingY / 2, z1);
      this.group.add(post);
    }
    // +x wall panes
    const paneEdgesZ = [z0, -2, 2, z1];
    for (let i = 0; i < paneEdgesZ.length - 1; i++) {
      const a = paneEdgesZ[i], b = paneEdgesZ[i + 1];
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.05, P.ceilingY, b - a - 0.08), glassMat);
      pane.position.set(x1, P.ceilingY / 2, (a + b) / 2);
      this.group.add(pane);
    }
    for (const mz of paneEdgesZ) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, P.ceilingY, 0.09), mullionMat);
      post.position.set(x1, P.ceilingY / 2, mz);
      this.group.add(post);
    }

    // balcony rail
    const railMat = mullionMat;
    const railTop = (x, z, wRail, dRail) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(wRail, 0.05, dRail), railMat);
      r.position.set(x, 1.06, z);
      this.group.add(r);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(Math.max(wRail - 0.05, 0.04), 0.95, Math.max(dRail - 0.05, 0.04)), glassMat);
      glass.position.set(x, 0.55, z);
      this.group.add(glass);
    };
    railTop((B.x[0] + B.x[1]) / 2, B.z[1], bw, 0.06);           // far edge
    railTop(B.x[0], (B.z[0] + B.z[1]) / 2 + 0.03, 0.06, bd);    // sides
    railTop(B.x[1], (B.z[0] + B.z[1]) / 2 + 0.03, 0.06, bd);
  }

  _buildExterior(rng) {
    // distant city ring — emissive-window slabs, unlit, cheap
    const tex = cityWindowsTexture();
    const mat = new THREE.MeshBasicMaterial({ map: tex, fog: true });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, mat, 80);
    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    let i = 0;
    while (i < 80) {
      const a = rng.range(-0.4, Math.PI + 0.4);        // spread facing the glass walls
      const r = rng.range(30, 90);
      const x = Math.cos(a) * r + 4;
      const z = Math.abs(Math.sin(a)) * r + 8;         // all beyond the balcony
      const hgt = rng.range(10, 55);
      quat.setFromEuler(new THREE.Euler(0, rng.range(0, Math.PI), 0));
      scale.set(rng.range(4, 10), hgt, rng.range(4, 10));
      m4.compose(new THREE.Vector3(x, hgt / 2 - 22, z), quat, scale);
      mesh.setMatrixAt(i++, m4);
    }
    this.group.add(mesh);

    // a couple of far fires (riot glow) — flickering handled by lighting.update
    this.fireSprites = [];
    for (let f = 0; f < 3; f++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(rng.range(1.5, 3), 8, 6),
        new THREE.MeshBasicMaterial({ color: PALETTE.fireGlow, transparent: true, opacity: 0.5 }));
      s.position.set(rng.range(-30, 40), rng.range(-15, -5), rng.range(35, 80));
      this.group.add(s);
      this.fireSprites.push(s);
    }
  }

  _buildFurniture() {
    for (const zone of Object.values(ZONES)) {
      for (const f of zone.furniture) {
        const item = makeFurniture(f.type, f.opts);
        item.group.position.set(f.at[0], 0, f.at[1]);
        item.group.rotation.y = f.ry ?? 0;
        this.group.add(item.group);
        item.group.updateMatrixWorld(true);

        const fid = f.id ?? `${zone.id}_${f.type}`;
        if (Object.keys(item.sockets).length) this.sockets[fid] = item.sockets;
        for (const c of item.colliders) {
          const box = new THREE.Box3(
            new THREE.Vector3(...c.min), new THREE.Vector3(...c.max));
          box.applyMatrix4(item.group.matrixWorld);
          this.colliders.push(box);
        }
        if (f.type === 'vinyl_player') {
          this.props.push({ mesh: item.group, id: 'vinyl', prompt: 'Play the vinyl deck' });
        }
        if (f.type === 'telescope') {
          this.props.push({ mesh: item.group, id: 'telescope', prompt: 'Look through the telescope' });
        }
      }
    }
  }

  /** Resolve a socket reference "furnitureId.socketName" → Object3D or null. */
  getSocket(ref) {
    const [fid, name] = ref.split('.');
    return this.sockets[fid]?.[name] ?? null;
  }

  /** @param {number} t seconds — ambient exterior animation */
  update(t) {
    for (let i = 0; i < this.fireSprites.length; i++) {
      const s = this.fireSprites[i];
      s.material.opacity = 0.35 + 0.25 * Math.abs(Math.sin(t * (1.3 + i * 0.7) + i * 2));
    }
  }
}
