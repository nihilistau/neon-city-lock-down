// @ts-check
// Engine configuration: resolves the LM Studio connection, auth, model roles,
// and sampling defaults from explicit opts → env → local files → sane defaults.
// Game-agnostic: nothing here knows about the game.
import { readFileSync } from 'node:fs';

/**
 * LM Studio API keys look like `sk-lm-<identifier>:<passkey>`. The WebSocket SDK
 * authenticates with those two parts (NOT a bearer token), so we split them.
 * @param {string} raw
 * @returns {{clientIdentifier:string, clientPasskey:string}|null}
 */
export function parseApiKey(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const m = /^sk-lm-([^:]+):(.+)$/.exec(s);
  if (m) return { clientIdentifier: m[1], clientPasskey: m[2] };
  // fall back: `identifier:passkey` without the sk-lm- prefix
  const i = s.indexOf(':');
  if (i > 0) return { clientIdentifier: s.slice(0, i), clientPasskey: s.slice(i + 1) };
  return null;
}

/** Read the token from an explicit value, env, or a key file. */
function resolveToken({ apiKey, apiKeyFile } = {}) {
  if (apiKey) return apiKey;
  if (process.env.LMS_API_KEY) return process.env.LMS_API_KEY;
  const file = apiKeyFile || process.env.LMS_API_KEY_FILE;
  if (file) {
    try { return readFileSync(file, 'utf8').trim(); } catch { /* ignore */ }
  }
  return '';
}

/**
 * @typedef {Object} EngineConfig
 * @property {string} baseUrl                 ws:// or wss:// URL of LM Studio
 * @property {{clientIdentifier:string, clientPasskey:string}|null} auth
 * @property {Object} models                  role → model key/opts
 * @property {string} models.chat             roleplay model key (substring match ok, '' = whatever's loaded)
 * @property {string} models.function         structured-extraction model key
 * @property {string} [models.draft]          speculative-decoding draft model key
 * @property {Object} sampling                default per-request sampling
 * @property {number} sampling.temperature
 * @property {number} sampling.maxTokens
 * @property {boolean} verbose
 */

/**
 * @param {Partial<EngineConfig> & {apiKey?:string, apiKeyFile?:string}} [opts]
 * @returns {EngineConfig}
 */
export function makeConfig(opts = {}) {
  const token = resolveToken(opts);
  return {
    baseUrl: opts.baseUrl || process.env.LMS_BASE_URL || 'ws://127.0.0.1:1234',
    auth: opts.auth ?? parseApiKey(token),
    models: {
      chat: opts.models?.chat ?? process.env.LMS_CHAT_MODEL ?? '',
      function: opts.models?.function ?? process.env.LMS_FUNCTION_MODEL ?? 'google/functiongemma-270m',
      draft: opts.models?.draft ?? process.env.LMS_DRAFT_MODEL ?? '',
    },
    sampling: {
      temperature: opts.sampling?.temperature ?? 0.85,
      maxTokens: opts.sampling?.maxTokens ?? 320,
      topP: opts.sampling?.topP,
      topK: opts.sampling?.topK,
      minP: opts.sampling?.minP,
      repeatPenalty: opts.sampling?.repeatPenalty,
    },
    // how long a JIT-loaded model stays resident between requests (seconds)
    ttl: opts.ttl ?? 24 * 3600,
    // default <think> reasoning-parsing markers (per-request override wins)
    reasoning: {
      parsing: opts.reasoning?.parsing ?? { enabled: true, startString: '<think>', endString: '</think>' },
    },
    verbose: opts.verbose ?? false,
  };
}
