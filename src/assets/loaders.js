// @ts-check
// Browser-side loaders for src/assets/assets.js. Kept out of the facade so the
// facade stays importable under `node --test`, and imported lazily so a boot
// that never loads an asset (?noassets=1) never fetches GLTFLoader and friends.
import * as THREE from 'three';

/** Where DRACOLoader fetches its wasm decoder (vendored by tools/vendor-three.mjs). */
const DRACO_PATH = './vendor/three/addons/libs/draco/gltf/';

/**
 * @param {THREE.WebGLRenderer} renderer
 * @returns {Promise<import('./assets.js').AssetLoaders>}
 */
export async function browserLoaders(renderer) {
  const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }, { HDRLoader }, { LUTCubeLoader }, { clone }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/DRACOLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
    import('three/addons/loaders/HDRLoader.js'),
    import('three/addons/loaders/LUTCubeLoader.js'),
    import('three/addons/utils/SkeletonUtils.js'),
  ]);
  const textures = new THREE.TextureLoader();
  // Draco + meshopt are wired now so sub-project 3's compressed character
  // GLBs load through the same facade; the v0.7 Kenney props need neither.
  const gltf = new GLTFLoader()
    .setDRACOLoader(new DRACOLoader().setDecoderPath(DRACO_PATH))
    .setMeshoptDecoder(MeshoptDecoder);
  const hdr = new HDRLoader();   // HalfFloat by default — linear HDR, the right input for PMREM
  const lut = new LUTCubeLoader();
  /** @type {THREE.PMREMGenerator|null} */
  let pmrem = null;
  return {
    texture: (url) => textures.loadAsync(url),
    hdr: (url) => hdr.loadAsync(url),
    gltf: (url) => gltf.loadAsync(url),
    lut: (url) => lut.loadAsync(url),
    pmrem: (equirect) => {
      pmrem ??= new THREE.PMREMGenerator(renderer);
      return pmrem.fromEquirectangular(equirect).texture;
    },
    // skeleton-aware: a plain .clone(true) shares bones between copies of a rig
    clone: (scene) => clone(scene),
  };
}
