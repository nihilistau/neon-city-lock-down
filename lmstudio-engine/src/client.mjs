// @ts-check
// LmsClient — a thin, resilient wrapper over @lmstudio/sdk's LMStudioClient.
// Owns the WebSocket connection, resolves model handles by ROLE (chat /
// function / draft), and manages lazy load + caching. Game-agnostic.
import { LMStudioClient } from '@lmstudio/sdk';
import { makeConfig } from './config.mjs';

export class LmsClient {
  /** @param {Parameters<typeof makeConfig>[0]} [opts] */
  constructor(opts = {}) {
    this.cfg = makeConfig(opts);
    /** @type {import('@lmstudio/sdk').LMStudioClient|null} */
    this._client = null;
    /** @type {Map<string, Promise<any>>} role → model-handle promise */
    this._handles = new Map();
    this._connectErr = null;
  }

  /** The underlying SDK client (created lazily). */
  client() {
    if (this._client) return this._client;
    const { baseUrl, auth, verbose } = this.cfg;
    this._client = new LMStudioClient({
      baseUrl,
      ...(auth ? { clientIdentifier: auth.clientIdentifier, clientPasskey: auth.clientPasskey } : {}),
      verboseErrorMessages: verbose,
    });
    return this._client;
  }

  /** Is LM Studio reachable + authenticated? */
  async health() {
    try {
      const loaded = await this.client().llm.listLoaded();
      return { ok: true, loaded: loaded.map((m) => m.identifier) };
    } catch (e) {
      this._connectErr = String(e?.message || e);
      return { ok: false, error: this._connectErr };
    }
  }

  /**
   * Get a model handle for a role. `chat`/`function`/`draft` map to config keys;
   * any other string is treated as a literal model key. Loads on demand (JIT),
   * caches the handle. Empty chat key → whatever LLM is currently loaded.
   * @param {'chat'|'function'|'draft'|string} role
   * @returns {Promise<any>} LLM handle
   */
  async model(role = 'chat') {
    if (this._handles.has(role)) return this._handles.get(role);
    const key = this.cfg.models[role] ?? role;
    const p = (async () => {
      const llm = this.client().llm;
      if (!key) return llm.model(); // currently-loaded model
      return llm.model(key, { verbose: this.cfg.verbose, ttl: 3600 });
    })();
    this._handles.set(role, p);
    // don't cache a rejected handle
    p.catch(() => this._handles.delete(role));
    return p;
  }

  /** List loaded models (identifiers). */
  async listLoaded() {
    const loaded = await this.client().llm.listLoaded();
    return loaded.map((m) => ({ identifier: m.identifier, path: m.path }));
  }

  /** Resolve the display name of the active chat model (for status). */
  async chatModelName() {
    try {
      const m = await this.model('chat');
      return (await m.getModelInfo())?.displayName || '';
    } catch { return ''; }
  }

  /** Drop a cached handle (e.g. after a model unload). */
  invalidate(role) { this._handles.delete(role); }
}
