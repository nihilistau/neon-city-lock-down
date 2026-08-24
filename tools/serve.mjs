// Tiny static server for Neon-City: Lock-Down. Node stdlib only.
// Usage: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { stat, open } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleLLM } from './llmProxy.mjs';
import { handleEngine } from './gameEngine.mjs';
import { handleConfig } from './configApi.mjs';
import { handleUser } from './userApi.mjs';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const PORT = Number(process.argv[2] || 8420);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  // v0.4 shipped 25 .jpg assets and 10 config .yaml files with no entry here, so
  // every one was served as application/octet-stream. It only worked because
  // browsers content-sniff <img>; any nosniff header, CDN, or fetch()-based
  // loader would have broken every icon, face, fabric and the skyline.
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // lmstudio-engine: SDK-based streaming + structured-tag engine (SSE)
    if (url.pathname.startsWith('/engine/')) {
      if (await handleEngine(req, res, url)) return;
    }
    // legacy LM Studio REST proxy (kept as a fallback path)
    if (url.pathname.startsWith('/api/llm/')) {
      if (await handleLLM(req, res, url)) return;
    }
    // engine config read/write (creation kit)
    if (url.pathname.startsWith('/api/config')) {
      if (await handleConfig(req, res, url)) return;
    }
    // user-authored content (scenario creation toolkit)
    if (url.pathname.startsWith('/api/user')) {
      if (await handleUser(req, res, url)) return;
    }
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }

    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404).end('not found'); return; }

    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    // vendor + generated audio may cache; live source must not
    const cache = /[\\/](vendor|assets)[\\/]/.test(file) ? 'max-age=3600' : 'no-store';
    const headers = { 'Content-Type': type, 'Cache-Control': cache, 'Accept-Ranges': 'bytes' };

    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0, end = info.size - 1, code = 200;
    if (range && (range[1] || range[2])) {
      start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : end;
      if (start > end || start >= info.size) { res.writeHead(416).end(); return; }
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      code = 206;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(code, headers);

    const fh = await open(file, 'r');
    const stream = fh.createReadStream({ start, end });
    stream.pipe(res);
    stream.on('close', () => fh.close());
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
}).on('error', (err) => {
  // A bare throw here printed a listen stack trace and — since run.bat has no
  // pause — closed the console window before anyone could read it.
  if (/** @type {any} */ (err).code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
    console.error('Another copy of the server is probably running.');
    console.error(`Close it, or start on another port:  node tools/serve.mjs ${PORT + 1}`);
  } else {
    console.error('Server failed to start:', err.message);
  }
  process.exit(1);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Neon-City: Lock-Down  →  http://localhost:${PORT}`);
});
