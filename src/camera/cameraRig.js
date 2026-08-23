// @ts-check
// Camera mode owner: auto (situational director) | director (free orbit) |
// firstPerson | cinematic (cutscenes). 'C' cycles the first three.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FirstPersonControls } from './firstPerson.js';
import { CameraDirector } from './cameraDirector.js';
import { emit } from '../core/bus.js';
import { settings, setSetting } from '../core/settings.js';
import { cfg } from '../core/config.js';

export class CameraRig {
  /**
   * @param {import('../scene3d/stage.js').Stage} stage
   * @param {{ colliders: THREE.Box3[] }} world
   */
  constructor(stage, world) {
    this.stage = stage;
    this.camera = stage.camera;

    this.orbit = new OrbitControls(this.camera, stage.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = cfg('camera.rig.orbit.damping', 0.08);
    this.orbit.maxPolarAngle = cfg('camera.rig.orbit.maxPolar', Math.PI * 0.52);
    this.orbit.minDistance = cfg('camera.rig.orbit.minDist', 1.2);
    this.orbit.maxDistance = cfg('camera.rig.orbit.maxDist', 18);
    this.orbit.target.set(...cfg('camera.rig.target', [-3.5, 1.1, 0]));
    this.camera.position.set(...cfg('camera.rig.initialPos', [2.5, 3.2, 5.5]));

    this.fp = new FirstPersonControls(this.camera, stage.renderer.domElement, world);
    /** @type {CameraDirector|null} situational auto-camera (attached post-setup) */
    this.director = null;

    /** @type {'auto'|'director'|'firstPerson'|'cinematic'} */
    this.mode = 'director';
    /** @type {THREE.Object3D[]} focus cycle targets (characters) */
    this.focusTargets = [];
    this._focusIdx = 0;

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC' && !e.repeat && this.mode !== 'cinematic'
          && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        // cycle the user-facing modes; auto is included only when enabled
        const order = (settings.autoCamera && this.director)
          ? ['auto', 'thirdPerson', 'firstPerson', 'director']
          : ['thirdPerson', 'firstPerson', 'director'];
        const i = order.indexOf(this.mode);
        this.setMode(order[(i + 1) % order.length]);
      }
      if (e.code === 'KeyF' && this.mode === 'director' && this.focusTargets.length) {
        this._focusIdx = (this._focusIdx + 1) % this.focusTargets.length;
        const t = this.focusTargets[this._focusIdx];
        this.orbit.target.copy(t.position).add(new THREE.Vector3(0, 1.2, 0));
      }
    });
  }

  /** Attach the situational director once cast/combat/playerMarker exist. */
  attachDirector(deps) {
    this.director = new CameraDirector(deps);
    // honour the saved / default mode now that auto is available
    // Honour every saved mode. 'thirdPerson' used to fall through to auto, so
    // the mode most players would pick could not be persisted at all.
    const saved = settings.cameraMode;
    const valid = ['firstPerson', 'thirdPerson', 'director'];
    this.setMode(valid.includes(saved) ? saved
      : (settings.autoCamera && this.director ? 'auto' : 'thirdPerson'));
  }

  /** @param {'auto'|'director'|'thirdPerson'|'firstPerson'|'cinematic'} mode */
  setMode(mode) {
    this.mode = mode;
    this.orbit.enabled = mode === 'director';
    this.fp.thirdPerson = mode === 'thirdPerson';
    // 'auto' keeps the controller alive for MOVEMENT but hands framing to the
    // situational director. It used to disable the controller outright, which
    // made the default mode a spectator mode: WASD inert, orbit off, and no
    // on-screen clue that C was the way out of it.
    this.fp.driveCamera = mode === 'firstPerson' || mode === 'thirdPerson';
    if (this.fp.driveCamera || mode === 'auto') {
      // start the controller at the body so entering FP/TPS never teleports
      if (this.fp.body) { const b = this.fp.body.root.position; this.fp.pos.set(b.x, this.fp.pos.y, b.z); }
      this.fp.enable();
    } else this.fp.disable();
    // the player body is visible in every mode except first person
    if (this.fp.body) this.fp.body.root.visible = mode !== 'firstPerson';
    if (mode === 'director') this.orbit.object.updateMatrixWorld();
    if (mode !== 'cinematic') setSetting('cameraMode', mode);
    emit('camera.mode', { mode });
  }

  /** @param {number} dt seconds */
  update(dt) {
    if (this.mode === 'director') this.orbit.update();
    else if (this.mode === 'firstPerson' || this.mode === 'thirdPerson') this.fp.update(dt);
    else if (this.mode === 'auto') {
      this.fp.update(dt);            // movement + body animation
      this.director?.tick(dt);       // …and the director frames it
    }
  }
}
