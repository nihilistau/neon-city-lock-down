// @ts-check
// Boot/menu backdrop: neon grid, city silhouette, floating title sign.
// Lives behind the 18+ gate and main menu; disposed when a run starts.
import * as THREE from 'three';

function makeTitleTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 96px "Segoe UI", system-ui, sans-serif';
  // glow layers
  for (const [blur, color] of [[42, '#0e5e6e'], [18, '#1fb6d0'], [0, '#8ef4ff']]) {
    ctx.shadowBlur = blur; ctx.shadowColor = '#39e6ff';
    ctx.fillStyle = color;
    ctx.fillText('NEON-CITY', c.width / 2, 82);
  }
  ctx.font = '700 58px "Segoe UI", system-ui, sans-serif';
  for (const [blur, color] of [[36, '#701f47'], [14, '#d0327f'], [0, '#ffb7dd']]) {
    ctx.shadowBlur = blur; ctx.shadowColor = '#ff3fa4';
    ctx.fillStyle = color;
    ctx.fillText('L O C K - D O W N', c.width / 2, 186);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class BootScene {
  /** @param {import('./stage.js').Stage} stage @param {import('../core/rng.js').RngStream} rng */
  constructor(stage, rng) {
    this.stage = stage;
    this.group = new THREE.Group();
    this.group.name = 'bootScene';
    this.t = 0;
    /** @type {THREE.Object3D[]} */
    this._disposables = [];

    stage.scene.fog = new THREE.FogExp2(0x06070c, 0.018);

    // faint sky bounce so silhouettes read against the void
    const hemi = new THREE.HemisphereLight(0x24407a, 0x0a0714, 0.9);
    this.group.add(hemi);

    // neon grid floor
    const grid = new THREE.GridHelper(120, 60, 0x39e6ff, 0x123);
    const gmat = /** @type {THREE.LineBasicMaterial} */ (grid.material);
    gmat.transparent = true; gmat.opacity = 0.35;
    grid.position.y = -0.02;
    this.group.add(grid);

    // city silhouette ring: emissive-window boxes
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const buildingMat = new THREE.MeshStandardMaterial({ color: 0x141a2c, roughness: 0.9 });
    const windowMat = new THREE.MeshBasicMaterial({ color: 0x6eefff });
    const hotMat = new THREE.MeshBasicMaterial({ color: 0xff6fc0 });
    for (let i = 0; i < 90; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(26, 60);
      const w = rng.range(2, 6), d = rng.range(2, 6), h = rng.range(6, 34);
      const b = new THREE.Mesh(boxGeo, buildingMat);
      b.position.set(Math.cos(a) * r, h / 2 - 0.5, Math.sin(a) * r);
      b.scale.set(w, h, d);
      b.rotation.y = rng.range(0, Math.PI);
      this.group.add(b);
      // sparse lit windows as thin slabs on the near face
      const wins = rng.int(2, 5);
      for (let j = 0; j < wins; j++) {
        const win = new THREE.Mesh(boxGeo, rng.chance(0.15) ? hotMat : windowMat);
        win.position.copy(b.position);
        win.position.y = rng.range(1, h - 1);
        win.position.x += Math.cos(a) * (-0.51 * w);
        win.position.z += Math.sin(a) * (-0.51 * d);
        win.scale.set(rng.range(0.6, 2.2), rng.range(0.2, 0.9), 0.1);
        win.lookAt(0, win.position.y, 0);
        this.group.add(win);
      }
    }

    // title sign
    const tex = makeTitleTexture();
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 3),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
    );
    sign.position.set(0, 6.5, -14);
    this.group.add(sign);
    this.sign = sign;

    // under-lighting for mood
    const key = new THREE.PointLight(0x39e6ff, 40, 60);
    key.position.set(0, 8, -10);
    const fill = new THREE.PointLight(0xff3fa4, 25, 50);
    fill.position.set(-8, 2, 6);
    this.group.add(key, fill);

    stage.scene.add(this.group);
    this._disposables.push(this.group);
  }

  /** @param {number} dtMs */
  update(dtMs) {
    this.t += dtMs * 0.001;
    const cam = this.stage.camera;
    const a = this.t * 0.04;
    cam.position.set(Math.sin(a) * 6, 2.2 + Math.sin(this.t * 0.3) * 0.4, 8 + Math.cos(a) * 2);
    cam.lookAt(0, 4.2, -14);
    this.sign.position.y = 6.5 + Math.sin(this.t * 0.8) * 0.15;
  }

  dispose() {
    this.stage.scene.remove(this.group);
    this.group.traverse((obj) => {
      const mesh = /** @type {THREE.Mesh} */ (obj);
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    });
  }
}
