// @ts-check
// Raycast interaction: hover highlight + E-prompt for registered props.
// FP mode casts from screen center; director mode from the mouse position.
import * as THREE from 'three';
import { emit } from '../core/bus.js';

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

  update() {
    const origin = this.rig.mode === 'firstPerson' ? new THREE.Vector2(0, 0) : this.mouse;
    this.raycaster.setFromCamera(origin, this.stage.camera);
    this.raycaster.far = this.rig.mode === 'firstPerson' ? 3.2 : 30;

    let best = null, bestDist = Infinity;
    for (const t of this.targets) {
      const hits = this.raycaster.intersectObject(t.mesh, true);
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
