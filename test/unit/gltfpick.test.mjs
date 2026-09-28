// @ts-check
// tools/lib/gltfPick.mjs + tools/lib/pbrPack.mjs. Picking decides WHICH Kenney
// model ships under a stable name, and the URI scan decides which sidecar files
// ship with it — miss one and GLTFLoader logs a console.error for a missing
// texture at boot, which the e2e suite treats as a failure. ORM packing decides
// which channel three's aoMap / roughnessMap / metalnessMap read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickModel, gltfJson, externalUris } from '../../tools/lib/gltfPick.mjs';
import { packOrm } from '../../tools/lib/pbrPack.mjs';

/** @param {any} json */
function glb(json) {
  let j = Buffer.from(JSON.stringify(json));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const h = Buffer.alloc(20);
  h.writeUInt32LE(0x46546c67, 0);   // 'glTF'
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(20 + j.length, 8);
  h.writeUInt32LE(j.length, 12);
  h.writeUInt32LE(0x4e4f534a, 16);  // 'JSON'
  return Buffer.concat([h, j]);
}

const NAMES = [
  'Models/GLB format/plantSmall2.glb', 'Models/GLB format/plantSmall1.glb',
  'Models/GLTF format/plantSmall1.gltf', 'Models/GLB format/books.glb',
  'Models/GLB format/bookcaseClosed.glb', 'Models/OBJ format/books.obj',
  'License.txt',
];

test('pickModel prefers .glb, then the shortest name, then alphabetical', () => {
  assert.equal(pickModel(NAMES, 'plantSmall'), 'Models/GLB format/plantSmall1.glb');
  assert.equal(pickModel(NAMES, 'BOOKS'), 'Models/GLB format/books.glb', 'case-insensitive, and never an .obj');
  assert.equal(pickModel(NAMES, 'bookcase'), 'Models/GLB format/bookcaseClosed.glb');
  assert.equal(pickModel(NAMES, 'tank'), null);
});

test('gltfJson reads the JSON chunk of a GLB and a plain .gltf', () => {
  assert.deepEqual(gltfJson(glb({ asset: { version: '2.0' } }), '.glb'), { asset: { version: '2.0' } });
  assert.deepEqual(gltfJson(Buffer.from('{"asset":{"version":"2.0"}}'), '.gltf'), { asset: { version: '2.0' } });
  assert.throws(() => gltfJson(Buffer.from('nope nope nope nope nope'), '.glb'), /not a GLB/);
});

test('externalUris lists sidecar buffers and images, decoded, never data: URIs', () => {
  const buf = glb({
    buffers: [{ byteLength: 4 }, { uri: 'books.bin', byteLength: 4 }],
    images: [{ uri: 'Textures/color%20map.png' }, { uri: 'data:image/png;base64,AAAA' }, { bufferView: 0 }],
  });
  assert.deepEqual(externalUris(buf, '.glb'), ['books.bin', 'Textures/color map.png']);
});

test('packOrm interleaves AO, roughness, metalness into R, G, B', () => {
  const out = packOrm({ size: 2, ao: Buffer.from([10, 20, 30, 40]), rough: Buffer.from([1, 2, 3, 4]), metal: Buffer.from([5, 6, 7, 8]) });
  assert.deepEqual([...out], [10, 1, 5, 20, 2, 6, 30, 3, 7, 40, 4, 8]);
});

test('packOrm: no AO means unoccluded (255), no metal means dielectric (0)', () => {
  const out = packOrm({ size: 1, ao: null, rough: Buffer.from([128]), metal: null });
  assert.deepEqual([...out], [255, 128, 0]);
  assert.throws(() => packOrm({ size: 2, ao: null, rough: Buffer.from([1]), metal: null }), /rough: 1 bytes, expected 4/);
});
