// @ts-check
// Image-based lighting.
//
// The project had NO environment map anywhere, which is the single biggest
// reason its surfaces read as plastic: MeshPhysicalMaterial's sheen (skin),
// clearcoat + anisotropy (hair) and every metalness>0 surface (bar, weapons,
// fixtures) are *reflection* lobes. With nothing to reflect they contribute
// almost nothing, so shiny things looked matte and metal looked like grey paint.
//
// Two sources, one output. With the asset pipeline, the sky is the
// `shanghai_bund` HDRI — a real night city — tinted per lighting preset;
// without it (?noassets=1, a missing file), a generated gradient sky with a
// city-glow band. Either way a few dim neon sign cards and a warm floor bounce
// are composited in as local accents, and the lot is PMREM-prefiltered once per
// preset, so a preset change retints what chrome, glass, skin and hair reflect.
import * as THREE from 'three';

/**
 * Brightness of the horizon neon cards, relative to their pure hue.
 * Deliberately low — see the comment at the card build below. Raising this back
 * toward 1 reintroduces blown, flashing specular highlights on eyes and hair.
 */
const SIGN_GAIN = 0.3;

/**
 * The HDRI is a photograph in absolute radiance: shanghai_bund averages ~0.8
 * over the sphere, with street lamps near 20000. The procedural sky the ten
 * presets were balanced against averages well under 0.1. Taken raw, it lifted
 * every face to chalk-white and put a pin-sharp lamp in every eye, so the
 * capture scales it down to the old sky's level (the preset's skyExposure
 * grades on top of this) and caps each texel's brightest channel, keeping the
 * city's hue but not its lamp cores.
 */
const HDRI_GAIN = 0.14;
const HDRI_CLAMP = 2.5;

/** The HDRI dome for the capture: graded, and lamp cores capped (see HDRI_CLAMP). */
const HdriShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    uniform vec3 grade;
    uniform float cap;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(map, vUv).rgb * grade;
      float peak = max(max(c.r, c.g), max(c.b, 1e-6));
      gl_FragColor = vec4(c * min(1.0, cap / peak), 1.0);
    }`,
};

/** Vertical gradient sky: ground bounce -> horizon city glow -> night sky. */
const SkyShader = {
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 skyColor;
    uniform vec3 horizonColor;
    uniform vec3 groundColor;
    uniform float horizonTightness;
    uniform float intensity;
    varying vec3 vDir;
    void main() {
      float h = normalize(vDir).y;
      // tight, bright band at the horizon = a burning city seen from 45 floors up
      float glow = pow(1.0 - min(abs(h), 1.0), horizonTightness);
      vec3 base = h > 0.0 ? mix(horizonColor, skyColor, pow(h, 0.55))
                          : mix(horizonColor, groundColor, pow(-h, 0.5));
      gl_FragColor = vec4((base + horizonColor * glow * 0.6) * intensity, 1.0);
    }`,
};

/**
 * Builds and caches prefiltered environment maps, one per lighting preset.
 * A preset changing the room's mood should also change what its chrome reflects.
 */
export class EnvBuilder {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileCubemapShader();
    /**
     * The render target, not just its texture: disposing only the texture leaves
     * the target's framebuffers alive on the GPU.
     * @type {Map<string, THREE.WebGLRenderTarget>}
     */
    this.cache = new Map();
    /** @type {THREE.Texture|null} equirect HDRI from the asset pipeline; null = procedural sky */
    this.hdri = null;
  }

  /**
   * Swap the sky source. Clears the cache: every preset's prefiltered map was
   * built from the old sky.
   * @param {THREE.Texture|null} equirect
   */
  setHDRI(equirect) {
    if (equirect === this.hdri) return;
    this.hdri = equirect;
    this._clear();
  }

  _clear() {
    for (const rt of this.cache.values()) rt.dispose();
    this.cache.clear();
  }

  /**
   * @param {string} key cache key (the lighting preset id)
   * @param {{sky?:number, horizon?:number, ground?:number, signs?:number[], intensity?:number, skyTint?:number, skyExposure?:number}} [opts]
   * @returns {THREE.Texture} a PMREM-prefiltered cube texture
   */
  get(key, opts = {}) {
    const hit = this.cache.get(key);
    if (hit) return hit.texture;

    const {
      sky = 0x05070f,
      horizon = 0x1b2a55,
      ground = 0x07060a,
      signs = [0x39e6ff, 0xff3fa4, 0xffb347],
      intensity = 1,
      skyTint = 0xffffff, skyExposure = 1,
    } = opts;

    const scene = new THREE.Scene();
    const disposables = [];

    const skyGeo = new THREE.SphereGeometry(60, 48, 24);
    disposables.push(skyGeo);
    if (this.hdri) {
      // The real night city, graded by the preset: a blackout darkens what the
      // chrome reflects as well as what the window shows.
      const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          map: { value: this.hdri },
          grade: { value: new THREE.Color(skyTint).multiplyScalar(skyExposure * HDRI_GAIN) },
          cap: { value: HDRI_CLAMP },
        },
        vertexShader: HdriShader.vertexShader,
        fragmentShader: HdriShader.fragmentShader,
      });
      const sky = new THREE.Mesh(skyGeo, skyMat);
      sky.scale.x = -1;   // seen from inside, a sphere mirrors the panorama; flip it back
      scene.add(sky);
      disposables.push(skyMat);
    } else {
      const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          skyColor: { value: new THREE.Color(sky) },
          horizonColor: { value: new THREE.Color(horizon) },
          groundColor: { value: new THREE.Color(ground) },
          horizonTightness: { value: 5.0 },
          intensity: { value: intensity },
        },
        vertexShader: SkyShader.vertexShader,
        fragmentShader: SkyShader.fragmentShader,
      });
      scene.add(new THREE.Mesh(skyGeo, skyMat));
      disposables.push(skyMat);
    }

    // Neon sign cards ringing the horizon. These are what show up as moving
    // highlights in eyes, hair, glassware and gun metal.
    //
    // They must stay DIM. At full saturation over this solid angle they stop
    // being highlights and become key lights: glossy surfaces (the eyeballs are
    // roughness ~0.15, hair carries clearcoat + anisotropy) reflected them as
    // blazing spots that swept across every head as it turned, and the bloom
    // pass — threshold 0.86 — amplified them into flashing lamps. A neon sign
    // seen from 45 floors up is a coloured smudge, not a studio strobe.
    const cardGeo = new THREE.PlaneGeometry(9, 3.2);
    disposables.push(cardGeo);
    const signTint = new THREE.Color();
    signs.forEach((color, i) => {
      signTint.set(color).multiplyScalar(SIGN_GAIN);
      const mat = new THREE.MeshBasicMaterial({ color: signTint.clone(), side: THREE.DoubleSide });
      disposables.push(mat);
      const card = new THREE.Mesh(cardGeo, mat);
      const a = (i / signs.length) * Math.PI * 2 + 0.6;
      card.position.set(Math.sin(a) * 34, -1.5 + i * 2.5, Math.cos(a) * 34);
      card.lookAt(0, card.position.y, 0);
      scene.add(card);
    });

    // Warm interior bounce from below — the penthouse's own lamps and fireplace,
    // so faces are not lit purely by cold city light.
    const bounceGeo = new THREE.PlaneGeometry(70, 70);
    const bounceMat = new THREE.MeshBasicMaterial({ color: 0x2a1a10, side: THREE.DoubleSide });
    const bounce = new THREE.Mesh(bounceGeo, bounceMat);
    bounce.rotation.x = -Math.PI / 2;
    bounce.position.y = -14;
    scene.add(bounce);
    disposables.push(bounceGeo, bounceMat);

    const target = this.pmrem.fromScene(scene, 0.04);
    for (const d of disposables) d.dispose();

    this.cache.set(key, target);
    return target.texture;
  }

  dispose() {
    this._clear();
    this.pmrem.dispose();
  }
}
