// @ts-check
// The asset manifest: schema, fingerprint and budget checks. Shared by
// tools/fetch-assets.mjs (which writes it), tools/lint-assets.mjs (`npm run
// lint`) and test/unit/asset-manifest.test.mjs. PURE except verifyFiles /
// strayFiles, which read the disk they are checking.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

/** Clone-and-serve stays viable at this size; past it, move to LFS (spec §Decisions). */
export const ASSET_BUDGET_BYTES = 40 * 1024 * 1024;
export const KINDS = ['hdri', 'pbr', 'gltf', 'lut'];
/** Only licences that let us commit and redistribute the file with no attribution chain. */
export const LICENSES = ['CC0'];
/** Which `role` a file of each kind may carry. */
export const ROLES = { hdri: ['hdr'], pbr: ['diff', 'nor', 'orm'], gltf: ['model', 'dependency'], lut: ['cube'] };
/** The top-level directories the pipeline owns; anything in them must be in the manifest. */
export const PIPELINE_DIRS = ['assets/hdri', 'assets/pbr', 'assets/props', 'assets/luts'];

/** @param {{id:string, kind:string}} e */
export function kindDir(e) {
  return { hdri: 'assets/hdri/', pbr: `assets/pbr/${e.id}/`, gltf: `assets/props/${e.id}/`, lut: 'assets/luts/' }[e.kind];
}

/** @param {Buffer|string} buf */
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const mb = (n) => (n / 1048576).toFixed(2);

/** @param {any} m @returns {number} bytes, each distinct path counted once */
export function totalBytes(m) {
  const seen = new Set();
  let n = 0;
  for (const e of m?.entries ?? []) {
    for (const f of e.files ?? []) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      n += Number(f.bytes) || 0;
    }
  }
  return n;
}

/** @param {any} m @returns {string[]} */
export function validateManifest(m) {
  if (!m || typeof m !== 'object' || !Array.isArray(m.entries)) return ['manifest: expected { entries: [...] }'];
  const errs = [];
  const ids = new Set();
  const paths = new Set();
  m.entries.forEach((e, i) => {
    const at = `entries[${i}]${e && typeof e.id === 'string' ? ` (${e.id})` : ''}`;
    if (!e || typeof e !== 'object') { errs.push(`${at}: not an object`); return; }
    if (typeof e.id !== 'string' || !/^[a-z0-9_]+$/.test(e.id)) errs.push(`${at}: id must match [a-z0-9_]+`);
    else if (ids.has(e.id)) errs.push(`${at}: duplicate id`);
    else ids.add(e.id);
    const kindOk = KINDS.includes(e.kind);
    if (!kindOk) errs.push(`${at}: kind must be one of ${KINDS.join('|')}`);
    if (typeof e.source !== 'string' || !e.source.trim()) errs.push(`${at}: source is required`);
    if (!LICENSES.includes(e.license)) errs.push(`${at}: license must be one of ${LICENSES.join('|')} — every shipped file needs a licence we can redistribute`);
    if (!e.urls || typeof e.urls !== 'object' || Array.isArray(e.urls)) errs.push(`${at}: urls must be an object`);
    else for (const [k, u] of Object.entries(e.urls)) if (typeof u !== 'string' || !u.startsWith('https://')) errs.push(`${at}: urls.${k} must be an https URL`);
    if (!e.transform || typeof e.transform !== 'object') errs.push(`${at}: transform must be an object`);
    if (!Array.isArray(e.files) || !e.files.length) {
      errs.push(`${at}: no files — run node tools/fetch-assets.mjs ${typeof e.id === 'string' ? e.id : ''}`.trim());
      return;
    }
    const dir = kindOk ? kindDir(e) : null;
    for (const f of e.files) {
      if (typeof f?.path !== 'string') { errs.push(`${at}: a file has no path`); continue; }
      if (f.path.includes('..') || f.path.includes('\\') || f.path.startsWith('/')) errs.push(`${at}: ${f.path} must be a clean posix path`);
      else if (dir && !f.path.startsWith(dir)) errs.push(`${at}: ${f.path} must live under ${dir}`);
      if (paths.has(f.path)) errs.push(`${at}: ${f.path} is listed twice`);
      paths.add(f.path);
      if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) errs.push(`${at}: ${f.path} has no sha256`);
      if (!Number.isInteger(f.bytes) || f.bytes <= 0) errs.push(`${at}: ${f.path} has no byte size`);
      if (kindOk && !ROLES[e.kind].includes(f.role)) errs.push(`${at}: ${f.path} role "${f.role}" is not one of ${ROLES[e.kind].join('|')}`);
      if (e.kind === 'gltf' && f.role === 'model' && typeof f.name !== 'string') errs.push(`${at}: ${f.path}: a model file needs a name`);
    }
    if (e.kind === 'pbr') for (const r of ROLES.pbr) if (!e.files.some((x) => x.role === r)) errs.push(`${at}: missing the ${r} map`);
  });
  const total = totalBytes(m);
  if (total > ASSET_BUDGET_BYTES) errs.push(`budget: ${mb(total)} MB exceeds the ${mb(ASSET_BUDGET_BYTES)} MB asset budget`);
  return errs;
}

/** @param {any} m @param {string} root repo root @returns {Promise<string[]>} */
export async function verifyFiles(m, root) {
  const errs = [];
  for (const e of m?.entries ?? []) {
    for (const f of e.files ?? []) {
      let buf;
      try { buf = await readFile(join(root, f.path)); } catch { errs.push(`${f.path}: missing on disk`); continue; }
      if (buf.length !== f.bytes) errs.push(`${f.path}: ${buf.length} bytes on disk, manifest says ${f.bytes}`);
      if (sha256(buf) !== f.sha256) errs.push(`${f.path}: sha256 mismatch — re-run node tools/fetch-assets.mjs ${e.id}`);
    }
  }
  return errs;
}

/** Files under the pipeline's directories that the manifest does not list. */
export async function strayFiles(m, root) {
  const listed = new Set((m?.entries ?? []).flatMap((e) => (e.files ?? []).map((f) => f.path)));
  const out = [];
  for (const dir of PIPELINE_DIRS) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const ent of await readdir(abs, { recursive: true, withFileTypes: true })) {
      if (!ent.isFile()) continue;
      const rel = relative(root, join(ent.parentPath ?? ent.path, ent.name)).split(sep).join('/');
      if (!listed.has(rel)) out.push(rel);
    }
  }
  return out.sort();
}

/** 'kenney_furniture/books' → ['kenney_furniture', 'books'] @param {string} ref */
export function resolveGltfRef(ref) {
  const i = ref.indexOf('/');
  if (i <= 0 || i === ref.length - 1) throw new Error(`"${ref}" is not a <pack>/<model> reference`);
  return [ref.slice(0, i), ref.slice(i + 1)];
}

/**
 * Cross-check data that names assets (data/propDressing.js) against the manifest.
 * @param {any} m @param {{asset:string, skin:string, floor:string}[]} props @param {string[]} skins
 */
export function checkPropRefs(m, props, skins) {
  const errs = [];
  for (const p of props) {
    let pack, name;
    try { [pack, name] = resolveGltfRef(p.asset); } catch (err) { errs.push(String(err instanceof Error ? err.message : err)); continue; }
    const e = (m?.entries ?? []).find((x) => x.id === pack);
    if (!e || e.kind !== 'gltf') errs.push(`${p.floor}: ${p.asset} — no gltf entry "${pack}" in assets/manifest.json`);
    else if (!e.files.some((f) => f.role === 'model' && f.name === name)) errs.push(`${p.floor}: ${p.asset} — "${pack}" has no model named "${name}"`);
    if (!skins.includes(p.skin)) errs.push(`${p.floor}: ${p.asset} — skin "${p.skin}" is not a PBR library material`);
  }
  return errs;
}
