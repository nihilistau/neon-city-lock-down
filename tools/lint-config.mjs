// @ts-check
// Lints the engine config: (1) every value in data/configDefaults.js must pass
// its own schema (defaults/schema drift guard), and (2) every present
// config/<group>.yaml must parse and validate. Run via `npm run lint`.
import { readFile, readdir } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from '../vendor/js-yaml.mjs';
import { CONFIG_DEFAULTS } from '../data/configDefaults.js';
import { validateConfig, CONFIG_SCHEMA } from '../data/configSchema.js';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const CONFIG_DIR = join(ROOT, 'config');
let failed = 0;

function report(label, errs) {
  if (errs.length) { failed += errs.length; console.log(`  ✗ ${label}:`); for (const e of errs) console.log(`      ${e}`); }
  else console.log(`  ✓ ${label}`);
}

console.log('config lint\n');

// 1) defaults must satisfy their own schema, and every group must have a schema
for (const group of Object.keys(CONFIG_DEFAULTS)) {
  if (!CONFIG_SCHEMA[group]) { report(`defaults:${group}`, [`no schema for group "${group}"`]); continue; }
  report(`defaults:${group}`, validateConfig(group, CONFIG_DEFAULTS[group]));
}
for (const group of Object.keys(CONFIG_SCHEMA)) {
  if (!CONFIG_DEFAULTS[group]) report(`schema:${group}`, [`schema group "${group}" has no defaults`]);
}

// 2) any present config/*.yaml must parse + validate
const files = await readdir(CONFIG_DIR).catch(() => []);
const yamls = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
if (!yamls.length) console.log('\n  (no config/*.yaml present — pure defaults)');
for (const f of yamls) {
  const group = f.replace(/\.ya?ml$/, '');
  const text = await readFile(join(CONFIG_DIR, f), 'utf8');
  let parsed;
  try { parsed = load(text) || {}; } catch (err) { report(`config/${f}`, [`YAML parse: ${err}`]); continue; }
  report(`config/${f}`, validateConfig(group, parsed));
}

console.log('');
if (failed) { console.error(`Config lint FAILED (${failed} problem${failed === 1 ? '' : 's'}).`); process.exit(1); }
console.log('Config lint passed.');
