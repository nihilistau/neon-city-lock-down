// @ts-check
// Predictor — low-level generation over a model handle. Wraps the SDK's
// OngoingPrediction: streams SPEECH fragments (separating out reasoning tokens
// from thinking models), resolves final text + stats, and does JSON-schema /
// zod structured extraction. Knows nothing about the game or tags.
import { Chat } from '@lmstudio/sdk';

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

export class Predictor {
  /** @param {import('./client.mjs').LmsClient} client */
  constructor(client) { this.client = client; }

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
    const model = await this.client.model(o.role || 'chat');
    const chat = toChat(o.system, o.input);
    const pred = model.respond(chat, this._opts(o));
    let content = '', reasoning = '';
    for await (const frag of pred) {
      const isReasoning = frag.reasoningType && frag.reasoningType !== 'none';
      if (isReasoning) { reasoning += frag.content; onFragment?.(frag.content, { reasoning: true }); }
      else { content += frag.content; onFragment?.(frag.content, { reasoning: false }); }
    }
    const result = await pred.result();
    return { content: result.content ?? content, reasoning, stats: result.stats };
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
    const model = await this.client.model(o.role || 'function');
    const chat = toChat(o.system, o.input);
    const structured = o.schema?.jsonSchema
      ? { type: 'json', jsonSchema: o.schema.jsonSchema }
      : o.schema;
    try {
      const res = await model.respond(chat, {
        structured,
        maxTokens: o.maxTokens ?? 200,
        temperature: o.temperature ?? 0.2,
        signal: o.signal,
      });
      if (res.parsed !== undefined) return res.parsed;
      try { return JSON.parse(res.content); } catch { return null; }
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
    };
    if (o.draftModel) opts.draftModel = o.draftModel;
    if (o.stopStrings?.length) opts.stopStrings = o.stopStrings;
    return opts;
  }
}
