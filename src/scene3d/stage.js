// @ts-check
// Renderer + root scene + main camera + resize plumbing.
import * as THREE from 'three';
import { cfg } from '../core/config.js';

// _buildExterior runs twice (penthouse + rooftop) with its own TextureLoader
// each time, and three's loader cache is OFF by default — so the skyline and
// window textures were fetched, decoded and uploaded to the GPU twice.
THREE.Cache.enabled = true;

export class Stage {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // PCFShadowMap gives a 1-texel-hard edge that reads as a jagged stencil at
    // this shadow-map resolution. Soft PCF costs one extra tap group and is the
    // difference between "there is a shadow here" and "this object is standing
    // on this floor". Configurable because it is the first thing to turn down.
    const shadows = cfg('render.shadows', 'soft');
    this.renderer.shadowMap.enabled = shadows !== 'off';
    this.renderer.shadowMap.type = shadows === 'hard' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06070c);

    this.camera = new THREE.PerspectiveCamera(cfg('render.fov', 55), 1, 0.05, 400);
    this.camera.position.set(0, 1.6, 4);

    /** @type {Array<(w:number,h:number)=>void>} */
    this.resizeHooks = [];
    window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const fn of this.resizeHooks) fn(w, h);
  }
}
