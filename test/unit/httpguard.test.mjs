// @ts-check
// The creation-kit servers can WRITE FILES, so a malicious page open in the same
// browser could otherwise drive them by CSRF, and a crafted URL could walk out of
// the repo. tools/httpGuard.mjs (origin + body cap), tools/userApi.mjs (name and
// category confinement) and tools/serve.mjs (static path confinement) are that
// defence, and had no tests at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { originAllowed, readBodyCapped } from '../../tools/httpGuard.mjs';
import { handleUser } from '../../tools/userApi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** a request object shaped like node's, with a real readable body */
function req(method, body = '', headers = {}) {
  const stream = /** @type {any} */ (Readable.from(body ? [Buffer.from(body)] : []));
  stream.method = method;
  stream.headers = headers;
  stream.destroyed_by_guard = false;
  const destroy = stream.destroy.bind(stream);
  stream.destroy = (...a) => { stream.destroyed_by_guard = true; return destroy(...a); };
  return stream;
}
/** a response object that records what was sent */
function res() {
  return {
    code: 0, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers; return this; },
    end(body = '') { this.body = String(body); return this; },
  };
}
const call = (method, path, body, headers) => {
  const r = res();
  return handleUser(req(method, body, headers), r, new URL(`http://localhost:8420${path}`)).then(() => r);
};
const json = (r) => JSON.parse(r.body);

test('originAllowed lets the machine in and keeps the web out', () => {
  // native tools (curl, the bake script) send no Origin at all
  assert.equal(originAllowed({ headers: {} }), true, 'no Origin → a native tool');
  assert.equal(originAllowed({ headers: {} }), true);
  assert.equal(originAllowed({}), true, 'a request with no headers object must not throw');

  for (const o of [
    'http://localhost', 'http://localhost:8420', 'https://localhost:8443',
    'http://127.0.0.1', 'http://127.0.0.1:8420', 'http://[::1]:8420',
    'HTTP://LOCALHOST:8420',
  ]) assert.equal(originAllowed({ headers: { origin: o } }), true, `${o} should be allowed`);

  for (const o of [
    'https://evil.example', 'http://localhost.evil.example', 'http://evil.example/localhost',
    'http://notlocalhost', 'http://127.0.0.1.evil.example', 'http://[::1].evil.example',
    'null', 'file://', 'http://192.168.1.9:8420', 'http://localhost:8420.evil.example',
    'http://localhost@evil.example', 'ws://localhost:8420',
  ]) assert.equal(originAllowed({ headers: { origin: o } }), false, `${o} must be blocked`);
});

test('readBodyCapped returns the body, and refuses to buffer a flood', async () => {
  assert.equal(await readBodyCapped(req('POST', '{"a":1}')), '{"a":1}');
  assert.equal(await readBodyCapped(req('POST', '')), '', 'an empty body is not an error');
  assert.equal(await readBodyCapped(req('POST', 'héllo — utf8')), 'héllo — utf8', 'utf8 survives');

  const flood = req('POST', 'x'.repeat(5000));
  await assert.rejects(() => readBodyCapped(flood, 1000), /body exceeds 1000 bytes/);
  assert.equal(flood.destroyed_by_guard, true, 'an oversized upload must be hung up on, not just rejected');

  // exactly at the cap is fine — the guard is > not >=
  assert.equal((await readBodyCapped(req('POST', 'y'.repeat(64)), 64)).length, 64);

  const boom = /** @type {any} */ (new Readable({ read() { this.destroy(new Error('socket reset')); } }));
  await assert.rejects(() => readBodyCapped(boom), /socket reset/, 'transport errors surface');
});

test('the user API refuses every path that is not <known category>/<safe name>.json', async () => {
  for (const path of [
    '/api/user/scenarios/../../package.json',
    '/api/user/scenarios/..%2f..%2fpackage.json',
    '/api/user/%2e%2e/%2e%2e/package.json',
    '/api/user/scenarios/..\\..\\package.json',
    '/api/user//etc/passwd',
    '/api/user/C:/Windows/win.ini',
    '/api/user/scenarios/sub/dir/name.json',
    '/api/user/scenarios/name.json.bak',
    '/api/user/scenarios/name.yaml',
    '/api/user/scenarios/na me.json',
    '/api/user/scenarios/.json',
    '/api/user/scenarios/name',
  ]) {
    const r = await call('GET', path);
    assert.equal(r.code, 400, `${path} should be rejected as a bad path (got ${r.code})`);
    assert.equal(json(r).error, 'bad user path');
  }

  // a well-shaped path in an unknown category is a 404, not a read
  for (const path of ['/api/user/secrets/keys.json', '/api/user/config/world.json', '/api/user/data/items.json']) {
    const r = await call('GET', path);
    assert.equal(r.code, 404, path);
  }

  // ...and the same confinement applies to the writing verbs
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const r = await call(method, '/api/user/scenarios/../../package.json', '{}',
      { origin: 'http://localhost:8420' });
    assert.equal(r.code, 400, `${method} traversal must not be written`);
  }
});

test('the user API serves its index and 404s an absent file — the allowed happy path', async () => {
  const r = await call('GET', '/api/user');
  assert.equal(r.code, 200);
  assert.match(r.headers['Content-Type'], /application\/json/);
  assert.equal(r.headers['Cache-Control'], 'no-store', 'user content must never be cached');
  const index = json(r);
  assert.deepEqual(Object.keys(index).sort(), ['cutscenes', 'dialogue', 'events', 'scenarios']);
  for (const list of Object.values(index)) assert.ok(Array.isArray(list));
  assert.deepEqual(json(await call('GET', '/api/user/')), index, 'with or without the trailing slash');

  const missing = await call('GET', '/api/user/scenarios/definitely_not_here.json');
  assert.equal(missing.code, 404);
  assert.equal(json(missing).error, 'not found');

  const bad = await call('PATCH', '/api/user/scenarios/whatever.json');
  assert.equal(bad.code, 405, 'unknown verbs are refused');
});

test('a cross-origin page cannot write through the creation kit (CSRF)', async () => {
  const evil = { origin: 'https://evil.example' };
  const ok = { origin: 'http://localhost:8420' };
  const path = '/api/user/scenarios/csrf_probe.json';

  for (const method of ['POST', 'PUT', 'DELETE']) {
    const r = await call(method, path, '{"id":"x","title":"x"}', evil);
    assert.equal(r.code, 403, `${method} from a foreign page must be blocked`);
    assert.equal(json(r).ok, false);
    assert.match(json(r).error, /cross-origin/);
  }

  // The same-machine origin gets PAST the CSRF gate — proven by the fact that
  // the request is then judged on its CONTENT (400 for bad JSON, 413 for a
  // flood) instead of being turned away at the door. Neither writes a file.
  const badJson = await call('POST', path, 'not json at all', ok);
  assert.equal(badJson.code, 400, 'an allowed origin reaches the JSON validation');
  assert.match(json(badJson).error, /invalid JSON/);

  const flood = await call('POST', path, 'x'.repeat(3 << 20), ok);
  assert.equal(flood.code, 413, 'an allowed origin still cannot flood the disk');

  // and with no Origin at all (curl) it also reaches validation, not a 403
  assert.equal((await call('POST', path, '{', {})).code, 400);
});

test('the static server will not serve a file outside the repo', async (t) => {
  const port = 8300 + (process.pid % 400);
  const server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(port)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => server.kill());
  const ready = await new Promise((resolve) => {
    let out = '';
    server.stdout.on('data', (c) => { out += c; if (out.includes('http://localhost')) resolve(true); });
    server.stderr.on('data', (c) => { out += c; if (/in use|failed/i.test(String(c))) resolve(false); });
    setTimeout(() => resolve(false), 8000);
  });
  if (!ready) { t.skip(`could not start tools/serve.mjs on ${port}`); return; }

  /** send a raw request line — fetch() would normalise the traversal away */
  const raw = (line) => new Promise((resolve, reject) => {
    const sock = connect(port, '127.0.0.1', () => sock.write(`${line} HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`));
    let buf = '';
    sock.on('data', (c) => { buf += c; });
    sock.on('end', () => resolve(buf));
    sock.on('error', reject);
  });
  const status = (r) => Number(r.split(' ')[1]);

  const home = await raw('GET /index.html');
  assert.equal(status(home), 200, 'the server must still serve the game');

  // Percent-encoded traversal survives URL parsing and reaches the file layer,
  // where the ROOT-prefix check is the only thing standing between a visiting
  // web page and the rest of the disk. Every one of these must be refused.
  for (const line of [
    'GET /%2e%2e%2f%2e%2e%2fWindows%2fwin.ini',
    'GET /..%2f..%2fWindows%2fwin.ini',
    'GET /src%2f..%2f..%2fpackage.json',
    'GET /assets%2f..%2f..%2f..%2fetc%2fpasswd',
    'GET /vendor/..%2f..%2f..%2fpackage.json',
  ]) {
    const r = await raw(line);
    assert.equal(status(r), 403, `${line} escaped the served tree with ${status(r)}`);
    assert.ok(!/neon-city-lock-down/.test(r), `${line} LEAKED a file from outside the tree`);
  }

  // Windows treats a backslash as a separator, POSIX treats it as a filename
  // character — either way this must not become a file the server hands over.
  const backslash = await raw('GET /..%5c..%5cWindows%5cwin.ini');
  assert.ok([403, 404].includes(status(backslash)), `backslash traversal → ${status(backslash)}`);

  // Paths the URL parser folds away land back INSIDE the tree — which is fine,
  // that is what the server exists to serve — but must never reach a system file.
  for (const line of [
    'GET /../../Windows/win.ini', 'GET /%2e%2e/%2e%2e/Windows/win.ini',
    'GET /../../../etc/passwd', 'GET /assets/../../../etc/passwd',
  ]) {
    const r = await raw(line);
    assert.equal(status(r), 404, `${line} → ${status(r)}`);
    assert.ok(!/\[fonts\]|\[extensions\]|root:x:/i.test(r), `${line} leaked a system file`);
  }

  // and the write API is CSRF-guarded over the real socket too
  const cross = await new Promise((resolve, reject) => {
    const body = '{"id":"x","title":"x"}';
    const sock = connect(port, '127.0.0.1', () => sock.write(
      `POST /api/user/scenarios/csrf_probe.json HTTP/1.1\r\nHost: localhost:${port}\r\n`
      + `Origin: https://evil.example\r\nContent-Type: application/json\r\n`
      + `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`));
    let buf = '';
    sock.on('data', (c) => { buf += c; });
    sock.on('end', () => resolve(buf));
    sock.on('error', reject);
  });
  assert.equal(status(cross), 403, 'a foreign page must not be able to write a scenario file');
});
