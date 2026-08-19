// @ts-check
// Voice server — wraps the vendored Voxtral TTS CLI so the game (and the Voice
// Controls panel) can synthesize, save, and manage voices at runtime. Node
// stdlib only. Config-driven (config/voice.yaml via tools/serverConfig.mjs);
// env VOXTRAL_DIR overrides the engine location. Start it before playing:
//   node tools/sidecar.mjs            (port from config, default 8425)
//
//   GET  /health                      -> { ok, voices, voxtralDir }
//   GET  /voices                      -> { voices:[{name, kind}] }
//   POST /speak      {text, voice, euler?}                -> audio/wav (one line)
//   POST /synthLong  {text, voice, euler?, save?, name?}  -> audio/wav (chunked + concatenated)
//   POST /save       {wavBase64, name?} | {wavBase64, char, lineId, text} -> save clip OR bake a character line
//   GET  /library                     -> { clips:[...], voices:[...] }
//   GET  /clip?file=<name.wav>        -> audio/wav (a saved clip)
//   POST /clone      {refPath|refWavBase64, name}         -> new voice embedding (Python add-on) or 501
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, isAbsolute, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { scfg, ROOT_DIR } from './serverConfig.mjs';
import { originAllowed, readBodyCapped } from './httpGuard.mjs';

const V = (k, d) => scfg('voice.' + k, d);
const PORT = Number(process.argv[2] || V('port', 8425));
const VOXTRAL_DIR = process.env.VOXTRAL_DIR || abs(V('voxtralDir', 'third_party/voxtral'));
const BIN = join(VOXTRAL_DIR, V('binary', 'target/release/voxtral.exe'));
const GGUF = V('gguf', 'models/voxtral-tts-q4.gguf');                     // relative to cwd=VOXTRAL_DIR
const VOICES_DIR = join(VOXTRAL_DIR, V('voicesDir', 'models/voxtral-tts/voice_embedding'));
const EULER = String(V('eulerSteps', 3));
const MAX_FRAMES = String(V('maxFrames', 2000));
const USER_VOICES = abs(V('userVoicesDir', 'user/voices'));
const ASSETS_VOICE = join(ROOT_DIR, 'assets', 'voice');
const CACHE = join(tmpdir(), 'ncld-voice');
mkdirSync(CACHE, { recursive: true });
mkdirSync(USER_VOICES, { recursive: true });

/** resolve a config path against the project root unless already absolute */
function abs(p) { return isAbsolute(p) ? p : resolve(ROOT_DIR, p); }

// ── voice catalogue ────────────────────────────────────────────────────────
/** list <name>.safetensors embeddings in the engine + user voice dirs */
function listVoices() {
  const out = [];
  for (const [dir, kind] of [[VOICES_DIR, 'preset'], [USER_VOICES, 'user']]) {
    try {
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.safetensors')) out.push({ name: f.replace(/\.safetensors$/, ''), kind });
      }
    } catch { /* missing dir */ }
  }
  return out;
}
function voiceExists(name) { return listVoices().some((v) => v.name === name); }

// ── WAV helpers (voxtral emits 24 kHz / 16-bit / mono) ──────────────────────
function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV');
  let p = 12, fmt = { sampleRate: 24000, channels: 1, bitsPerSample: 16 }, pcm = Buffer.alloc(0);
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), sz = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') { fmt = { channels: buf.readUInt16LE(p + 10), sampleRate: buf.readUInt32LE(p + 12), bitsPerSample: buf.readUInt16LE(p + 22) }; }
    else if (id === 'data') { pcm = buf.subarray(p + 8, p + 8 + sz); }
    p += 8 + sz + (sz & 1);
  }
  return { ...fmt, pcm };
}
function writeWav({ sampleRate = 24000, channels = 1, bitsPerSample = 16, pcm }) {
  const byteRate = sampleRate * channels * bitsPerSample / 8, blockAlign = channels * bitsPerSample / 8;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(byteRate, 28); h.writeUInt16LE(blockAlign, 32); h.writeUInt16LE(bitsPerSample, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
function concatWavs(wavs) {
  const parsed = wavs.map(readWav);
  const pcm = Buffer.concat(parsed.map((w) => w.pcm));
  return writeWav({ ...parsed[0], pcm });
}

// ── synthesis ───────────────────────────────────────────────────────────────
/** run `voxtral speak` for one chunk; cache by (voice|euler|text) */
function speak(text, voice, euler) {
  const v = voiceExists(voice) ? voice : (V('cast.radio', 'casual_female'));
  const eu = String(euler || EULER);
  const h = createHash('sha1').update(`${v}|${eu}|${text}`).digest('hex').slice(0, 16);
  const out = join(CACHE, `${h}.wav`);
  if (!existsSync(out)) {
    execFileSync(BIN, [
      'speak', '--text', text, '--gguf', GGUF, '--voice', v, '--voices-dir', VOICES_DIR,
      '--output', out, '--euler-steps', eu, '--max-frames', MAX_FRAMES,
    ], { cwd: VOXTRAL_DIR, stdio: 'ignore', timeout: 300000 });
  }
  return readFileSync(out);
}

/** split long text into synth-sized chunks (whole sentences, ~320 char cap) */
function chunkText(text, cap = 320) {
  const parts = String(text).replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*\s*/g) || [String(text)];
  const chunks = []; let cur = '';
  for (const s of parts) {
    if ((cur + s).length > cap && cur) { chunks.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length ? chunks : [String(text)];
}

// ── request plumbing ─────────────────────────────────────────────────────────
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', ...CORS }); res.end(JSON.stringify(obj)); }
function wav(res, buf) { res.writeHead(200, { 'Content-Type': 'audio/wav', ...CORS }); res.end(buf); }

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS).end(); return; }

    if (p === '/health') return json(res, 200, { ok: existsSync(BIN), voices: listVoices(), voxtralDir: VOXTRAL_DIR });
    if (p === '/voices') return json(res, 200, { voices: listVoices() });

    if (p === '/clip' && req.method === 'GET') {
      const f = basename(url.searchParams.get('file') || '');
      const file = join(USER_VOICES, f);
      if (!f.endsWith('.wav') || !existsSync(file)) return json(res, 404, { error: 'no clip' });
      return wav(res, readFileSync(file));
    }
    if (p === '/library') {
      const clips = safeList(USER_VOICES, '.wav');
      const voices = listVoices();
      return json(res, 200, { clips, voices });
    }

    if (req.method === 'POST') {
      // these endpoints write files / spawn the TTS engine — block cross-site CSRF
      if (!originAllowed(req)) return json(res, 403, { error: 'cross-origin request blocked' });
      let data;
      try { data = JSON.parse((await readBodyCapped(req)) || '{}'); }
      catch (err) { return json(res, 413, { error: String(err.message || err) }); }

      if (p === '/speak') {
        if (!data.text) return json(res, 400, { error: 'missing text' });
        return wav(res, speak(String(data.text).slice(0, 800), data.voice, data.euler));
      }

      if (p === '/synthLong') {
        if (!data.text) return json(res, 400, { error: 'missing text' });
        const chunks = chunkText(String(data.text).slice(0, 20000)).slice(0, 80);  // cap work
        const wavs = chunks.map((c) => speak(c, data.voice, data.euler));
        const out = wavs.length > 1 ? concatWavs(wavs) : wavs[0];
        if (data.save && data.name) {
          const file = join(USER_VOICES, `${safeName(data.name)}.wav`);
          writeFileSync(file, out);
          res.writeHead(200, { 'Content-Type': 'audio/wav', 'X-Saved': basename(file), ...CORS }); res.end(out); return;
        }
        return wav(res, out);
      }

      if (p === '/save') {
        const buf = Buffer.from(data.wavBase64 || '', 'base64');
        if (!buf.length) return json(res, 400, { error: 'missing wavBase64' });
        if (data.char && data.lineId) {           // bake as a character dialogue line
          // sanitize BOTH path components so the write can't escape assets/voice/
          const char = safeName(data.char), lineId = safeName(data.lineId);
          // validate it's a real WAV BEFORE touching disk (throws → 500, nothing written)
          const { sampleRate, pcm } = readWav(buf);
          mkdirSync(join(ASSETS_VOICE, char), { recursive: true });
          const hash = createHash('sha1').update(`${char}|${data.voice || ''}|${data.text || lineId}`).digest('hex').slice(0, 16);
          const rel = `${char}/${hash}.wav`;
          writeFileSync(join(ASSETS_VOICE, rel), buf);
          // The manifest path must be PROJECT-root relative, matching bake-tts.mjs
          // and what src/audio/voice.js fetches ('/' + file). Writing the
          // assets-relative `rel` here made every panel-baked line 404.
          const manifestPath = `assets/voice/${rel}`;
          const manifest = updateManifest(lineId, { file: manifestPath, duration: +(pcm.length / 2 / sampleRate).toFixed(2), voice: data.voice || '', textHash: hash });
          return json(res, 200, { ok: true, baked: manifestPath, lineId, manifestSize: manifest });
        }
        const file = join(USER_VOICES, `${safeName(data.name || 'clip')}.wav`);
        writeFileSync(file, buf);
        return json(res, 200, { ok: true, saved: basename(file) });
      }

      if (p === '/clone') {
        const script = join(ROOT_DIR, 'scripts', 'voice', 'clone_voice.py');
        if (!existsSync(script)) return json(res, 501, { error: 'cloner script missing' });
        let ref = data.refPath;
        if (data.refWavBase64) { ref = join(CACHE, `ref_${Date.now() | 0}.wav`); writeFileSync(ref, Buffer.from(data.refWavBase64, 'base64')); }
        if (!ref || !data.name) return json(res, 400, { error: 'need refPath/refWavBase64 + name' });
        try {
          execFileSync('python', [script, '--ref', ref, '--name', safeName(data.name), '--out-dir', USER_VOICES], { timeout: 600000, stdio: 'pipe' });
          return json(res, 200, { ok: true, voice: safeName(data.name) });
        } catch (err) {
          return json(res, 501, { error: 'clone failed (Python/torch add-on not installed?)', detail: String(err).slice(0, 300) });
        }
      }
    }
    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, { error: String(err).slice(0, 400) });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`NCLD voice server → http://localhost:${PORT}`);
  console.log(`  voxtral: ${existsSync(BIN) ? 'found' : 'MISSING — run scripts/voice/setup-voxtral or set VOXTRAL_DIR'} (${VOXTRAL_DIR})`);
  console.log(`  voices: ${listVoices().map((v) => v.name).join(', ') || '(none — check voicesDir)'}`);
});

// ── small helpers ────────────────────────────────────────────────────────────
function safeName(s) { return String(s).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 48) || 'clip'; }
function safeList(dir, ext) { try { return readdirSync(dir).filter((f) => f.endsWith(ext)); } catch { return []; } }
function updateManifest(lineId, entry) {
  const file = join(ASSETS_VOICE, 'manifest.json');
  let m = {}; try { m = JSON.parse(readFileSync(file, 'utf8')); } catch { /* new */ }
  m[lineId] = entry;
  mkdirSync(ASSETS_VOICE, { recursive: true });
  writeFileSync(file, JSON.stringify(m, null, 0));
  return Object.keys(m).length;
}
