// @ts-check
// User-content API for the Creation Kit. CRUD over user-authored scenarios,
// events, cutscenes, and dialogue, stored as JSON under user/<category>/.
// Mounted by tools/serve.mjs. Writes are confined to user/ + known categories
// and must be valid JSON (deep validation is the game's job — fail-soft).
//
//   GET    /api/user                         -> { scenarios:[..], events:[..], cutscenes:[..], dialogue:[..] }
//   GET    /api/user/<cat>/<name>.json       -> file contents
//   POST   /api/user/<cat>/<name>.json       -> validate JSON + write
//   DELETE /api/user/<cat>/<name>.json       -> remove
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { originAllowed, readBodyCapped } from './httpGuard.mjs';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const USER_DIR = join(ROOT, 'user');
const CATS = new Set(['scenarios', 'events', 'cutscenes', 'dialogue']);

function sendJson(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
const safe = (s) => /^[a-z0-9_-]+$/i.test(s);

/** @returns {Promise<boolean>} true if handled */
export async function handleUser(req, res, url) {
  const rest = url.pathname.slice('/api/user'.length); // '' | '/<cat>/<name>.json'
  if (rest === '' || rest === '/') {
    const index = {};
    for (const cat of CATS) {
      const files = await readdir(join(USER_DIR, cat)).catch(() => []);
      index[cat] = files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    }
    sendJson(res, 200, index);
    return true;
  }
  const m = /^\/([a-z]+)\/([a-z0-9_-]+)\.json$/i.exec(rest);
  if (!m) { sendJson(res, 400, { error: 'bad user path' }); return true; }
  const [, cat, name] = m;
  if (!CATS.has(cat) || !safe(name)) { sendJson(res, 404, { error: `unknown category "${cat}" or bad name` }); return true; }
  const file = join(USER_DIR, cat, `${name}.json`);

  if (req.method === 'GET') {
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text == null) { sendJson(res, 404, { error: 'not found' }); return true; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(text);
    return true;
  }
  if (req.method === 'POST' || req.method === 'PUT') {
    if (!originAllowed(req)) { sendJson(res, 403, { ok: false, error: 'cross-origin write blocked' }); return true; }
    let body;
    try { body = await readBodyCapped(req, 2 << 20); } catch (err) { sendJson(res, 413, { ok: false, error: String(err.message || err) }); return true; }
    try { JSON.parse(body); } catch (err) { sendJson(res, 400, { ok: false, error: `invalid JSON: ${err}` }); return true; }
    await mkdir(join(USER_DIR, cat), { recursive: true });
    await writeFile(file, body, 'utf8');
    sendJson(res, 200, { ok: true, saved: `${cat}/${name}.json` });
    return true;
  }
  if (req.method === 'DELETE') {
    if (!originAllowed(req)) { sendJson(res, 403, { ok: false, error: 'cross-origin write blocked' }); return true; }
    await unlink(file).catch(() => {});
    sendJson(res, 200, { ok: true, deleted: `${cat}/${name}.json` });
    return true;
  }
  sendJson(res, 405, { error: 'method not allowed' });
  return true;
}
