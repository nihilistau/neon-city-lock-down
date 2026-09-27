// @ts-check
// The exterior HDRI dome's material. The equirect is a photograph in absolute
// radiance (shanghai_bund averages ~0.8, its street lamps ~20000), roughly ten
// times what a night sky should read at the game's exposure — shown raw it is
// a white-out behind the towers, and bloom turns every lamp into a flare. So
// the dome scales the panorama down and soft-caps each texel's brightest channel
// (keeping the city's hue, not its lamp cores) AFTER the preset's grade
// (material.color = Lighting.skyColor) multiplies in.
import * as THREE from 'three';
import { cfg } from '../../core/config.js';
import { HDRI_KNEE, SOFT_KNEE_GLSL } from '../envMath.js';

/** Linear gain on the raw HDRI for the visible dome (render.hdri.domeGain overrides). */
export const DOME_GAIN = 0.1;
/** Soft cap (envMath softKnee, knee HDRI_KNEE) on a texel's max channel after the gain. */
export const DOME_CAP = 3.0;
/**
 * The strip of the panorama the dome shows, as [start, span] in u. The HDRI
 * was shot on the Bund promenade: across the river (u ≈ 0.33..0.81) is the
 * Pudong skyline — exactly the far city a 45th-floor window should see — but
 * the other half is colonial facades and trees a few metres away, which from
 * the rooftop loomed over the helipad like a hotel garden. The dome folds this
 * strip back and forth around the full circle (a mirror, so u = 0 and u = 1
 * meet at the same texel: no seam).
 */
export const DOME_STRIP = /** @type {const} */ ([0.33, 0.48]);

/**
 * @param {THREE.Texture} equirect
 * @returns {THREE.MeshBasicMaterial}
 */
export function skyDomeMaterial(equirect) {
  const mat = new THREE.MeshBasicMaterial({ map: equirect, side: THREE.BackSide, fog: false, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.domeGain = { value: cfg('render.hdri.domeGain', DOME_GAIN) };
    shader.uniforms.domeCap = { value: DOME_CAP };
    shader.uniforms.domeStrip = { value: new THREE.Vector2(DOME_STRIP[0], DOME_STRIP[1]) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float domeGain;\nuniform float domeCap;\nuniform vec2 domeStrip;\n${SOFT_KNEE_GLSL}`)
      .replace('#include <map_fragment>', [
        '#ifdef USE_MAP',
        '\tvec2 domeUv = vec2(domeStrip.x + domeStrip.y * (1.0 - abs(2.0 * fract(vMapUv.x) - 1.0)), vMapUv.y);',
        '\tdiffuseColor *= texture2D(map, domeUv);',
        '\tdiffuseColor.rgb *= domeGain;',
        `\tdiffuseColor.rgb = softKneeClamp(diffuseColor.rgb, ${HDRI_KNEE.toFixed(2)}, domeCap);`,
        // Below the panorama's horizon is the promenade — paving and passers-by,
        // nothing a 45th-floor window sees. Fade it into the dark haze instead.
        '\tdiffuseColor.rgb *= mix(0.06, 1.0, smoothstep(0.47, 0.5, vMapUv.y));',
        '#endif',
      ].join('\n'));
  };
  mat.customProgramCacheKey = () => 'sky-dome';
  return mat;
}
