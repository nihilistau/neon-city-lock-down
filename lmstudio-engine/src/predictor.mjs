// @ts-check
// Predictor — low-level generation over a model handle. Wraps the SDK's
// OngoingPrediction: streams SPEECH fragments (separating out reasoning tokens
// from thinking models), resolves final text + stats, and does JSON-schema /
// zod structured extraction. Knows nothing about the game or tags.
import { Chat } from '@lmstudio/sdk';

// Some "thinking" GGUFs leak chain-of-thought into the content channel, bracketed
// by LM Studio's synthetic-reasoning separators. Keep only the post-reasoning
// answer and scrub the internal markers.
const REASON_END = /__LM_STUDIO_INTERNAL[_A-Za-z0-9]*?(?:SYNTHETIC_)?REASONING_END[_A-Za-z0-9]*?__/;
export function stripReasoningArtifacts(text) {
  let out = String(text || '');
  const parts = out.split(REASON_END);
  if (parts.length > 1) out = parts[parts.length - 1];
  out = out.replace(/__LM_STUDIO_INTERNAL[_A-Za-z0-9]*?__/g, '');
  out = out.replace(/<\/?think>/gi, '');
  // a leading "Thinking Process:" / "Reasoning:" block only when no marker split happened
  if (parts.length === 1) out = out.replace(/^\s*(thinking process|thinking|reasoning|let me think|first,? i)\b[\s\S]*?\n\s*\n/i, '');
  return out.trim();
}

/** Build a Chat from a system prompt + input (string or message array). */
export function toChat(system, input) {
  const chat = Chat.empty();
  if (system) chat.append('system', system);
  if (Array.isArray(input)) {
    for (const m of input) chat.append(m.role || 'user', m.content ?? '');
  } else if (input) {
    chat.append('user', String(input));
  }
  return chat;
}

/** LM Studio can unload a model mid-session (idle TTL); the cached handle then
 *  throws. Detect that so we can drop the handle and re-resolve. */
function isStaleHandle(err) {
  const m = String(err?.message || err);
  return /instance reference|already been unloaded|no longer loaded|cannot find model|not loaded/i.test(m);
}

export class Predictor {
  /** @param {import('./client.mjs').LmsClient} client */
  constructor(client) { this.client = client; }

  /** Run `fn(model)` for a role; if the handle is stale, invalidate + reload once. */
  async _withModel(role, fn) {
    let model = await this.client.model(role);
    try {
      return await fn(model);
    } catch (err) {
      if (!isStaleHandle(err)) throw err;
      this.client.invalidate(role);
      model = await this.client.model(role);   // re-resolves / re-loads (JIT)
      return fn(model);
    }
  }

  /**
   * Streaming generation. Calls `onFragment(text, {reasoning})` per fragment
   * (speech and, if you want them, reasoning tokens tagged reasoning:true).
   * @param {Object} o
   * @param {'chat'|'function'|string} [o.role]
   * @param {string} [o.system]
   * @param {string|Array} o.input
   * @param {number} [o.temperature] @param {number} [o.maxTokens]
   * @param {string} [o.draftModel] @param {string[]} [o.stopStrings]
   * @param {AbortSignal} [o.signal]
   * @param {(text:string, meta:{reasoning:boolean})=>void} [onFragment]
   * @returns {Promise<{content:string, reasoning:string, stats:any}>}
   */
  async stream(o, onFragment) {
    const chat = toChat(o.system, o.input);
    return this._withModel(o.role || 'chat', async (model) => {
      const pred = model.respond(chat, this._opts(o));
      let content = '', reasoning = '';
      for await (const frag of pred) {
        const isReasoning = frag.reasoningType && frag.reasoningType !== 'none';
        if (isReasoning) { reasoning += frag.content; onFragment?.(frag.content, { reasoning: true }); }
        else { content += frag.content; onFragment?.(frag.content, { reasoning: false }); }
      }
      const result = await pred.result();
      return { content: stripReasoningArtifacts(result.content ?? content), reasoning, stats: result.stats };
    });
  }

  /** Non-streaming convenience. */
  async respond(o) { return this.stream(o); }

  /**
   * Structured extraction: force the model to emit JSON matching `schema`
   * (a zod schema → typed `.parsed`, or a raw JSON schema → parsed content).
   * Defaults to the `function` role (small fast constrained model).
   * @param {Object} o
   * @param {'chat'|'function'|string} [o.role]
   * @param {string} [o.system] @param {string|Array} o.input
   * @param {any} o.schema  zod schema or {jsonSchema}
   * @param {number} [o.maxTokens] @param {number} [o.temperature]
   * @param {AbortSignal} [o.signal]
   * @returns {Promise<any>} parsed object, or null on failure
   */
  async structured(o) {
    const chat = toChat(o.system, o.input);
    const structured = o.schema?.jsonSchema
      ? { type: 'json', jsonSchema: o.schema.jsonSchema }
      : o.schema;
    try {
      return await this._withModel(o.role || 'function', async (model) => {
        const res = await model.respond(chat, {
          structured,
          maxTokens: o.maxTokens ?? 200,
          temperature: o.temperature ?? 0.2,
          signal: o.signal,
        });
        if (res.parsed !== undefined) return res.parsed;
        try { return JSON.parse(res.content); } catch { return null; }
      });
    } catch {
      return null;
    }
  }

  _opts(o) {
    /** @type {any} */
    const opts = {
      temperature: o.temperature ?? 0.85,
      maxTokens: o.maxTokens ?? 320,
      signal: o.signal,
      // always split <think> reasoning out of content so a thinking model's
      // chain-of-thought never lands in the reply text
      reasoningParsing: { enabled: true, startString: '<think>', endString: '</think>' },
    };
    if (o.draftModel) opts.draftModel = o.draftModel;
    if (o.stopStrings?.length) opts.stopStrings = o.stopStrings;
    return opts;
  }
}
