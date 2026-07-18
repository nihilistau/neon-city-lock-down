// @ts-check
// Config read/write API for the live creation-kit. Mounted by tools/serve.mjs.
// Node stdlib + the vendored js-yaml (imported by relative path — Node has no
// import map). Writes are validated against data/configSchema.js and confined to
// the config/ dir and known groups, so a bad edit can't corrupt or escape.
//
//   GET    /api/config                 -> { groups:[{group, exists}] }
//   GET    /api/config/<group>.yaml    -> text/yaml (or 404)
//   POST   /api/config/<group>.yaml    -> validate + write   { ok, errors }
//   DELETE /api/config/<group>.yaml    -> revert to defaults (delete file)
import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from '../vendor/js-yaml.mjs';
import { CONFIG_DEFAULTS } from '../data/configDefaults.js';
import { validateConfig } from '../data/configSchema.js';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const CONFIG_DIR = join(ROOT, 'config');
const GROUPS = new Set(Object.keys(CONFIG_DEFAULTS));

function readBody(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b)); });
}
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/** @returns {Promise<boolean>} true if the request was handled */
export async function handleConfig(req, res, url) {
  const rest = url.pathname.slice('/api/config'.length); // '' | '/<group>.yaml'
  // list
  if (rest === '' || rest === '/') {
    const groups = [];
    for (const g of GROUPS) {
      const exists = await stat(join(CONFIG_DIR, `${g}.yaml`)).then((s) => s.isFile()).catch(() => false);
      groups.push({ group: g, exists });
    }
    sendJson(res, 200, { groups });
    return true;
  }
  const m = /^\/([a-z0-9_-]+)\.yaml$/i.exec(rest);
  if (!m) { sendJson(res, 400, { error: 'bad config path' }); return true; }
  const group = m[1];
  if (!GROUPS.has(group)) { sendJson(res, 404, { error: `unknown group "${group}"` }); return true; }
  const file = join(CONFIG_DIR, `${group}.yaml`);

  if (req.method === 'GET') {
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text == null) { res.writeHead(404).end('no config file'); return true; }
    res.writeHead(200, { 'Content-Type': 'text/yaml; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(text);
    return true;
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const body = await readBody(req);
    let parsed;
    try { parsed = load(body) || {}; } catch (err) { sendJson(res, 400, { ok: false, errors: [`YAML parse: ${err}`] }); return true; }
    const errs = validateConfig(group, parsed);
    if (errs.length) { sendJson(res, 422, { ok: false, errors: errs }); return true; }
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(file, body, 'utf8');
    sendJson(res, 200, { ok: true, errors: [] });
    return true;
  }

  if (req.method === 'DELETE') {
    await unlink(file).catch(() => {});
    sendJson(res, 200, { ok: true, reverted: group });
    return true;
  }

  sendJson(res, 405, { error: 'method not allowed' });
  return true;
}
