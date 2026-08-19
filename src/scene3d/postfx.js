// @ts-check
// Post-processing: bloom for the neon, film grain + vignette for the noir.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** MSAA sample count for the composer target. 4 is the sweet spot on WebGL2. */
const MSAA_SAMPLES = 4;

// Runs AFTER OutputPass, i.e. on tone-mapped display-referred colour. It used to
// run before it, adding a flat +/-0.0225 to *linear HDR*: in shadow regions
// (linear ~0.01) the grain buried the image, and in highlights it was invisible.
const GrainVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    seed: { value: 0 },
    resolution: { value: new THREE.Vector2(1920, 1080) },
    grainAmount: { value: 0.055 },
    grainShadowBias: { value: 0.65 },   // film grains more in the mids/darks
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
    uniform float seed;
    uniform vec2 resolution;
    uniform float grainAmount;
    uniform float grainShadowBias;
    uniform float vignetteStrength;
    varying vec2 vUv;

    // All-fract arithmetic, so it keeps its precision. The old
    // sin(dot(p,..) + time*43.7) hash degenerated into visible banding once the
    // time accumulator grew: it ran up to 1000, and at those magnitudes fp32 has
    // no mantissa left for the fractional part the hash depends on.
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float n = hash(vUv * resolution + seed) - 0.5;
      // scale grain by (1 - luma) so highlights stay clean, like real film
      float luma = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      col.rgb += n * grainAmount * mix(1.0, 1.0 - luma, grainShadowBias);
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

    // MSAA. `antialias: true` on the renderer is INERT once everything goes
    // through EffectComposer, because the composer renders into its own target —
    // and its default target is created with no `samples`. Every neon edge in
    // the game was aliased. Supplying the target explicitly is the whole fix.
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.width, size.height, {
      type: THREE.HalfFloatType,
      samples: MSAA_SAMPLES,
    });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    // Threshold is in LINEAR HDR (bloom runs before OutputPass tone-maps), so
    // 0.86 is a LOW bar — an ordinary lit surface clears it easily. Once the
    // materials became physically better (IBL, real speculars, strand hair), the
    // cast's own highlights crossed it and bloomed into blazing blobs on every
    // head. 1.55 sits above lit skin/hair and below the neon core (2.4), so only
    // things that are actually emissive glow.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.42,   // strength
      0.40,   // radius
      1.55    // threshold — above lit surfaces, below the neon core
    );
    this.grain = new ShaderPass(GrainVignetteShader);
    this.output = new OutputPass();

    // Grain LAST: OutputPass applies ACES tone-mapping + sRGB, so anything after
    // it works in display-referred colour, which is where film grain belongs.
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.grain);

    const applySize = (w, h) => {
      this.composer.setSize(w, h);
      this.grain.uniforms.resolution.value.set(w, h);
    };
    stage.resizeHooks.push(applySize);
    applySize(window.innerWidth, window.innerHeight);
  }

  /** @param {number} dtMs */
  render(dtMs) {
    // bounded, drift-free animation seed — never grows into fp32's dead zone
    this._t = ((this._t || 0) + dtMs * 0.06) % 1024;
    this.grain.uniforms.seed.value = this._t;
    this.composer.render();
  }
}
