// @ts-check
// Thick, luscious velvet curtains over the penthouse glass walls. Each window has
// a left + right panel that gather to the edges (open) or draw across (closed),
// physically occluding the city view. Built into the penthouse group so they hide
// with the floor. Toggled via tie-back pull props.
import * as THREE from 'three';

/** velvet: deep, matte, with a warm sheen fresnel for the "luscious" read */
function velvetMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x3a0d1a,          // deep burgundy
    roughness: 0.95, metalness: 0.0,
    sheen: 1.0, sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0x8a3a2a),  // warm dust-of-gold sheen
    side: THREE.DoubleSide,
  });
}

/**
 * Build one pleated panel spanning `width`, `height` tall, as a group of vertical
 * folds. Pivot is at x=0 (the gather edge); the panel extends toward +x by
 * `width` when scaleX=1 (closed) and bunches near x=0 when scaleX→small (open).
 */
function buildPanel(width, height, mat, pleats = 9) {
  const g = new THREE.Group();
  const foldR = width / pleats * 0.62;
  for (let i = 0; i < pleats; i++) {
    const x = (i + 0.5) * (width / pleats);
    const fold = new THREE.Mesh(
      new THREE.CylinderGeometry(foldR, foldR * 0.9, height, 10, 3, false, 0, Math.PI * 1.15),
      mat
    );
    fold.rotation.x = Math.PI;             // open side faces the room
    fold.rotation.y = Math.PI / 2;
    fold.position.set(x, height / 2, 0);
    fold.castShadow = true;
    g.add(fold);
  }
  // solid backing sheet so a closed curtain fully blocks the view through gaps
  const back = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.03), mat);
  back.position.set(width / 2, height / 2, foldR * 0.8);
  g.add(back);
  // valance/rod at the top
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, width, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.4, metalness: 0.6 }));
  rod.rotation.z = Math.PI / 2;
  rod.position.set(width / 2, height + 0.02, 0.03);
  g.add(rod);
  return g;
}

export class Curtains {
  /**
   * @param {THREE.Group} group penthouse floor group (local coords)
   * @param {number} ceilingY
   */
  constructor(group, ceilingY) {
    this.group = group;
    /** @type {Record<string, any>} windowId → { left, right, rod, open, t, def }@ */
    this.windows = {};
    /** @type {{mesh: THREE.Object3D, id:string, prompt:string, floor:string}[]} */
    this.props = [];
    const h = ceilingY - 0.05;
    const mat = velvetMaterial();

    // main window: +z wall (z≈6), split at x=0
    this._addWindow('main', {
      axis: 'x', fixed: 5.78, from: -8.4, to: 7.8, split: -0.3, height: h,
      faceInward: -1, mat,
    });
    // side window: +x wall (x≈8), split at z=0
    this._addWindow('side', {
      axis: 'z', fixed: 7.78, from: -5.8, to: 5.8, split: 0, height: h,
      faceInward: -1, mat,
    });
  }

  _addWindow(id, def) {
    const { axis, fixed, from, to, split, height, mat } = def;
    const wLeft = split - from, wRight = to - split;
    const left = buildPanel(wLeft, height, mat);
    const right = buildPanel(wRight, height, mat);

    // place: for axis 'x', panels run along x at fixed z; pivots at the split,
    // left extends toward -x (rotate 180° about Y so its +x local points to -x)
    if (axis === 'x') {
      left.position.set(split, 0, fixed);
      left.rotation.y = Math.PI;
      right.position.set(split, 0, fixed);
    } else {
      // axis 'z': run along z at fixed x. rotate so local +x maps to world +z.
      left.position.set(fixed, 0, split);
      left.rotation.y = -Math.PI / 2;    // local +x → world -z
      right.position.set(fixed, 0, split);
      right.rotation.y = Math.PI / 2;     // local +x → world +z
    }
    this.group.add(left, right);

    // a tie-back pull, a small brass ring, sits at the split near head height
    const pull = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.018, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0x8a6f3c, roughness: 0.35, metalness: 0.8, emissive: 0x2a1e08 }));
    if (axis === 'x') pull.position.set(split, 1.4, fixed - 0.12);
    else pull.position.set(fixed - 0.12, 1.4, split);
    this.group.add(pull);

    this.windows[id] = { left, right, open: true, t: 0, def };  // t: 0 open, 1 closed
    this.props.push({ mesh: pull, id: `curtain_${id}`, prompt: `Draw the ${id} curtains`, floor: 'penthouse' });
    this._apply(id, 0);
  }

  /** @param {string} id @param {number} t 0 open .. 1 closed */
  _apply(id, t) {
    const w = this.windows[id];
    // open (t=0): panels bunched to a sliver at the edge. closed (t=1): full width.
    const s = 0.12 + t * 0.88;
    w.left.scale.x = s;
    w.right.scale.x = s;
  }

  /** @param {string} id */
  toggle(id) {
    const w = this.windows[id];
    if (!w) return null;
    w.open = !w.open;
    return w.open;
  }

  get anyClosed() {
    return Object.values(this.windows).some((w) => !w.open);
  }

  /** @param {number} dt seconds */
  update(dt) {
    for (const id of Object.keys(this.windows)) {
      const w = this.windows[id];
      const target = w.open ? 0 : 1;
      if (Math.abs(w.t - target) > 0.001) {
        w.t += (target - w.t) * Math.min(1, dt * 3.5);
        this._apply(id, w.t);
      }
    }
  }
}
