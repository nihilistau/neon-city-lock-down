// @ts-check
// Optional live-TTS sidecar: a tiny HTTP server wrapping the voxtral CLI so the
// game can voice dynamic (un-baked / LLM-rewritten) lines at runtime. Node stdlib
// only. Start it before playing if you want live speech:
//   node tools/sidecar.mjs [port]
//
// GET  /health        -> { ok:true, voices:[...] }
// POST /speak {text, voice} -> audio/wav
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const PORT = Number(process.argv[2] || 8425);
const VOXTRAL_DIR = process.env.VOXTRAL_DIR || 'D:/F/shannon-prime-repos/voxtral-mini-realtime-rs';
const VOXTRAL_BIN = join(VOXTRAL_DIR, 'target/release/voxtral.exe');
const GGUF = 'models/voxtral-tts-q4.gguf';
const VOICES = ['neutral_female', 'cheerful_female', 'casual_male', 'neutral_male', 'casual_female'];
const CACHE = join(tmpdir(), 'ncld-sidecar');
mkdirSync(CACHE, { recursive: true });

function speak(text, voice) {
  const h = createHash('sha1').update(`${voice}|${text}`).digest('hex').slice(0, 16);
  const out = join(CACHE, `${h}.wav`);
  if (!existsSync(out)) {
    execFileSync(VOXTRAL_BIN, [
      'speak', '--text', text, '--gguf', GGUF, '--voice', voice,
      '--output', out, '--euler-steps', '3',
    ], { cwd: VOXTRAL_DIR, stdio: 'ignore', timeout: 120000 });
  }
  return readFileSync(out);
}

createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({ ok: existsSync(VOXTRAL_BIN), voices: VOICES }));
    return;
  }
  if (req.url === '/speak' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { text, voice } = JSON.parse(body);
        if (!text) { res.writeHead(400, cors).end('missing text'); return; }
        const wav = speak(String(text).slice(0, 400), VOICES.includes(voice) ? voice : 'casual_female');
        res.writeHead(200, { 'Content-Type': 'audio/wav', ...cors });
        res.end(wav);
      } catch (err) {
        res.writeHead(500, cors).end(String(err));
      }
    });
    return;
  }
  res.writeHead(404, cors).end();
}).listen(PORT, '127.0.0.1', () => {
  console.log(`NCLD TTS sidecar → http://localhost:${PORT}  (voxtral: ${existsSync(VOXTRAL_BIN) ? 'found' : 'MISSING'})`);
});
