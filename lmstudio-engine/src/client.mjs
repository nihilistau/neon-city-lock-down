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
    this._chatKey = null;   // resolved concrete key for the empty-key chat role
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
    const p = (async () => {
      const llm = this.client().llm;
      let key = this.cfg.models[role] ?? role;
      // Empty chat key = "whatever's loaded" — but resolve it to a CONCRETE key
      // now so it can be re-loaded after LM Studio's idle-TTL unload (otherwise
      // there's nothing to reload and every call fails with a stale reference).
      if (!key && role === 'chat') {
        key = this._chatKey;
        if (!key) {
          const loaded = await llm.listLoaded();
          const first = loaded.find((m) => (m.type ?? 'llm') !== 'embedding') || loaded[0];
          key = first?.identifier || first?.path || '';
          this._chatKey = key;
        }
      }
      // long TTL keeps the model resident through a play session; the predictor
      // reload-retry covers the case where it's evicted anyway.
      if (!key) return llm.model();
      return llm.model(key, { verbose: this.cfg.verbose, ttl: 24 * 3600 });
    })();
    this._handles.set(role, p);
    p.catch(() => this._handles.delete(role)); // don't cache a rejected handle
    return p;
  }

  /** Point the chat role at a specific model key (from the settings panel). */
  setChatModel(key) {
    this.cfg.models.chat = key || '';
    this._chatKey = key || null;
    this.invalidate('chat');
  }
  setFunctionModel(key) {
    this.cfg.models.function = key || 'google/functiongemma-270m';
    this.invalidate('function');
  }

  /** List loaded models (identifiers). */
  async listLoaded() {
    const loaded = await this.client().llm.listLoaded();
    return loaded.map((m) => ({ identifier: m.identifier, path: m.path }));
  }

  /** List every downloaded LLM: [{key, displayName, loaded, sizeBytes}]. */
  async listAvailable() {
    try {
      const [downloaded, loaded] = await Promise.all([
        this.client().system.listDownloadedModels('llm'),
        this.client().llm.listLoaded(),
      ]);
      const loadedKeys = new Set(loaded.map((m) => m.identifier).concat(loaded.map((m) => m.path)));
      return downloaded.map((m) => ({
        key: m.modelKey ?? m.path ?? m.key ?? '',
        displayName: m.displayName ?? m.modelKey ?? m.path ?? '',
        loaded: loadedKeys.has(m.modelKey) || loadedKeys.has(m.path),
        params: m.paramsString ?? '',
      })).filter((m) => m.key);
    } catch {
      return (await this.listLoaded()).map((m) => ({ key: m.identifier, displayName: m.identifier, loaded: true }));
    }
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
