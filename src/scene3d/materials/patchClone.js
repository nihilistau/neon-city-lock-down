// @ts-check
// Material.clone() is `new this.constructor().copy(this)`, and copy() carries
// neither an instance onBeforeCompile nor customProgramCacheKey. Interactive
// props and the picker's hover glow clone their materials, so a patched
// material's clone came back silently unpatched — userData still claiming the
// patch. Every onBeforeCompile patch installs this so a clone re-applies it.
import * as THREE from 'three';

/**
 * @template {THREE.Material} M
 * @param {M} material the patched material
 * @param {(clone: M) => M} reapply applies the same patch (and installs this again)
 * @returns {M}
 */
export function keepPatchOnClone(material, reapply) {
  const protoClone = Object.getPrototypeOf(material).clone;
  material.clone = function clonePatched() {
    return reapply(/** @type {M} */ (protoClone.call(this)));
  };
  return material;
}
