// @ts-check
// Choosing models out of a Kenney pack, and finding the files each one needs.
// Kenney zips ship every model in several formats and variants; the manifest
// names what it wants by substring (`{ as: 'books', match: 'books' }`) so a
// pack re-release that renames `plantSmall1` to `plant-small-1` changes one
// match string, never the game data that refers to `kenney_furniture/books`.
import { posix } from 'node:path';

const MODEL = /\.(glb|gltf)$/i;

/**
 * @param {string[]} names every path in the zip
 * @param {string} match case-insensitive substring of the model's base name
 * @returns {string|null} .glb over .gltf, then the shortest base name (the plain
 *   variant over "-large"/"-corner"), then alphabetical — deterministic for a given zip
 */
export function pickModel(names, match) {
  const want = match.toLowerCase();
  const base = (n) => posix.basename(n).replace(MODEL, '').toLowerCase();
  const hits = names.filter((n) => MODEL.test(n) && base(n).includes(want));
  hits.sort((a, b) => (Number(/\.gltf$/i.test(a)) - Number(/\.gltf$/i.test(b)))
    || (base(a).length - base(b).length)
    || (a < b ? -1 : a > b ? 1 : 0));
  return hits[0] ?? null;
}

/** @param {Buffer} buf @param {string} ext '.glb' | '.gltf' */
export function gltfJson(buf, ext) {
  if (ext.toLowerCase() === '.gltf') return JSON.parse(buf.toString('utf8'));
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const len = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('GLB: the first chunk is not JSON');
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

/**
 * Relative URIs a model loads at runtime (external .bin buffers, texture images).
 * @param {Buffer} buf @param {string} ext @returns {string[]}
 */
export function externalUris(buf, ext) {
  const j = gltfJson(buf, ext);
  const uris = [...(j.buffers ?? []), ...(j.images ?? [])]
    .map((x) => x.uri)
    .filter((u) => typeof u === 'string' && !u.startsWith('data:'))
    .map((u) => decodeURIComponent(u));
  return [...new Set(uris)];
}
