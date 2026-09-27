// @ts-check
// The character agent. Preferred path: the lmstudio-engine (SDK) — the big model
// STREAMS clean in-character prose while a tiny function model reads that prose
// into structured scene directives we inject ourselves. Fallback path: the
// legacy REST proxy where the model emits inline [[tags]] we sanitize.
//
// Either way respond() returns { text, directions } (or null → authored engine).
// The model shifts only its own character's stats; the bond is derived, never set by it.
import { EngineClient } from './engineClient.js';
import { LMSClient } from './lmsClient.js';
import { buildSystemPrompt, buildUserTurn } from './promptBuilder.js';
import { cleanReply, sanitizeTags, scrubPuppeting, mapStructuredTags } from './tags.js';
import { settings } from '../../core/settings.js';
import { cfg } from '../../core/config.js';   // token budgets → config/llm.yaml (sampling knobs applied server-side)

const ZONE_OF = {
  lounge: 'lounge', fireplace: 'fireplace nook', bar: 'bar', balcony: 'balcony',
  bed_alcove: 'bed alcove', vanity: 'dressing table', shower: 'shower pod',
};

export class CharacterAgent {
  constructor() {
    this.engine = new EngineClient();
    this.rest = new LMSClient();         // legacy inline-tag fallback
    this._mode = null;                   // 'engine' | 'rest' | null
    this._probed = false;
  }

  get enabled() { return !!settings.llm?.enabled; }

  /** Per-character interaction mode: 'agent' | 'rewrite' | 'authored'. */
  mode(id) {
    return settings.llm?.charModes?.[id] || (settings.llm?.agentMode ? 'agent' : 'rewrite');
  }
  _modelKey(id) {
    const k = settings.llm?.charModels?.[id];
    return k && k !== 'default' && k !== 'authored' ? k : undefined;
  }

  /** Probe engine first, then the legacy proxy. Caches the working mode. */
  async probe(force = false) {
    if (this._probed && !force) return !!this._mode;
    const es = await this.engine.status(force);
    if (es.available) { this._mode = 'engine'; this._probed = true; return true; }
    const rs = await this.rest.status(force);
    this._mode = rs.available ? 'rest' : null;
    this._probed = true;
    return !!this._mode;
  }

  /** @returns {Promise<{model:string, mode:string}|{available:false}>} */
  async info(force = false) {
    await this.probe(force);
    if (this._mode === 'engine') return { mode: 'engine', model: (await this.engine.status()).model };
    if (this._mode === 'rest') return { mode: 'rest', model: (await this.rest.status()).model };
    return { available: false };
  }

  /**
   * @param {import('../../chars/character.js').Character} char
   * @param {string} playerText @param {any} ctx @param {{playerLines?:string[], lastReply?:string}} hist
   * @param {{whisper?:boolean, onFragment?:(t:string)=>void}} [opts]
   * @returns {Promise<{text:string, directions:any[]}|null>}
   */
  async respond(char, playerText, ctx, hist, opts = {}) {
    if (!this.enabled) return null;
    if (!(await this.probe())) return null;
    const others = (ctx.present || []).filter((c) => c.id !== char.id).map((c) => c.name);
    const scrubCtx = { playerName: ctx.playerName, otherNames: others };
    const heated = char.stats.tension >= 60 || !!ctx.combat?.active;
    // Budget must cover a THINKING model's reasoning + the reply (it stops at EOS
    // well before this if it's a plain instruct model, so the cap is safe for both).
    const maxTokens = heated ? cfg('llm.budgets.heated', 2200) : cfg('llm.budgets.normal', 1600);

    const modelKey = this._modelKey(char.id);
    const think = settings.llm?.thinking === true;

    if (this._mode === 'engine') {
      const system = buildSystemPrompt(char, { ...ctx, emitTags: false }) + (think ? '' : '\n/no_think');
      const input = buildUserTurn(playerText, hist, { whisper: opts.whisper, action: opts.action, playerName: ctx.playerName });
      const res = await this.engine.chat(
        { system, input, model: modelKey, temperature: settings.llm?.temperature ?? 0.85, maxTokens,
          extract: { zone: ZONE_OF[char.queue?.zone] || '', name: char.name } },
        opts.onFragment);
      if (!res) return null;
      const text = sanitizeTags(scrubPuppeting(res.content, scrubCtx));
      if (!this._valid(text)) return null;
      return { text, directions: mapStructuredTags(res.tags, text.length) };
    }

    // legacy inline-tag path
    const system = buildSystemPrompt(char, { ...ctx, emitTags: true });
    const input = buildUserTurn(playerText, hist, { whisper: opts.whisper, action: opts.action, playerName: ctx.playerName });
    const res = await this.rest.generate({
      system, input, temperature: settings.llm?.temperature ?? 0.85, maxTokens,
      reasoning: settings.llm?.reasoning ?? 'off', timeoutMs: 30000,
    });
    if (!res) return null;
    const text = cleanReply(res.content, scrubCtx);
    if (!this._valid(text)) return null;
    return { text, directions: [] };  // inline [[tags]] compiled downstream
  }

  /**
   * Rewrite mode: keep the authored line's meaning but restyle it in the
   * character's voice via the engine. Returns new text or null.
   * @param {import('../../chars/character.js').Character} char
   * @param {string} cleanText @param {any} ctx
   */
  async rewrite(char, cleanText, ctx) {
    if (!this.enabled || this._mode !== 'engine') return null;
    if (!(await this.probe())) return null;
    const think = settings.llm?.thinking === true;
    const system = buildSystemPrompt(char, { ...ctx, emitTags: false })
      + '\nRewrite the given line in your own voice — SAME meaning and roughly the same length, first person. Output ONLY the rewritten line, nothing else.'
      + (think ? '' : '\n/no_think');
    const res = await this.engine.chat(
      { system, input: `Line: "${cleanText}"`, model: this._modelKey(char.id),
        temperature: settings.llm?.temperature ?? 0.85, maxTokens: think ? cfg('llm.budgets.normal', 1600) : cfg('llm.budgets.rewrite', 300) },
      null);
    if (!res) return null;
    const others = (ctx.present || []).filter((c) => c.id !== char.id).map((c) => c.name);
    const text = sanitizeTags(scrubPuppeting(res.content, { playerName: ctx.playerName, otherNames: others }))
      .replace(/^(line|rewritten|response)\s*:\s*/i, '').replace(/^["']|["']$/g, '');
    return this._valid(text) ? text : null;
  }

  _valid(text) {
    if (!text || text.length < 2) return false;
    if (/^(i cannot|i can't|i'm sorry|as an ai|i am unable)/i.test(text)) return false;
    return true;
  }

  /** back-compat: some callers used `.client.status()` */
  get client() { return this._mode === 'rest' ? this.rest : this.engine; }
}
