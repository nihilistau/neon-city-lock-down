// @ts-check
// Raycast interaction: hover highlight + E-prompt for registered props.
// Pointer-locked modes (FP/TPS) cast from screen center; director mode from the
// mouse position.
import * as THREE from 'three';
import { emit } from '../core/bus.js';

/** screen-centre ray origin — constant, was allocated fresh every frame */
const _center = new THREE.Vector2(0, 0);

// Hover picking only feeds the "press E" prompt, so it does not need to run at
// display rate. At 60Hz it was doing a full recursive raycast against EVERY
// registered prop EVERY frame — ~20 props plus live hostiles, each a full
// subtree traversal allocating a fresh results array. vox_monolith alone is 4x
// TorusGeometry(...,8,32) ≈ 2k triangles of ray/triangle tests.
const PICK_INTERVAL_MS = 100;   // 10Hz — imperceptible for a prompt

const _box = new THREE.Box3();
const _worldCentre = new THREE.Vector3();

export class Picker {
  /**
   * @param {import('./stage.js').Stage} stage
   * @param {import('../camera/cameraRig.js').CameraRig} rig
   */
  constructor(stage, rig) {
    this.stage = stage;
    this.rig = rig;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 4.5;
    this.mouse = new THREE.Vector2(0, 0);
    /** @type {{mesh: THREE.Object3D, id: string, prompt: string, onInteract?: () => void}[]} */
    this.targets = [];
    /** @type {(typeof this.targets)[0]|null} */
    this.hovered = null;
    this._lastPickMs = 0;
    /** reused intersection buffer — `intersectObject` appends, so clear before each call */
    this._hits = [];

    document.addEventListener('mousemove', (e) => {
      this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    });
    stage.renderer.domElement.addEventListener('click', () => {
      if (this.rig.mode === 'director' && this.hovered?.onInteract) this.hovered.onInteract();
    });
    rig.fp.onInteract = () => { if (this.hovered?.onInteract) this.hovered.onInteract(); };
  }

  /** @param {{mesh: THREE.Object3D, id: string, prompt: string, onInteract?: () => void}} t */
  register(t) {
    this.targets.push(t);
  }

  /**
   * Bounding radius of a target, measured once and cached. Props are rigid, so
   * the local extent never changes; only the world position of `mesh` moves
   * (which is why the centre is re-read from matrixWorld every pick).
   * @param {(typeof this.targets)[0]} t
   */
  _radiusOf(t) {
    if (t._radius === undefined) {
      _box.setFromObject(t.mesh);
      if (_box.isEmpty()) return 1;   // nothing renderable yet — don't cache a 0
      // Radius about the object's ORIGIN, not about the box centre: the origin
      // is what the cull below measures from, and for props like monitor_wall
      // or the elevator shaft the geometry sits well off its group origin.
      _worldCentre.setFromMatrixPosition(t.mesh.matrixWorld);
      const dx = Math.max(_box.max.x - _worldCentre.x, _worldCentre.x - _box.min.x);
      const dy = Math.max(_box.max.y - _worldCentre.y, _worldCentre.y - _box.min.y);
      const dz = Math.max(_box.max.z - _worldCentre.z, _worldCentre.z - _box.min.z);
      // +25%: hostiles are skinned and their real extent drifts with the pose,
      // and this radius is measured once and cached.
      t._radius = 1.25 * Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return t._radius;
  }

  /** Objects on a hidden floor group are never drawn, but Raycaster does NOT
   * skip them — it has no visibility check at all. Six of the seven floors are
   * hidden at any moment, so this alone removes most of the work. */
  _visible(o) {
    for (let n = o; n; n = n.parent) if (!n.visible) return false;
    return true;
  }

  update() {
    // Third person also engages pointer lock, so `mousemove` stops firing and
    // `this.mouse` goes stale — it must raycast from screen centre like first
    // person does, which is where its crosshair actually sits.
    const now = performance.now();
    if (now - this._lastPickMs < PICK_INTERVAL_MS) return;
    this._lastPickMs = now;

    const locked = this.rig.mode === 'firstPerson' || this.rig.mode === 'thirdPerson';
    this.raycaster.setFromCamera(locked ? _center : this.mouse, this.stage.camera);
    const far = this.rig.mode === 'firstPerson' ? 3.2 : 30;
    this.raycaster.far = far;

    const ray = this.raycaster.ray;
    let best = null, bestDist = Infinity;
    for (const t of this.targets) {
      if (!this._visible(t.mesh)) continue;
      // Broad phase: two sphere rejections before paying for a subtree traversal.
      const r = this._radiusOf(t);
      _worldCentre.setFromMatrixPosition(t.mesh.matrixWorld);
      const reach = far + r;
      if (ray.origin.distanceToSquared(_worldCentre) > reach * reach) continue;
      if (ray.distanceSqToPoint(_worldCentre) > r * r) continue;
      const hits = this._hits;
      hits.length = 0;
      this.raycaster.intersectObject(t.mesh, true, hits);
      if (hits.length && hits[0].distance < bestDist) { best = t; bestDist = hits[0].distance; }
    }
    if (best !== this.hovered) {
      if (this.hovered) this._setGlow(this.hovered.mesh, 0);
      this.hovered = best;
      if (best) this._setGlow(best.mesh, 0.5);
      emit('pick.hover', best ? { id: best.id, prompt: best.prompt } : null);
    }
  }

  _setGlow(root, amount) {
    root.traverse((o) => {
      const m = /** @type {THREE.Mesh} */ (o);
      if (m.isMesh && m.material && 'emissive' in m.material) {
        const mat = /** @type {THREE.MeshStandardMaterial} */ (m.material);
        if (amount > 0) {
          if (mat.userData.baseEmissive === undefined) {
            mat.userData.baseEmissive = mat.emissive.getHex();
            mat.userData.baseEmissiveI = mat.emissiveIntensity;
          }
          mat.emissive.setHex(0x39e6ff);
          mat.emissiveIntensity = amount;
        } else if (mat.userData.baseEmissive !== undefined) {
          mat.emissive.setHex(mat.userData.baseEmissive);
          mat.emissiveIntensity = mat.userData.baseEmissiveI;
        }
      }
    });
  }
}
