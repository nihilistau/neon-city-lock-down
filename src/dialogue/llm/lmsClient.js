// @ts-check
// Client-side LM Studio access. Talks to the SAME-ORIGIN proxy in
// tools/serve.mjs (which forwards to LMStudio's native v1 API with the token
// attached server-side). The browser never sees the API key and never hits a
// cross-origin endpoint.

export class LMSClient {
  constructor() {
    this._status = { available: false, model: '', checkedAt: 0 };
    /** @type {Promise<any>} serializes generations — LMStudio runs one at a time */
    this._chain = Promise.resolve();
  }

  /** Cached-ish availability probe (5s TTL). @returns {Promise<{available:boolean, model:string, reason?:string}>} */
  async status(force = false) {
    const now = Date.now();
    if (!force && now - this._status.checkedAt < 5000) return this._status;
    try {
      const r = await fetch('/api/llm/status', { signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      this._status = { available: !!j.available, model: j.model || '', reason: j.reason, checkedAt: now };
    } catch (e) {
      this._status = { available: false, model: '', reason: String(e), checkedAt: now };
    }
    return this._status;
  }

  /**
   * Generate a completion. Non-streaming: resolves with the full text.
   * @param {{system?:string, input:string, temperature?:number,
   *          maxTokens?:number, reasoning?:string, stop?:string[], timeoutMs?:number}} opts
   * @returns {Promise<{content:string, latencyMs:number, tokens:number}|null>} null on failure
   */
  async generate(opts) {
    // Serialize: chain each call after the previous so LMStudio never sees
    // overlapping generations (it rejects concurrent requests with a 502).
    const run = this._chain.then(() => this._generate(opts), () => this._generate(opts));
    this._chain = run.catch(() => {});
    return run;
  }

  async _generate(opts) {
    try {
      const r = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: opts.system,
          input: opts.input,
          temperature: opts.temperature ?? 0.85,
          max_output_tokens: opts.maxTokens ?? 320,
          reasoning: opts.reasoning ?? 'off',
          stop: opts.stop,
          timeout_ms: opts.timeoutMs ?? 30000,
        }),
        signal: AbortSignal.timeout((opts.timeoutMs ?? 30000) + 2000),
      });
      if (!r.ok) return null;
      const j = await r.json();
      if (!j.content) return null;
      return { content: j.content, latencyMs: j.latencyMs || 0, tokens: j.tokens || 0 };
    } catch {
      return null;
    }
  }
}
