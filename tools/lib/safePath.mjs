// @ts-check
// Guard against a vendored/extracted path escaping its destination root.
// tools/vendor-three.mjs (and tools/fetch-assets.mjs, per the same threat)
// build filesystem paths from strings that ultimately come from a downloaded
// archive: an addon's relative import specifier, or a tar/zip entry name. A
// crafted '../../etc/passwd', an absolute '/etc/passwd', or a Windows drive
// path ('C:\Windows\...') must never reach `join(OUT, rel)` — this is the one
// place that check lives, so every caller gets it for free.
import { isAbsolute, posix } from 'node:path';

const DRIVE = /^[A-Za-z]:[\\/]?/;

/**
 * @param {string} rel a path meant to be relative to some fixed root
 * @returns {string} `rel`, normalized to posix separators, if it is safe
 * @throws {Error} if `rel` is absolute, a drive path, or escapes the root
 *   via a '..' segment anywhere in it
 */
export function safeRelative(rel) {
  if (isAbsolute(rel) || rel.startsWith('/') || rel.startsWith('\\') || DRIVE.test(rel)) {
    throw new Error(`unsafe path (absolute): ${rel}`);
  }
  const normalized = posix.normalize(rel.split('\\').join('/'));
  if (normalized === '..' || normalized.split('/').includes('..')) {
    throw new Error(`unsafe path (escapes root): ${rel}`);
  }
  return normalized;
}
