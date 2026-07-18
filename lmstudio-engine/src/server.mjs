// @ts-check
// EngineServer — a tiny route registry + dispatcher that mounts the engine's
// capabilities onto any Node http server. Game-agnostic: the app registers
// route handlers that use the engine however it likes (persona rendering, tag
// schema, etc. stay in the app). Handlers get the parsed JSON body and a
// context with `{ req, res, sse, signal }` — return true when handled.
import { openSSE } from './sse.mjs';

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

export class EngineServer {
  /** @param {import('./engine.mjs').Engine} engine @param {{prefix?:string}} [opts] */
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.prefix = opts.prefix ?? '/engine';
    /** @type {Map<string, (body:any, cx:any)=>Promise<any>|any>} */
    this.routes = new Map();

    // built-in status route
    this.route('GET', '/status', async () => this.engine.health());
  }

  /** Register `METHOD /path` (path is relative to prefix). */
  route(method, path, handler) {
    this.routes.set(`${method} ${path}`, handler);
    return this;
  }

  /**
   * Dispatch a request. Returns true if it matched an engine route.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {URL} url
   */
  async handle(req, res, url) {
    if (!url.pathname.startsWith(this.prefix + '/')) return false;
    const sub = url.pathname.slice(this.prefix.length);
    const handler = this.routes.get(`${req.method} ${sub}`);
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown engine route', route: `${req.method} ${sub}` }));
      return true;
    }
    const body = req.method === 'POST' ? await readBody(req) : {};
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    const isSSE = url.searchParams.get('sse') === '1' || req.headers.accept?.includes('text/event-stream');
    const sse = isSSE ? openSSE(res) : null;
    const cx = { req, res, url, sse, signal: controller.signal };
    try {
      const out = await handler(body, cx);
      if (sse) { sse.end(); return true; }
      if (!res.headersSent) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(out ?? { ok: true }));
      } else if (!res.writableEnded) res.end();
    } catch (e) {
      const msg = String(e?.message || e);
      if (sse) { sse.send('error', { error: msg }); sse.end(); }
      else if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: msg })); }
      else if (!res.writableEnded) res.end();
    }
    return true;
  }
}
