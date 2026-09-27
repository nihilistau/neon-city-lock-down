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
