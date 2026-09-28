// @ts-check
// The exterior towers' lit-window texture. The canvas version is the fallback
// for assets/city/windows.jpg and the first frame before that image decodes.
// Seeded, so every run and every screenshot shows the same skyline windows.
import * as THREE from 'three';
import { keepPatchOnClone } from './patchClone.js';
import { hashStr, mulberry32 } from '../../core/rng.js';

export function cityWindowsTexture() {
  const rand = mulberry32(hashStr('city-windows'));
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  ctx.fillStyle = '#04050a';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      if (rand() < 0.42) {
        ctx.fillStyle = rand() < 0.16 ? '#ff6fc0' : (rand() < 0.5 ? '#6eefff' : '#ffd9a0');
        ctx.globalAlpha = 0.35 + rand() * 0.65;
        ctx.fillRect(x, y, 4, 3);
      }
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Every tower is one instance of one box, so without this they all read the
 * window texture at the same place and the skyline repeats itself. Each
 * instance carries its own offset (InstancedBufferAttribute `aWinOffset`,
 * see src/scene3d/envMath.js windowOffsets) added to the emissive map UV.
 * @template {THREE.MeshStandardMaterial} M
 * @param {M} material
 * @returns {M}
 */
export function patchWindowOffsets(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWinOffset;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_EMISSIVEMAP\n\tvEmissiveMapUv += aWinOffset;\n#endif');
  };
  // the patch changes the program, so it needs its own cache key
  material.customProgramCacheKey = () => 'city-window-offsets';
  return keepPatchOnClone(material, patchWindowOffsets);
}

/**
 * The exterior towers: dark lit bodies that catch the HDRI in reflections, with
 * the windows as EMISSION (they are light sources, not a painted texture).
 * @param {THREE.Texture} emissiveMap
 */
export function cityTowerMaterial(emissiveMap) {
  // offsets reach past 1, so the texture must wrap rather than smear its edge
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  return patchWindowOffsets(new THREE.MeshStandardMaterial({
    color: 0x07080d, roughness: 0.55, metalness: 0.35,
    emissive: 0xffffff, emissiveMap, emissiveIntensity: 1.25,
  }));
}
