// @ts-check
// The headless Blender runner. Spawns
//   blender -b --factory-startup --python-exit-code 1 -P <script> -- <json-args>
// and returns the object the script prints on its ONE `@@RESULT <json>` line.
// Blender chatters on stdout (import logs, render progress), so the sentinel is
// the contract; a non-zero exit or a missing result line throws with the tail of
// stderr, which is where a Python traceback lands.
//
// --factory-startup ignores the user's prefs and add-ons, so a run is the same
// on every machine that has the same Blender.
//
//   node tools/blender/run.mjs inspect <in>
//   node tools/blender/run.mjs convert <in> <out.glb> [--lod 0.5] [--apply-scale]
//   node tools/blender/run.mjs preview <in> <out.png>
//
// <in> is .glb/.gltf/.fbx/.obj/.blend. Dev tool: the game never runs Blender.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { delimiter, isAbsolute, join, normalize, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = normalize(join(fileURLToPath(import.meta.url), '..'));
const RESULT = '@@RESULT ';
const DEFAULT_TIMEOUT_MS = 300_000;
/** CLI verb → script file */
const SCRIPTS = { inspect: 'inspect', convert: 'convert_to_glb', preview: 'preview' };

/** "Blender 5.10" → [5, 10]; anything else → null */
const versionOf = (/** @type {string} */ name) => {
  const m = /^Blender (\d+)\.(\d+)$/.exec(name);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

/**
 * Where Blender is, or null. Order: $BLENDER_EXE, PATH, the known install
 * locations, then the highest "Blender N.M" under each Program Files root.
 * Every input is injectable so the lookup is testable without a Blender.
 * @param {{
 *   env?: Record<string, string|undefined>,
 *   platform?: string,
 *   exists?: (p:string) => boolean,
 *   pathDirs?: string[],
 *   defaults?: string[],
 *   globRoots?: string[],
 *   listDir?: (d:string) => string[],
 * }} [o]
 * @returns {string|null}
 */
export function findBlender(o = {}) {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const exists = o.exists ?? existsSync;
  const win = platform === 'win32';
  const pjoin = win ? win32.join : posix.join;
  const exe = win ? 'blender.exe' : 'blender';
  const listDir = o.listDir ?? ((d) => { try { return readdirSync(d); } catch { return []; } });

  if (env.BLENDER_EXE && exists(env.BLENDER_EXE)) return env.BLENDER_EXE;
  const pathDirs = o.pathDirs ?? (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  for (const d of pathDirs) {
    const p = pjoin(d, exe);
    if (exists(p)) return p;
  }
  const defaults = o.defaults ?? (win
    ? ['D:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe']
    : ['/Applications/Blender.app/Contents/MacOS/Blender']);
  for (const p of defaults) if (exists(p)) return p;
  const globRoots = o.globRoots ?? (win ? ['C:\\Program Files\\Blender Foundation', 'D:\\Program Files\\Blender Foundation'] : []);
  for (const root of globRoots) {
    const versions = listDir(root)
      .map((name) => ({ name, v: versionOf(name) }))
      .filter((x) => x.v !== null)
      .sort((a, b) => /** @type {number[]} */ (b.v)[0] - /** @type {number[]} */ (a.v)[0] || /** @type {number[]} */ (b.v)[1] - /** @type {number[]} */ (a.v)[1]);
    for (const { name } of versions) {
      const p = pjoin(root, name, exe);
      if (exists(p)) return p;
    }
  }
  return null;
}

const tail = (/** @type {string} */ s, n = 20) => s.trimEnd().split(/\r?\n/).slice(-n).join('\n');

/**
 * Run a Blender Python script headless and return its @@RESULT object.
 * @param {string} script a path, or a verb (inspect | convert | preview) / bare name for scripts/<name>.py
 * @param {Record<string, unknown>} [args] JSON-serialised after `--`
 * @param {{timeoutMs?: number, blender?: string|null}} [opts]
 * @returns {Promise<any>}
 */
export function runBlender(script, args = {}, opts = {}) {
  const blender = opts.blender ?? findBlender();
  if (!blender) return Promise.reject(new Error('Blender not found — set BLENDER_EXE to blender.exe'));
  const path = /[\\/]/.test(script) || script.endsWith('.py') ? script : join(HERE, 'scripts', `${SCRIPTS[/** @type {keyof typeof SCRIPTS} */ (script)] ?? script}.py`);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const argv = ['-b', '--factory-startup', '--python-exit-code', '1', '-P', path, '--', JSON.stringify(args)];
  return new Promise((resolvePromise, reject) => {
    const child = spawn(blender, argv, { windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`blender ${script} timed out after ${timeoutMs / 1000} s\n${tail(err || out)}`));
    }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = out.split(/\r?\n/).find((l) => l.startsWith(RESULT));
      if (code !== 0) return reject(new Error(`blender ${script} exited ${code}\n${tail(err || out)}`));
      if (!line) return reject(new Error(`blender ${script} printed no ${RESULT.trim()} line\n${tail(err || out)}`));
      try {
        resolvePromise(JSON.parse(line.slice(RESULT.length)));
      } catch (e) {
        reject(new Error(`blender ${script}: unparseable result (${e instanceof Error ? e.message : e})`));
      }
    });
  });
}

// ---- CLI ---------------------------------------------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const [cmd, input, maybeOut] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--lod');
  const lodAt = argv.indexOf('--lod');
  const usage = 'usage: node tools/blender/run.mjs <inspect|convert|preview> <in> [out] [--lod 0.5] [--apply-scale]';
  if (!['inspect', 'convert', 'preview'].includes(cmd) || !input || (cmd !== 'inspect' && !maybeOut)) {
    console.error(usage);
    process.exit(2);
  }
  const abs = (/** @type {string} */ p) => (isAbsolute(p) ? p : resolve(p));
  /** @type {Record<string, unknown>} */
  const args = { in: abs(input) };
  if (maybeOut) args.out = abs(maybeOut);
  if (lodAt >= 0) args.lod = Number(argv[lodAt + 1]);
  if (argv.includes('--apply-scale')) args.apply_scale = true;
  try {
    console.log(JSON.stringify(await runBlender(cmd, args), null, 2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
