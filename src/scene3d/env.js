// @ts-check
// Procedural image-based lighting.
//
// The project had NO environment map anywhere, which is the single biggest
// reason its surfaces read as plastic: MeshPhysicalMaterial's sheen (skin),
// clearcoat + anisotropy (hair) and every metalness>0 surface (bar, weapons,
// fixtures) are *reflection* lobes. With nothing to reflect they contribute
// almost nothing, so shiny things looked matte and metal looked like grey paint.
//
// Everything here is generated at runtime — a gradient sky, a city-glow band,
// and a few neon sign cards rendered into a cube target and PMREM-prefiltered.
// No binary assets, in keeping with the project's zero-asset rule.
import * as THREE from 'three';

/**
 * Brightness of the horizon neon cards, relative to their pure hue.
 * Deliberately low — see the comment at the card build below. Raising this back
 * toward 1 reintroduces blown, flashing specular highlights on eyes and hair.
 */
const SIGN_GAIN = 0.3;

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
    /** @type {Map<string, THREE.Texture>} */
    this.cache = new Map();
  }

  /**
   * @param {string} key cache key (the lighting preset id)
   * @param {{sky?:number, horizon?:number, ground?:number, signs?:number[], intensity?:number}} [opts]
   * @returns {THREE.Texture} a PMREM-prefiltered cube texture
   */
  get(key, opts = {}) {
    const hit = this.cache.get(key);
    if (hit) return hit;

    const {
      sky = 0x05070f,
      horizon = 0x1b2a55,
      ground = 0x07060a,
      signs = [0x39e6ff, 0xff3fa4, 0xffb347],
      intensity = 1,
    } = opts;

    const scene = new THREE.Scene();
    const disposables = [];

    const skyGeo = new THREE.SphereGeometry(60, 24, 16);
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
    disposables.push(skyGeo, skyMat);

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

    this.cache.set(key, target.texture);
    return target.texture;
  }

  dispose() {
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
    this.pmrem.dispose();
  }
}
