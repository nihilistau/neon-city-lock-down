// @ts-check
// Vendor three.js example addons (examples/jsm) at EXACTLY the version of the
// vendored core (vendor/three.core.js REVISION). DEV-TIME ONLY — it needs the
// network; the game never runs it. Its output is committed.
//
//   node tools/vendor-three.mjs           add missing files, report drift
//   node tools/vendor-three.mjs --force   overwrite local copies with upstream
//
//   1. downloads the pinned npm tarball (cached under node_modules/.cache/)
//   2. extracts ADDONS plus everything they import relatively, transitively,
//      into vendor/three/addons/ at the same relative paths
//   3. FAILS if any vendored ES module imports a relative path that is not on
//      disk — an addon that loads in Node but 404s in the browser is the bug
//      this exists to prevent
//   4. writes vendor/three/addons/VENDORED.json (file, bytes, sha256, upstream)
//   5. writes one re-export shim per ES module under node_modules/three/addons/
//      and exports './addons/*' from the shim package, so `node --test` imports
//      'three/addons/…' exactly the way the browser's import map does
//
// An existing file that differs from upstream is KEPT (reported, recorded with
// upstream:false) unless --force: a local patch is a decision someone made.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseTgz } from './lib/archive.mjs';
import { relativeImports, resolveRelative, isEsModuleSource } from './lib/importScan.mjs';
import { safeRelative } from './lib/safePath.mjs';

const VERSION = '0.185.0';
const TARBALL = `https://registry.npmjs.org/three/-/three-${VERSION}.tgz`;
const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const OUT = join(ROOT, 'vendor', 'three', 'addons');
const SHIMS = join(ROOT, 'node_modules', 'three', 'addons');
const CACHE = join(ROOT, 'node_modules', '.cache', 'ncld-vendor');
const PREFIX = 'package/examples/jsm/';
/** emscripten/UMD glue + wasm: never scanned for imports, never shimmed */
const OPAQUE = /^libs\/draco\//;

/** What the game imports. Their relative dependencies are followed automatically. */
const ADDONS = [
  // already vendored before v0.7 — listed so the whole folder is reproducible
  'controls/OrbitControls.js',
  'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/ShaderPass.js',
  'postprocessing/OutputPass.js', 'postprocessing/UnrealBloomPass.js', 'postprocessing/MaskPass.js',
  'postprocessing/Pass.js',
  'shaders/CopyShader.js', 'shaders/LuminosityHighPassShader.js', 'shaders/OutputShader.js',
  // v0.7: asset loaders
  'loaders/GLTFLoader.js', 'loaders/DRACOLoader.js', 'loaders/HDRLoader.js', 'loaders/LUTCubeLoader.js',
  'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js',
  'libs/meshopt_decoder.module.js',
  'libs/draco/gltf/draco_decoder.js', 'libs/draco/gltf/draco_decoder.wasm', 'libs/draco/gltf/draco_wasm_wrapper.js',
  // v0.7: post stack + geometry
  'postprocessing/SMAAPass.js', 'shaders/SMAAShader.js', 'postprocessing/LUTPass.js',
  'geometries/RoundedBoxGeometry.js',
];

const TARBALL_TIMEOUT_MS = 120_000;
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function tarball() {
  const cached = join(CACHE, `three-${VERSION}.tgz`);
  if (existsSync(cached)) return readFile(cached);
  console.log(`  ↓ ${TARBALL}`);
  // The tarball is ~10 MB; a stalled registry must fail the run, not hang it.
  let buf;
  try {
    const res = await fetch(TARBALL, { signal: AbortSignal.timeout(TARBALL_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${TARBALL}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') throw new Error(`timed out after ${TARBALL_TIMEOUT_MS / 1000} s: ${TARBALL}`);
    throw err;
  }
  await mkdir(CACHE, { recursive: true });
  await writeFile(cached, buf);
  return buf;
}

/** @param {string} dir @returns {Promise<string[]>} posix paths relative to `base` */
async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, base));
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

async function main() {
  const force = process.argv.includes('--force');
  const core = await readFile(join(ROOT, 'vendor', 'three.core.js'), 'utf8');
  const rev = /const REVISION = '(\d+)'/.exec(core)?.[1];
  if (`0.${rev}.0` !== VERSION) throw new Error(`vendor/three.core.js is r${rev}; this tool pins three@${VERSION}`);

  const files = parseTgz(await tarball());
  const pkg = JSON.parse(files.get('package/package.json')?.toString('utf8') ?? '{}');
  if (pkg.version !== VERSION) throw new Error(`tarball is three@${pkg.version}, expected ${VERSION}`);

  // 2. the transitive closure of ADDONS over relative imports
  const want = new Set(ADDONS);
  const queue = [...ADDONS];
  while (queue.length) {
    const rel = /** @type {string} */ (queue.pop());
    const buf = files.get(PREFIX + rel);
    if (!buf) throw new Error(`three@${VERSION} has no examples/jsm/${rel}`);
    if (!rel.endsWith('.js') || OPAQUE.test(rel)) continue;
    for (const spec of relativeImports(buf.toString('utf8'))) {
      // an addon's own relative import is untrusted the same way its path is:
      // a crafted '../../etc/passwd'-style specifier must not reach the queue
      const dep = safeRelative(resolveRelative(rel, spec));
      if (!want.has(dep)) { want.add(dep); queue.push(dep); }
    }
  }

  for (const rel of [...want].sort()) {
    const upstream = /** @type {Buffer} */ (files.get(PREFIX + rel));
    const dest = join(OUT, safeRelative(rel));
    // belt-and-suspenders: safeRelative already forbids '..' segments, so this
    // can't actually fire, but the guard documents the invariant at the write site
    if (relative(OUT, dest).startsWith('..')) throw new Error(`refusing to write outside vendor root: ${rel}`);
    let status = 'added';
    if (existsSync(dest)) {
      const same = sha(await readFile(dest)) === sha(upstream);
      status = same ? 'same' : force ? 'replaced' : 'kept';
    }
    if (status === 'added' || status === 'replaced') {
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, upstream);
    }
    if (status === 'kept') console.log(`  ! ${rel}  (differs from upstream — kept; --force replaces it)`);
    else if (status !== 'same') console.log(`  + ${rel}`);
  }

  // 3. closure over what is ACTUALLY on disk
  const onDisk = (await walk(OUT)).filter((f) => f !== 'VENDORED.json').sort();
  const have = new Set(onDisk);
  const missing = [];
  for (const rel of onDisk) {
    if (!rel.endsWith('.js') || OPAQUE.test(rel)) continue;
    for (const spec of relativeImports(await readFile(join(OUT, rel), 'utf8'))) {
      const dep = safeRelative(resolveRelative(rel, spec));
      if (!have.has(dep)) missing.push(`${rel} imports ${spec} → ${dep}, which is not vendored`);
    }
  }
  if (missing.length) {
    for (const m of missing) console.error(`  ✗ ${m}`);
    throw new Error(`${missing.length} unresolved relative import(s)`);
  }

  // 4. the record — every file on disk, with whether it is byte-identical to upstream
  const record = [];
  for (const rel of onDisk) {
    const buf = await readFile(join(OUT, rel));
    const up = files.get(PREFIX + rel);
    record.push({ file: rel, bytes: buf.length, sha256: sha(buf), upstream: !!up && sha(up) === sha(buf) });
  }
  await writeFile(join(OUT, 'VENDORED.json'), `${JSON.stringify({ three: VERSION, tarball: TARBALL, files: record }, null, 2)}\n`);

  // 5. Node shims + the './addons/*' export on the shim package
  let shims = 0;
  for (const rel of onDisk) {
    if (!rel.endsWith('.js') || OPAQUE.test(rel)) continue;
    if (!isEsModuleSource(await readFile(join(OUT, rel), 'utf8'))) continue;
    const shim = join(SHIMS, rel);
    const target = relative(dirname(shim), join(OUT, rel)).split(sep).join('/');
    await mkdir(dirname(shim), { recursive: true });
    await writeFile(shim, `// generated by tools/vendor-three.mjs — lets Node resolve three/addons/${rel}\nexport * from '${target}';\n`);
    shims++;
  }
  const pkgPath = join(ROOT, 'node_modules', 'three', 'package.json');
  const shimPkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  shimPkg.exports = { '.': './index.mjs', './addons/*': './addons/*' };
  await writeFile(pkgPath, `${JSON.stringify(shimPkg, null, 2)}\n`);

  const mb = (record.reduce((n, r) => n + r.bytes, 0) / 1048576).toFixed(2);
  console.log(`\nvendored ${record.length} files (${mb} MB), ${shims} Node shims`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
