// @ts-check
// Find the RELATIVE module specifiers in an ES module's source. Used by
// tools/vendor-three.mjs to vendor an addon's dependencies transitively, and by
// test/unit/vendored.test.mjs to prove nothing vendored imports a file that is
// not on disk — an addon that resolves in Node through the shim but 404s in the
// browser is exactly the failure this guards.
//
// A regex, not a parser: three's examples are plain, well-formed ESM, and a
// false positive (an import-looking string in a comment) only makes the check
// stricter, never looser.
import { posix } from 'node:path';

const STATIC = /\b(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?['"](\.{1,2}\/[^'"\n]+)['"]/g;
const DYNAMIC = /\bimport\(\s*['"](\.{1,2}\/[^'"\n]+)['"]\s*\)/g;

/** @param {string} src @returns {string[]} sorted, deduped */
export function relativeImports(src) {
  const out = new Set();
  for (const m of src.matchAll(STATIC)) out.add(m[1]);
  for (const m of src.matchAll(DYNAMIC)) out.add(m[1]);
  return [...out].sort();
}

/**
 * @param {string} fromFile posix path of the importing file, relative to the addons root
 * @param {string} spec a relative specifier found in it
 */
export function resolveRelative(fromFile, spec) {
  return posix.normalize(posix.join(posix.dirname(fromFile), spec));
}

/** An ES module (worth a Node re-export shim), as opposed to UMD/emscripten glue. */
export function isEsModuleSource(src) {
  return /^\s*(?:export|import)[\s{*]/m.test(src);
}
