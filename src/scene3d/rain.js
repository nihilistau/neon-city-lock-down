// @ts-check
// Rain as instanced, velocity-aligned streaks. Replaces 500 THREE.Points that
// the CPU moved every frame (a JS loop over every drop, then a full attribute
// re-upload) and that rendered as square dots at any distance. Now: one
// instanced draw, positions wrapped inside the volume by the vertex shader from
// a single time uniform — zero per-frame CPU work — and each drop is a thin
// quad stretched along its fall direction and turned to face the camera, so
// rain reads as rain.
import * as THREE from 'three';
import { rainLayout, rainCount, RAIN_MAX } from './envMath.js';

const VERT = /* glsl */ `
  attribute vec3 offset;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uLength;
  uniform float uWidth;
  uniform vec3 uWind;
  uniform vec3 uVolMin;
  uniform vec3 uVolSize;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    // fall and drift, wrapped inside the volume
    vec3 p = uVolMin + mod(offset - uVolMin + vec3(uWind.x, -uSpeed, uWind.z) * uTime, uVolSize);
    vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
    vec3 vel = normalize(vec3(uWind.x, -uSpeed, uWind.z));
    vec3 toCam = normalize(cameraPosition - wp);
    // long along the velocity, thin across it, facing the camera
    vec3 side = normalize(cross(vel, toCam));
    wp += side * position.x * uWidth + vel * position.y * uLength;
    vUv = uv;
    float d = distance(cameraPosition, wp);
    // a streak inside arm's reach is a smear across the lens, not rain; far ones thin into the fog
    vFade = smoothstep(0.6, 2.5, d) * (1.0 - smoothstep(25.0, 45.0, d));
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;   // soft edges
    float along = smoothstep(0.0, 0.35, vUv.y);    // tapered tail
    gl_FragColor = vec4(uColor, uOpacity * across * along * vFade);
  }`;

/** Time wraps hourly: fp32 keeps millimetre precision well past that, and a once-an-hour jump is invisible in a storm. */
export const TIME_WRAP = 3600;

export class RainStreaks {
  /**
   * @param {{x:[number,number], y:[number,number], z:[number,number]}} vol floor-local volume
   * @param {{next: () => number}} rng
   * @param {{density?: number}} [o]
   */
  constructor(vol, rng, { density = 1 } = {}) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(quad.getIndex());
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(rainLayout(RAIN_MAX, vol, rng), 3));
    const min = new THREE.Vector3(vol.x[0], vol.y[0], vol.z[0]);
    const size = new THREE.Vector3(vol.x[1] - vol.x[0], vol.y[1] - vol.y[0], vol.z[1] - vol.z[0]);
    // the shader wraps every drop inside the volume, so the volume IS the bound
    geo.boundingBox = new THREE.Box3(min.clone(), min.clone().add(size));
    geo.boundingSphere = new THREE.Sphere(min.clone().addScaledVector(size, 0.5), size.length() / 2 + 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: 9 },            // m/s — heavy rain
        uLength: { value: 0.55 },
        uWidth: { value: 0.012 },
        uWind: { value: new THREE.Vector3(0.6, 0, 0.25) },
        uVolMin: { value: min },
        uVolSize: { value: size },
        uColor: { value: new THREE.Color(0x8ab8d0) },
        uOpacity: { value: 0.35 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'rain';
    this.setDensity(density);
  }

  /** @param {number} density the quality preset's rain density (0 = dry) */
  setDensity(density) {
    const n = rainCount(density);
    /** @type {THREE.InstancedBufferGeometry} */ (this.mesh.geometry).instanceCount = n;
    this.mesh.visible = n > 0;
  }

  /** @param {number} t seconds */
  update(t) {
    this.material.uniforms.uTime.value = t % TIME_WRAP;
  }
}
