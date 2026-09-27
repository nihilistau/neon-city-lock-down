// @ts-check
// tools/lib/archive.mjs + tools/lib/importScan.mjs — the two parsers the asset
// tools stand on. A tar entry read at the wrong offset or a zip entry inflated
// with the wrong method does not crash: it silently writes a corrupt addon or
// texture into vendor/ or assets/, which is why these are tested against
// archives built byte by byte here rather than trusted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, deflateRawSync } from 'node:zlib';
import { parseTar, parseTgz, readZip } from '../../tools/lib/archive.mjs';
import { relativeImports, resolveRelative, isEsModuleSource } from '../../tools/lib/importScan.mjs';

/** one ustar header block; the checksum field is left blank (the parser does not verify it) */
function tarHeader(name, size, { type = '0', prefix = '' } = {}) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  if (prefix) h.write(prefix, 345, 155, 'utf8');
  return h;
}
function tarEntry(name, content, opts) {
  const body = Buffer.from(content);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([tarHeader(name, body.length, opts), body, pad]);
}
const TAR_END = Buffer.alloc(1024);

/** a minimal zip: local headers, a central directory, an end record */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const payload = e.method === 8 ? deflateRawSync(e.data) : e.data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(e.method, 8);
    lh.writeUInt32LE(payload.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(e.method, 10);
    ch.writeUInt32LE(payload.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, payload);
    centrals.push(ch, name);
    offset += 30 + name.length + payload.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test('tar: regular files come back by name, directories are skipped', () => {
  const tar = Buffer.concat([
    tarEntry('package/', '', { type: '5' }),
    tarEntry('package/a.js', 'export const a = 1;\n'),
    tarEntry('package/b.txt', 'x'.repeat(700)),   // spans two blocks
    TAR_END,
  ]);
  const files = parseTar(tar);
  assert.deepEqual([...files.keys()].sort(), ['package/a.js', 'package/b.txt']);
  assert.equal(files.get('package/a.js').toString(), 'export const a = 1;\n');
  assert.equal(files.get('package/b.txt').length, 700);
});

test('tar: the ustar prefix field and a pax path both lengthen a name', () => {
  const pax = '30 path=package/very/long/x.js\n';
  const tar = Buffer.concat([
    tarEntry('y.js', 'Y', { prefix: 'package/deep' }),
    tarEntry('PaxHeader', pax, { type: 'x' }),
    tarEntry('truncated-name.js', 'X'),
    tarEntry('after.js', 'A'),
    TAR_END,
  ]);
  const files = parseTar(tar);
  assert.equal(files.get('package/deep/y.js').toString(), 'Y');
  assert.equal(files.get('package/very/long/x.js').toString(), 'X', 'pax path overrides the header name');
  assert.equal(files.get('after.js').toString(), 'A', 'and applies to ONE entry only');
});

test('tgz: gunzip then tar', () => {
  const tgz = gzipSync(Buffer.concat([tarEntry('package/package.json', '{"version":"0.185.0"}'), TAR_END]));
  assert.equal(JSON.parse(parseTgz(tgz).get('package/package.json').toString()).version, '0.185.0');
});

test('zip: stored and deflated entries both read back byte-exact', () => {
  const glb = Buffer.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
  const text = Buffer.from('colormap '.repeat(200));
  const z = readZip(zip([
    { name: 'Models/', data: Buffer.alloc(0), method: 0 },
    { name: 'Models/GLB format/books.glb', data: glb, method: 0 },
    { name: 'Models/GLB format/Textures/colormap.txt', data: text, method: 8 },
  ]));
  assert.deepEqual(z.entries.map((e) => e.name), ['Models/GLB format/books.glb', 'Models/GLB format/Textures/colormap.txt']);
  assert.deepEqual(z.read('Models/GLB format/books.glb'), glb);
  assert.deepEqual(z.read('Models/GLB format/Textures/colormap.txt'), text);
  assert.throws(() => z.read('nope.glb'), /no nope\.glb/);
});

test('zip: a buffer with no end record is rejected, not half-read', () => {
  assert.throws(() => readZip(Buffer.from('definitely not a zip file at all, just text')), /not a zip/);
});

test('relativeImports finds static, re-export, side-effect and dynamic relative specifiers only', () => {
  const src = `
    import * as THREE from 'three';
    import { Pass, FullScreenQuad } from './Pass.js';
    import {
      mergeGeometries,
      toTrianglesDrawMode,
    } from '../utils/BufferGeometryUtils.js';
    export { SMAAShader } from "../shaders/SMAAShader.js";
    export * from './more.js';
    import './side-effect.js';
    const lazy = () => import('./lazy.js');
    const url = 'https://example.com/x.js';
  `;
  assert.deepEqual(relativeImports(src), [
    '../shaders/SMAAShader.js', '../utils/BufferGeometryUtils.js',
    './Pass.js', './lazy.js', './more.js', './side-effect.js',
  ]);
});

test('resolveRelative is posix and normalises ..', () => {
  assert.equal(resolveRelative('postprocessing/SMAAPass.js', '../shaders/SMAAShader.js'), 'shaders/SMAAShader.js');
  assert.equal(resolveRelative('loaders/GLTFLoader.js', './x.js'), 'loaders/x.js');
});

test('isEsModuleSource tells an ES module from UMD glue', () => {
  assert.equal(isEsModuleSource('import { A } from "three";\nexport { B };'), true);
  assert.equal(isEsModuleSource('var DracoDecoderModule = (function() { return {}; })();'), false);
});
