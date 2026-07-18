// Tiny static server for Neon-City: Lock-Down. Node stdlib only.
// Usage: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { stat, open } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleLLM } from './llmProxy.mjs';

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
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // LM Studio proxy (same-origin; keeps the API token server-side)
    if (url.pathname.startsWith('/api/llm/')) {
      if (await handleLLM(req, res, url)) return;
    }
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }

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
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Neon-City: Lock-Down  →  http://localhost:${PORT}`);
});
