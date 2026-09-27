// @ts-check
// Minimal readers for the two archive formats the asset tools download: the npm
// tarball (gzip'd ustar, for tools/vendor-three.mjs) and Kenney's zip packs (for
// tools/fetch-assets.mjs). Node stdlib only — adding `tar` and `yauzl` as
// devDependencies for ~100 lines of header parsing is not a trade worth making.
import { gunzipSync, inflateRawSync } from 'node:zlib';

/**
 * Parse an uncompressed tar into path → contents. Regular files only;
 * directories, links and pax GLOBAL headers are skipped. Honours the ustar
 * `prefix` field and a pax `path=` record — the two ways a name longer than 100
 * bytes is stored.
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>}
 */
export function parseTar(buf) {
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  let off = 0;
  /** @type {string|null} */
  let paxPath = null;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;   // the zero block that ends the archive
    const field = (at, len) => {
      const raw = header.subarray(at, at + len);
      const nul = raw.indexOf(0);
      return raw.subarray(0, nul === -1 ? len : nul).toString('utf8');
    };
    const size = parseInt(field(124, 12).trim() || '0', 8);
    // an old-style regular file has a NUL type byte
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    let name = field(0, 100);
    if (field(257, 5) === 'ustar') {
      const prefix = field(345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    const body = buf.subarray(off + 512, off + 512 + size);
    if (type === 'x') {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      paxPath = m ? m[1] : null;
    } else if (type === '0') {
      files.set(paxPath ?? name, Buffer.from(body));
      paxPath = null;
    } else if (type !== 'g') {
      paxPath = null;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** @param {Buffer} tgz */
export function parseTgz(tgz) {
  return parseTar(gunzipSync(tgz));
}

/**
 * Read a (non-zip64) zip archive. Entries are listed from the central directory
 * — the local headers can carry zero sizes when the archiver streamed them —
 * and only file entries are returned (names ending in `/` are directories).
 * @param {Buffer} buf
 */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  /** @type {{name:string, method:number, compSize:number, size:number, local:number}[]} */
  const all = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    all.push({ name, method, compSize, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const byName = new Map(all.map((e) => [e.name, e]));
  return {
    entries: all.filter((e) => !e.name.endsWith('/')),
    /** @param {string} name */
    read(name) {
      const e = byName.get(name);
      if (!e) throw new Error(`zip has no ${name}`);
      const n = buf.readUInt16LE(e.local + 26);
      const x = buf.readUInt16LE(e.local + 28);
      const start = e.local + 30 + n + x;
      const data = buf.subarray(start, start + e.compSize);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return inflateRawSync(data);
      throw new Error(`${name}: unsupported zip compression method ${e.method}`);
    },
  };
}
