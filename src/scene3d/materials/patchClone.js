// @ts-check
// Material.clone() is `new this.constructor().copy(this)`, and copy() carries
// neither an instance onBeforeCompile nor customProgramCacheKey. Interactive
// props and the picker's hover glow clone their materials, so a patched
// material's clone came back silently unpatched — userData still claiming the
// patch. Every onBeforeCompile patch installs this so a clone re-applies it.
//
// Patches stack (rain on glass goes on top of the reflection boost), so this
// wraps the material's CURRENT clone — the earlier patch's, if there is one —
// not the prototype's: the clone re-runs every patch, innermost first.
//
// Order matters when stacking: a patch that REPLACES material.onBeforeCompile
// outright (e.g. patchReflectBoost) must be applied BEFORE any patch that
// CHAINS it — calls the previous onBeforeCompile and appends its own shader
// code (e.g. applyRainOnGlass). Apply the replace-type patch first, then wrap
// it with chaining patches; if a chaining patch installs its wrapper first,
// a later replace-type patch clobbers it and silently drops that layer.

/**
 * @template {import('three').Material} M
 * @param {M} material the patched material
 * @param {(clone: M) => M} reapply applies the same patch (and installs this again)
 * @returns {M}
 */
export function keepPatchOnClone(material, reapply) {
  const innerClone = material.clone;
  material.clone = function clonePatched() {
    return reapply(/** @type {M} */ (innerClone.call(this)));
  };
  return material;
}
