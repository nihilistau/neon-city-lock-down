// @ts-check
// TTS bake pipeline. Reads data/voiceScript.js, invokes the voxtral CLI per line,
// trims silence, writes assets/voice/<char>/<hash>.wav + manifest.json. Incremental
// by sha1(char+text+voice): unchanged lines are skipped, edited lines rebake.
//
// Usage:
//   node tools/bake-tts.mjs                 # bake all missing/changed lines
//   node tools/bake-tts.mjs --force         # rebake everything
//   node tools/bake-tts.mjs --only lola     # only a character
//   VOXTRAL_DIR=... node tools/bake-tts.mjs # override voxtral repo path
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const VOXTRAL_DIR = process.env.VOXTRAL_DIR || 'D:/F/shannon-prime-repos/voxtral-mini-realtime-rs';
const VOXTRAL_BIN = join(VOXTRAL_DIR, 'target/release/voxtral.exe');
const GGUF = 'models/voxtral-tts-q4.gguf';
const EULER = 3;
const OUT_DIR = join(ROOT, 'assets/voice');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

function hash(char, text, voice) {
  return createHash('sha1').update(`${char}|${voice}|${text}`).digest('hex').slice(0, 16);
}

/** Parse a PCM16 mono WAV → {sampleRate, samples: Float32Array}. */
function readWav(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // find 'fmt ' and 'data' chunks
  let off = 12, sampleRate = 24000, dataOff = 44, dataLen = buf.length - 44, bits = 16, channels = 1;
  while (off < buf.length - 8) {
    const id = String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
    const size = dv.getUint32(off + 4, true);
    if (id === 'fmt ') {
      channels = dv.getUint16(off + 10, true);
      sampleRate = dv.getUint32(off + 12, true);
      bits = dv.getUint16(off + 22, true);
    } else if (id === 'data') {
      dataOff = off + 8; dataLen = size; break;
    }
    off += 8 + size + (size & 1);
  }
  const n = Math.floor(dataLen / (bits / 8) / channels);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // read first channel only
    const s = dv.getInt16(dataOff + i * (bits / 8) * channels, true);
    samples[i] = s / 32768;
  }
  return { sampleRate, samples };
}

/** Trim leading/trailing near-silence with small padding. */
function trimSilence(samples, sr, thresh = 0.012, padSec = 0.08) {
  let start = 0, end = samples.length - 1;
  while (start < samples.length && Math.abs(samples[start]) < thresh) start++;
  while (end > start && Math.abs(samples[end]) < thresh) end--;
  const pad = Math.floor(sr * padSec);
  start = Math.max(0, start - pad);
  end = Math.min(samples.length - 1, end + pad);
  return samples.subarray(start, end + 1);
}

/** Encode Float32 mono → PCM16 WAV Buffer. */
function writeWavBuffer(samples, sr) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

async function main() {
  if (!existsSync(VOXTRAL_BIN)) {
    console.error(`voxtral binary not found at ${VOXTRAL_BIN}`);
    console.error('Build it: cargo build --release --features "wgpu,cli,hub" (in the voxtral repo)');
    process.exit(1);
  }
  const { VOICE_LINES, VOICE_CAST } = await import('../data/voiceScript.js');
  const manifestPath = join(OUT_DIR, 'manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

  let baked = 0, skipped = 0, failed = 0;
  const lines = VOICE_LINES.filter((l) => !ONLY || l.char === ONLY);
  console.log(`Baking ${lines.length} line(s) via voxtral (euler=${EULER})...`);

  for (const line of lines) {
    const voice = line.voice || VOICE_CAST[line.char] || 'casual_female';
    const h = hash(line.char, line.text, voice);
    const relPath = `assets/voice/${line.char}/${h}.wav`;
    const absPath = join(ROOT, relPath);
    const existing = manifest[line.id];

    if (!FORCE && existing && existing.textHash === h && existsSync(absPath)) {
      skipped++; continue;
    }

    mkdirSync(dirname(absPath), { recursive: true });
    const tmpOut = join(OUT_DIR, `_tmp_${h}.wav`);
    process.stdout.write(`  ${line.id} [${voice}] ... `);
    try {
      execFileSync(VOXTRAL_BIN, [
        'speak', '--text', line.text, '--gguf', GGUF, '--voice', voice,
        '--output', tmpOut, '--euler-steps', String(EULER),
      ], { cwd: VOXTRAL_DIR, stdio: ['ignore', 'ignore', 'ignore'], timeout: 480000 });

      const raw = readWav(readFileSync(tmpOut));
      const trimmed = trimSilence(raw.samples, raw.sampleRate);
      writeFileSync(absPath, writeWavBuffer(trimmed, raw.sampleRate));
      try { execFileSync('cmd', ['/c', 'del', tmpOut.replace(/\//g, '\\')], { stdio: 'ignore' }); } catch { }

      const duration = trimmed.length / raw.sampleRate;
      manifest[line.id] = { file: relPath, duration: +duration.toFixed(3), voice, textHash: h };
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`ok (${duration.toFixed(2)}s)`);
      baked++;
    } catch (err) {
      console.log('FAILED');
      console.error('    ', String(err.message || err).split('\n')[0]);
      failed++;
    }
  }
  console.log(`\nDone. ${baked} baked, ${skipped} skipped, ${failed} failed.`);
  console.log(`Manifest: ${manifestPath}`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
