// @ts-check
// Crisper city reflections on glossy architecture, without touching skin.
//
// The obvious knob, `material.envMapIntensity`, does nothing here: when a
// material takes its environment from `scene.environment` (every material in
// this game), three overwrites that uniform with `scene.environmentIntensity`
// on every draw. That scene-wide value is deliberately low (a preset's
// ibl.envIntensity, ~0.4) because faces, hair and eyes read it too — at 1.0 the
// HDRI turned skin chalky. So the boost is a second factor on the SPECULAR IBL
// lobe only (getIBLRadiance): polished tile, marble, glass and metal mirror
// more of the city, while the diffuse IBL (getIBLIrradiance) — the part that
// greys a surface out — stays at the scene's level. Never apply it to skin,
// hair or cloth.
import * as THREE from 'three';

/** How much harder glossy architecture reflects than the scene's env intensity. */
export const GLOSSY_REFLECT = 2.5;

const RADIANCE = 'return envMapColor.rgb * envMapIntensity;';

/**
 * @template {THREE.MeshStandardMaterial} M
 * @param {M} material a fresh or library-owned material (never a shared one owned elsewhere)
 * @param {number} [boost]
 * @returns {M}
 */
export function patchReflectBoost(material, boost = GLOSSY_REFLECT) {
  material.userData.reflectBoost = boost;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.reflectBoost = { value: boost };
    const chunk = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(RADIANCE, 'return envMapColor.rgb * envMapIntensity * reflectBoost;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float reflectBoost;')
      .replace('#include <envmap_physical_pars_fragment>', chunk);
  };
  // the patch changes the program, so it needs its own cache key
  material.customProgramCacheKey = () => 'reflect-boost';
  return material;
}
