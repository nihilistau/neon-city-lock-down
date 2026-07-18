// @ts-check
// Browser client for the same-origin lmstudio-engine SSE routes (tools/gameEngine.mjs).
// Streams the roleplay reply token-by-token and receives a structured directive
// object extracted by the function model.

/** Parse an SSE ReadableStream, invoking onEvent(name, data) per frame. */
async function readSSE(resp, onEvent, signal) {
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    if (signal?.aborted) { reader.cancel(); break; }
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, sep); buf = buf.slice(sep + 2);
      let event = 'message', data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
        // ':' comment lines ignored
      }
      if (!data && event === 'message') continue;
      let parsed = null;
      try { parsed = data ? JSON.parse(data) : null; } catch { /* keep null */ }
      onEvent(event, parsed);
    }
  }
}

export class EngineClient {
  constructor() { this._status = { available: false, model: '', checkedAt: 0 }; }

  /** List all downloaded LLMs for the picker. */
  async models() {
    try {
      const r = await fetch('/engine/models', { signal: AbortSignal.timeout(6000) });
      return (await r.json()).models || [];
    } catch { return []; }
  }

  /** Set the engine's default chat/function model keys. */
  async setConfig(cfg) {
    try {
      await fetch('/engine/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg),
      });
    } catch { /* best effort */ }
  }

  async status(force = false) {
    const now = Date.now();
    if (!force && now - this._status.checkedAt < 5000) return this._status;
    try {
      const r = await fetch('/engine/status', { signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      this._status = { available: !!j.ok, model: j.model || '', reason: j.error, checkedAt: now };
    } catch (e) {
      this._status = { available: false, model: '', reason: String(e), checkedAt: now };
    }
    return this._status;
  }

  /**
   * Stream a reply. Calls onFragment(text) as prose streams. Resolves with the
   * finished prose + structured tags + stats.
   * @param {{system:string, input:string, extract?:{zone?:string,name?:string},
   *          temperature?:number, maxTokens?:number, timeoutMs?:number}} req
   * @param {(text:string)=>void} [onFragment]
   * @returns {Promise<{content:string, tags:any, stats:any}|null>}
   */
  async chat(req, onFragment) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 90000);
    let content = '', tags = null, stats = null, replyText = null;
    try {
      const resp = await fetch('/engine/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          system: req.system, input: req.input, extract: req.extract, model: req.model,
          temperature: req.temperature, maxTokens: req.maxTokens,
        }),
        signal: ctrl.signal,
      });
      if (!resp.ok || !resp.body) return null;
      await readSSE(resp, (event, data) => {
        if (event === 'fragment' && data?.text) { content += data.text; onFragment?.(data.text); }
        else if (event === 'reply') { replyText = data?.text ?? content; stats = data?.stats; }
        else if (event === 'tags') { tags = data; }
        else if (event === 'error') { throw new Error(data?.error || 'engine error'); }
      }, ctrl.signal);
      const finalText = (replyText ?? content ?? '').trim();
      if (!finalText) return null;
      return { content: finalText, tags, stats };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
