// @ts-check
// Lints the asset pipeline: assets/manifest.json against its schema, every
// listed file against its recorded sha256, no stray files in the pipeline's
// directories, the CC0 licence on every entry, and the 40 MB budget. Run via
// `npm run lint`. Node stdlib only.
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, verifyFiles, strayFiles, totalBytes, ASSET_BUDGET_BYTES } from './lib/manifest.mjs';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
let failed = 0;
function report(label, errs) {
  if (errs.length) { failed += errs.length; console.log(`  ✗ ${label}:`); for (const e of errs) console.log(`      ${e}`); }
  else console.log(`  ✓ ${label}`);
}

console.log('asset lint\n');
const manifest = JSON.parse(await readFile(join(ROOT, 'assets', 'manifest.json'), 'utf8'));
report('manifest schema, licences, budget', validateManifest(manifest));
report('every file matches its sha256', await verifyFiles(manifest, ROOT));
report('no unlisted files in the pipeline dirs', (await strayFiles(manifest, ROOT)).map((p) => `${p}: not in assets/manifest.json`));

const mb = (n) => (n / 1048576).toFixed(2);
console.log(`\n  ${manifest.entries.length} entries, ${mb(totalBytes(manifest))} MB of the ${mb(ASSET_BUDGET_BYTES)} MB budget\n`);
if (failed) { console.error(`Asset lint FAILED (${failed} problem${failed === 1 ? '' : 's'}).`); process.exit(1); }
console.log('Asset lint passed.');
