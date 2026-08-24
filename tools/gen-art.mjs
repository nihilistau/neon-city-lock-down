// @ts-check
// Dev-time art generation via the xAI image API, driven by tools/art/manifest.mjs.
//
//   node tools/gen-art.mjs              # everything missing
//   node tools/gen-art.mjs icon-hp      # one asset
//   node tools/gen-art.mjs --all        # regenerate everything (overwrites)
//   node tools/gen-art.mjs --list
//
// Generated output is COMMITTED, so the game still runs with a bare
// `clone && node tools/serve.mjs` — this never runs at play time.
//
// The API returns 1024x1024 JPEG with no alpha, so everything that needs
// transparency is generated on a magenta chroma field and keyed here, once,
// with a feathered edge. Compare v0.4, which keyed on every page load.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ART, findArt, CHROMA } from './art/manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = process.env.XAI_IMAGE_MODEL || 'grok-imagine-image-quality';
const KEY_PATHS = [
  process.env.XAI_API_KEY_FILE,
  'D:/F/shannon-prime-repos/archive/notes_and_stuff/creds/xAI-API.txt',
  join(ROOT, 'xai-api-key.txt'),
].filter(Boolean);

function apiKey() {
  if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY;
  for (const p of KEY_PATHS) {
    try {
      const m = readFileSync(/** @type {string} */(p), 'utf8').match(/xai-[A-Za-z0-9_-]+/);
      if (m) return m[0];
    } catch { /* try the next */ }
  }
  throw new Error('no xAI key — set XAI_API_KEY or XAI_API_KEY_FILE');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Generate one image, retrying transient transport failures.
 * `fetch failed` (no HTTP status) happens intermittently on this connection, and
 * a 429/5xx deserves a backoff too. A 4xx other than 429 is a real rejection —
 * a bad key or a refused prompt — so it fails fast rather than hammering.
 * @param {string} prompt @param {number} [tries] @returns {Promise<Buffer>}
 */
async function generate(prompt, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch('https://api.x.ai/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
        body: JSON.stringify({ model: MODEL, prompt, n: 1, response_format: 'b64_json' }),
      });
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`xAI ${res.status}`);
      } else if (!res.ok) {
        throw new Error(`xAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
      } else {
        const json = await res.json();
        const b64 = json?.data?.[0]?.b64_json;
        if (!b64) throw new Error('no image in response');
        return Buffer.from(b64, 'base64');
      }
    } catch (err) {
      // transport-level failure — retry; anything with a status was handled above
      last = err;
      if (err instanceof Error && /^xAI [45]\d\d: /.test(err.message)) throw err;
    }
    if (i < tries - 1) await sleep(1200 * (i + 1));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * Key the magenta field to alpha with a soft edge.
 *
 * A hard binary test (what v0.4 did at runtime) stair-steps every glyph and
 * leaves a coloured fringe, because the source is a LOSSY JPEG and its ringing
 * survives the threshold. Scoring by distance and ramping alpha across a band
 * gives an anti-aliased cut, and un-premultiplying pulls the magenta back out
 * of the partially-transparent pixels so edges don't read pink.
 * @param {Buffer} buf @param {number} size
 */
async function keyToAlpha(buf, size) {
  const img = sharp(buf).resize(size, size, { fit: 'cover', kernel: 'lanczos3' });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const out = Buffer.alloc(size * size * 4);

  // Key against the ACTUAL background, sampled from the border — the model does
  // not return exactly #FF00FF (it drifts to a pink-magenta), and keying against
  // the nominal constant left the whole field inside the feather band: measured
  // 0% fully transparent, 76.5% partial. The manifest's CHROMA is the request;
  // this is what came back.
  const px = (x, y) => { const i = (y * size + x) * ch; return [data[i], data[i + 1], data[i + 2]]; };
  const edge = [];
  for (let x = 0; x < size; x++) { edge.push(px(x, 0), px(x, size - 1)); }
  for (let y = 0; y < size; y++) { edge.push(px(0, y), px(size - 1, y)); }
  const median = (arr) => arr.slice().sort((a, b) => a - b)[arr.length >> 1];
  const key = [0, 1, 2].map((c) => median(edge.map((p) => p[c])));
  // sanity: if the border isn't magenta-ish the prompt didn't do its job
  const isMagenta = key[0] > 120 && key[2] > 100 && key[1] < 120;
  if (!isMagenta) {
    throw new Error(`border is rgb(${key}) — not a chroma field; check the prompt`);
  }

  const NEAR = 60, FAR = 120;   // distance band, in RGB units
  for (let i = 0, o = 0; i < data.length; i += ch, o += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const d = Math.hypot(r - key[0], g - key[1], b - key[2]);
    const a = d <= NEAR ? 0 : d >= FAR ? 255 : Math.round(((d - NEAR) / (FAR - NEAR)) * 255);
    // un-premultiply the chroma out of edge pixels so they don't fringe pink
    const k = a / 255;
    out[o] = k > 0 ? Math.min(255, Math.max(0, Math.round((r - key[0] * (1 - k)) / Math.max(k, 0.15)))) : 0;
    out[o + 1] = k > 0 ? Math.min(255, Math.max(0, Math.round((g - key[1] * (1 - k)) / Math.max(k, 0.15)))) : 0;
    out[o + 2] = k > 0 ? Math.min(255, Math.max(0, Math.round((b - key[2] * (1 - k)) / Math.max(k, 0.15)))) : 0;
    out[o + 3] = a;
  }
  return sharp(out, { raw: { width: size, height: size, channels: 4 } })
    .png({ compressionLevel: 9, palette: false }).toBuffer();
}

/** @param {import('./art/manifest.mjs').ArtSpec} spec @param {Buffer} raw */
async function process_(spec, raw) {
  const size = spec.size ?? 512;
  if (spec.chroma) return keyToAlpha(raw, size);
  if (spec.kind === 'plate') {
    return sharp(raw).resize(size, Math.round(size * 0.5625), { fit: 'cover' })
      .jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  }
  return sharp(raw).resize(size, size, { fit: 'cover', kernel: 'lanczos3' })
    .jpeg({ quality: 80, mozjpeg: true }).toBuffer();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const a of ART) console.log(`${a.id.padEnd(18)} -> ${a.out}`);
    return;
  }
  const all = args.includes('--all');
  const picked = args.filter((a) => !a.startsWith('--'));
  const todo = (picked.length ? picked.map(findArt).filter(Boolean) : ART)
    .filter((a) => all || picked.length || !existsSync(join(ROOT, /** @type {any} */(a).out)));

  if (!todo.length) { console.log('nothing to generate (use --all to overwrite)'); return; }
  console.log(`model ${MODEL} · ${todo.length} asset(s)`);

  let ok = 0;
  for (const spec of /** @type {any[]} */ (todo)) {
    process.stdout.write(`  ${spec.id.padEnd(18)} `);
    try {
      const raw = await generate(spec.prompt);
      const buf = await process_(spec, raw);
      const dest = join(ROOT, spec.out);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      console.log(`ok  ${(buf.length / 1024).toFixed(1)}KB  ${spec.out}`);
      ok++;
    } catch (err) {
      console.log(`FAIL  ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\n${ok}/${todo.length} generated.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
