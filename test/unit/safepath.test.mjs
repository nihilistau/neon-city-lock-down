// @ts-check
// tools/lib/safePath.mjs — the one guard `join(OUT, rel)` sites in
// tools/vendor-three.mjs (and, per the same threat, tools/fetch-assets.mjs)
// rely on before turning an archive-derived string into a filesystem path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeRelative } from '../../tools/lib/safePath.mjs';

test('safeRelative accepts an ordinary relative path unchanged', () => {
  assert.equal(safeRelative('loaders/GLTFLoader.js'), 'loaders/GLTFLoader.js');
});

test('safeRelative rejects a ".." segment, however deep', () => {
  assert.throws(() => safeRelative('../x'), /unsafe path/);
  assert.throws(() => safeRelative('a/../../x'), /unsafe path/);
});

test('safeRelative rejects an absolute posix path', () => {
  assert.throws(() => safeRelative('/etc/x'), /unsafe path/);
});

test('safeRelative rejects a Windows drive path in either slash style', () => {
  assert.throws(() => safeRelative('C:/x'), /unsafe path/);
  assert.throws(() => safeRelative('C:\\x'), /unsafe path/);
});

test('safeRelative rejects a drive-relative path, a UNC path, an empty path and a NUL byte', () => {
  assert.throws(() => safeRelative('c:x.glb'), /unsafe path/);
  assert.throws(() => safeRelative('\\\\server\\share\\x.glb'), /unsafe path/);
  assert.throws(() => safeRelative(''), /unsafe path/);
  assert.throws(() => safeRelative('a\u0000.glb'), /unsafe path/);
});

test('safeRelative rejects a raw ".." segment even when it normalizes back inside the root', () => {
  // no honest zip entry or model URI climbs, so one that does is refused outright
  assert.throws(() => safeRelative('Models/../x.glb'), /unsafe path/);
  assert.throws(() => safeRelative('Models\\..\\win.glb'), /unsafe path/);
});

test('safeRelative leaves dots inside a segment alone and turns backslashes into posix separators', () => {
  assert.equal(safeRelative('a..b/c.glb'), 'a..b/c.glb');
  assert.equal(safeRelative('Models\\GLB format\\x.glb'), 'Models/GLB format/x.glb');
});
