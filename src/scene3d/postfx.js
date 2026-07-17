// @ts-check
// Post-processing: bloom for the neon, film grain + vignette for the noir.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GrainVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    grainAmount: { value: 0.045 },
    vignetteStrength: { value: 0.42 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float grainAmount;
    uniform float vignetteStrength;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7)) + time * 43.7) * 43758.5453);
    }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float g = (hash(vUv * vec2(1920.0, 1080.0)) - 0.5) * grainAmount;
      col.rgb += g;
      vec2 d = vUv - 0.5;
      col.rgb *= 1.0 - vignetteStrength * dot(d, d) * 2.2;
      gl_FragColor = col;
    }`,
};

export class PostFX {
  /** @param {import('./stage.js').Stage} stage */
  constructor(stage) {
    this.stage = stage;
    const { renderer, scene, camera } = stage;
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.55,   // strength
      0.42,   // radius
      0.86    // threshold — only emissives > 1 and hot lights bloom
    );
    this.grain = new ShaderPass(GrainVignetteShader);
    this.output = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grain);
    this.composer.addPass(this.output);

    stage.resizeHooks.push((w, h) => this.composer.setSize(w, h));
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  /** Point the composer at a different camera (camera-rig mode switches). */
  setCamera(camera) {
    this.renderPass.camera = camera;
  }

  /** @param {number} dtMs */
  render(dtMs) {
    this.grain.uniforms.time.value = (this.grain.uniforms.time.value + dtMs * 0.001) % 1000;
    this.composer.render();
  }
}
