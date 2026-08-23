// @ts-check
// Screen-space ambient occlusion, written for this scene rather than vendored.
//
// WHY IT MATTERS HERE
// Nothing in the game sat *in* the floor — only on it. A physically-based
// renderer with an IBL environment fills every crevice with uniform ambient
// light, so a chair leg met the concrete with no contact darkening at all and
// read as a decal. AO is the single largest quality-per-line change available to
// the render stack, and it is what makes a room feel built instead of arranged.
//
// WHY NOT three's SSAOPass/GTAOPass
// Both need a full second scene render into a normal buffer (SSAOPass) or MRT
// plumbing plus noise-texture generation (GTAOPass), and vendoring either drags
// in four more addon files. This pass needs neither: the composer's render
// target already carries a depth attachment, and view-space normals are
// recovered from depth derivatives. One extra full-screen pass, no extra
// geometry submission, no new dependency.
//
// THE APPROACH
// Reconstruct each pixel's view-space position from depth, build a normal from
// its screen-space derivatives, then sample a hemisphere of nearby points. A
// sample whose reconstructed depth is *closer* to the camera than the sample
// point occludes it. The range check keeps a distant silhouette from casting AO
// onto a foreground surface, which is what makes naive SSAO halo.
//
// Placed BEFORE bloom deliberately: AO darkens creases, and a crease that is
// still bright when bloom runs will smear its brightness back over the geometry
// the AO was meant to seat.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Sample kernel is generated once, in a hemisphere, weighted toward the centre. */
function makeKernel(count) {
  const k = [];
  // deterministic — a fixed kernel keeps AO stable frame to frame, and this file
  // must not consume the game's seeded RNG stream
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand());
    v.normalize();
    // cluster samples near the origin: close occluders matter far more than far ones
    const scale = 0.1 + 0.9 * ((i / count) ** 2);
    v.multiplyScalar(scale);
    k.push(v);
  }
  return k;
}

const AOShader = {
  name: 'DepthAOShader',
  defines: { KERNEL_SIZE: 12 },
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2(1920, 1080) },
    cameraNear: { value: 0.05 },
    cameraFar: { value: 400 },
    camProjection: { value: new THREE.Matrix4() },
    camProjectionInverse: { value: new THREE.Matrix4() },
    kernel: { value: [] },
    radius: { value: 0.45 },
    aoIntensity: { value: 0.9 },
    bias: { value: 0.025 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform highp sampler2D tDepth;
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    // NOT named projectionMatrix. WebGLRenderer.setProgram() writes the RENDERING
    // camera's projection into a uniform of that exact name for every material it
    // draws — and the renderer for a post pass is the fullscreen quad's
    // OrthographicCamera(-1,1,1,-1,0,1). Our carefully-set perspective matrix was
    // overwritten one line before the draw, so every sample reprojected through an
    // orthographic frustum and the occlusion term was noise. Same trap applies to
    // modelViewMatrix, modelMatrix, normalMatrix, viewMatrix and cameraPosition.
    uniform mat4 camProjection;
    uniform mat4 camProjectionInverse;
    uniform vec3 kernel[KERNEL_SIZE];
    uniform float radius;
    uniform float aoIntensity;
    uniform float bias;
    varying vec2 vUv;

    // Reconstruct VIEW-space position from the depth buffer. Note this is a
    // perspective projection, so the stored depth is non-linear — unprojecting
    // through the inverse projection matrix and dividing by w is the only way to
    // get this right. Linearising to a distance and scaling a ray is the common
    // shortcut and it skews everything off the optical axis.
    vec3 viewPos(vec2 uv, float depth) {
      vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 view = camProjectionInverse * ndc;
      return view.xyz / view.w;
    }

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float depth = texture2D(tDepth, vUv).x;

      // The far plane is sky/background. Occluding it produces a dark halo
      // around every silhouette, which is the classic SSAO tell.
      if (depth >= 1.0 - 1e-6) { gl_FragColor = col; return; }

      vec3 p = viewPos(vUv, depth);
      // Normal from screen-space derivatives of the reconstructed position. Free,
      // and exact on flat surfaces; it degrades only across depth discontinuities,
      // where the range check below already suppresses the result.
      vec3 n = normalize(cross(dFdx(p), dFdy(p)));

      // Per-pixel rotation of the kernel. Without it the fixed kernel prints its
      // own pattern into every surface as visible banding.
      float a = fract(sin(dot(vUv * resolution, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
      vec3 rv = vec3(cos(a), sin(a), 0.0);
      vec3 t = normalize(rv - n * dot(rv, n));
      mat3 tbn = mat3(t, cross(n, t), n);

      float occ = 0.0;
      for (int i = 0; i < KERNEL_SIZE; i++) {
        vec3 s = p + (tbn * kernel[i]) * radius;
        vec4 clip = camProjection * vec4(s, 1.0);
        vec3 sUv = clip.xyz / clip.w * 0.5 + 0.5;
        if (sUv.x < 0.0 || sUv.x > 1.0 || sUv.y < 0.0 || sUv.y > 1.0) continue;

        float sceneDepth = texture2D(tDepth, sUv.xy).x;
        float sceneZ = viewPos(sUv.xy, sceneDepth).z;
        // view space is right-handed with -Z forward, so a LARGER z is nearer
        if (sceneZ >= s.z + bias) {
          // Range check: an occluder much closer to the camera than the sample
          // belongs to a different surface and must not darken this one.
          occ += smoothstep(0.0, 1.0, radius / max(1e-4, abs(p.z - sceneZ)));
        }
      }
      float ao = 1.0 - (occ / float(KERNEL_SIZE)) * aoIntensity;
      gl_FragColor = vec4(col.rgb * clamp(ao, 0.0, 1.0), col.a);
    }`,
};

export class AOPass extends ShaderPass {
  /**
   * @param {THREE.Camera} camera
   * @param {{radius?:number, intensity?:number, bias?:number, samples?:number}} [opts]
   */
  constructor(camera, opts = {}) {
    const samples = Math.max(4, Math.min(32, Math.round(opts.samples ?? 12)));
    // KERNEL_SIZE is a #define, so the kernel length is fixed at compile time —
    // changing sample count needs a new pass, not a uniform write.
    const shader = { ...AOShader, defines: { KERNEL_SIZE: samples } };
    super(shader);
    this.camera = camera;
    this.uniforms.kernel.value = makeKernel(samples);
    this.uniforms.radius.value = opts.radius ?? 0.45;
    this.uniforms.aoIntensity.value = opts.intensity ?? 0.9;
    this.uniforms.bias.value = opts.bias ?? 0.025;
  }

  /**
   * Camera matrices change every frame (FOV, aspect); refresh before the draw.
   *
   * tDepth is bound from `readBuffer` HERE rather than once in the constructor,
   * and that is not a style choice. EffectComposer keeps two ping-pong targets:
   * `renderTarget1` is the one you hand it, and `renderTarget2` is a CLONE — with
   * its own DepthTexture instance. RenderPass draws into `readBuffer`, which
   * starts life as the clone, so a uniform wired to the target we constructed
   * sampled a depth attachment nothing had ever written. Measured: depth read as
   * 0 across 100% of the frame, every pixel resolved to the near plane, and the
   * AO term crushed mean scene luma from 17.8 to 1.5 — a black screen, not an
   * effect. Binding whatever buffer RenderPass actually filled is correct no
   * matter which way the ping-pong happens to be pointing.
   */
  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    const cam = /** @type {THREE.PerspectiveCamera} */ (this.camera);
    this.uniforms.cameraNear.value = cam.near;
    this.uniforms.cameraFar.value = cam.far;
    this.uniforms.camProjection.value.copy(cam.projectionMatrix);
    this.uniforms.camProjectionInverse.value.copy(cam.projectionMatrixInverse);
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }

  /** @param {number} w @param {number} h */
  setSize(w, h) { this.uniforms.resolution.value.set(w, h); }
}
