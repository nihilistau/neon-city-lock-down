// LM Studio proxy for the static server. The browser cannot reach LMStudio
// directly (CORS) and we must not ship the API token to the client, so this
// forwards same-origin /api/llm/* requests to LMStudio's native v1 REST API
// with the bearer token attached server-side.
//
// Config (env overrides, else sensible local defaults):
//   LMS_BASE_URL   default http://127.0.0.1:1234
//   LMS_API_TOKEN  else read from ./lmstudio-api-key.txt
//   LMS_MODEL      substring hint; else the first loaded non-embedding model
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const BASE = (process.env.LMS_BASE_URL || 'http://127.0.0.1:1234').replace(/\/+$/, '');
const MODEL_HINT = process.env.LMS_MODEL || '';
const MODEL_TTL = 30_000;

let _token = null;
async function token() {
  if (_token !== null) return _token;
  _token = process.env.LMS_API_TOKEN || '';
  if (!_token) {
    try { _token = (await readFile(join(ROOT, 'lmstudio-api-key.txt'), 'utf8')).trim(); }
    catch { _token = ''; }
  }
  return _token;
}

function authHeaders(tok, json = true) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}

let _model = null, _modelAt = 0;
/** Resolve the best loaded chat model key (cached). */
async function resolveModel(tok) {
  const now = Date.now();
  if (_model && now - _modelAt < MODEL_TTL) return _model;
  try {
    const r = await fetch(`${BASE}/api/v1/models`, {
      headers: authHeaders(tok, false), signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const raw = data.models ?? data.data ?? (Array.isArray(data) ? data : []);
    const loaded = raw
      .map((m) => ({
        key: m.key || m.id || '',
        loaded: (m.loaded_instances || []).length > 0,
        type: m.type || 'llm',
      }))
      .filter((m) => m.loaded && m.type !== 'embedding');
    let pick = '';
    if (MODEL_HINT) {
      const want = MODEL_HINT.toLowerCase();
      pick = (loaded.find((m) => m.key.toLowerCase().includes(want)) || loaded[0])?.key || '';
    } else {
      pick = loaded[0]?.key || '';
    }
    _model = pick; _modelAt = now;
    return pick;
  } catch {
    return _model || '';
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/** Pull the plain text out of a native v1 /api/v1/chat response. */
function extractContent(data) {
  if (Array.isArray(data.output)) {
    const parts = [];
    for (const item of data.output) {
      const t = item.type || '';
      if (t === 'message' || t === 'text') parts.push(item.content ?? item.text ?? '');
    }
    return parts.join('\n');
  }
  if (data.choices?.length) return data.choices[0]?.message?.content || '';
  return data.content || '';
}

function stripThink(text) {
  if (!text || !text.includes('<think>')) return text;
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
}

/**
 * Handle /api/llm/* . Returns true if the request was ours.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 */
export async function handleLLM(req, res, url) {
  const p = url.pathname;
  if (!p.startsWith('/api/llm/')) return false;
  const tok = await token();

  if (p === '/api/llm/status' && req.method === 'GET') {
    try {
      const r = await fetch(`${BASE}/api/v1/models`, {
        headers: authHeaders(tok, false), signal: AbortSignal.timeout(3000),
      });
      if (r.status === 401 || r.status === 403) { sendJSON(res, 200, { available: false, reason: 'auth', hasToken: !!tok }); return true; }
      const model = r.ok ? await resolveModel(tok) : '';
      sendJSON(res, 200, { available: r.ok && !!model, model, baseUrl: BASE, hasToken: !!tok });
    } catch (e) {
      sendJSON(res, 200, { available: false, reason: String(e.message || e), hasToken: !!tok });
    }
    return true;
  }

  if (p === '/api/llm/chat' && req.method === 'POST') {
    let opts;
    try { opts = JSON.parse(await readBody(req) || '{}'); }
    catch { sendJSON(res, 400, { error: 'bad json' }); return true; }

    const model = await resolveModel(tok);
    if (!model) { sendJSON(res, 503, { error: 'no model loaded' }); return true; }

    const payload = {
      model,
      input: opts.input ?? '',
      stream: false,
    };
    if (opts.system) payload.system_prompt = opts.system;
    if (opts.temperature != null) payload.temperature = opts.temperature;
    if (opts.max_output_tokens != null) payload.max_output_tokens = opts.max_output_tokens;
    if (opts.top_p != null) payload.top_p = opts.top_p;
    if (opts.repeat_penalty != null) payload.repeat_penalty = opts.repeat_penalty;
    // NOTE: native /api/v1/chat rejects a `stop` key (400 unrecognized) — omit it.
    // reasoning omitted when 'off' (native quirk: sending it triggers spec-decode errors)
    if (opts.reasoning && opts.reasoning !== 'off') payload.reasoning = opts.reasoning;

    const timeoutMs = Number(opts.timeout_ms) || 30_000;
    try {
      const t0 = Date.now();
      const r = await fetch(`${BASE}/api/v1/chat`, {
        method: 'POST', headers: authHeaders(tok),
        body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status === 401 || r.status === 403) { sendJSON(res, 502, { error: 'lmstudio auth failed' }); return true; }
      if (!r.ok) { sendJSON(res, 502, { error: `lmstudio HTTP ${r.status}`, detail: (await r.text()).slice(0, 300) }); return true; }
      const data = await r.json();
      const content = stripThink(extractContent(data));
      sendJSON(res, 200, {
        content, model: data.model_instance_id || model,
        latencyMs: Date.now() - t0,
        tokens: data.stats?.total_output_tokens || 0,
      });
    } catch (e) {
      const msg = String(e.name === 'TimeoutError' ? 'timeout' : (e.message || e));
      sendJSON(res, 504, { error: msg });
    }
    return true;
  }

  sendJSON(res, 404, { error: 'unknown llm route' });
  return true;
}
