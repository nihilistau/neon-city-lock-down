// @ts-check
// The character agent. Preferred path: the lmstudio-engine (SDK) — the big model
// STREAMS clean in-character prose while a tiny function model reads that prose
// into structured scene directives we inject ourselves. Fallback path: the
// legacy REST proxy where the model emits inline [[tags]] we sanitize.
//
// Either way respond() returns { text, directions } (or null → authored engine).
// Gates/consent/explicitness always stay authoritative.
import { EngineClient } from './engineClient.js';
import { LMSClient } from './lmsClient.js';
import { buildSystemPrompt, buildUserTurn } from './promptBuilder.js';
import { cleanReply, sanitizeTags, scrubPuppeting, mapStructuredTags } from './tags.js';
import { settings } from '../../core/settings.js';

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

  get enabled() { return !!(settings.llm?.enabled && settings.llm?.agentMode); }

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
    const heated = char.stats.arousal >= 55 || char.gates?.intimate === 'granted' || ctx.combat?.active;
    const maxTokens = heated ? 420 : 240;

    if (this._mode === 'engine') {
      const system = buildSystemPrompt(char, { ...ctx, emitTags: false });
      const input = buildUserTurn(playerText, hist, { whisper: opts.whisper, playerName: ctx.playerName });
      const res = await this.engine.chat(
        { system, input, temperature: settings.llm?.temperature ?? 0.85, maxTokens,
          extract: { zone: ZONE_OF[char.queue?.zone] || '', name: char.name } },
        opts.onFragment);
      if (!res) return null;
      const text = sanitizeTags(scrubPuppeting(res.content, scrubCtx));
      if (!this._valid(text)) return null;
      return { text, directions: mapStructuredTags(res.tags, text.length) };
    }

    // legacy inline-tag path
    const system = buildSystemPrompt(char, { ...ctx, emitTags: true });
    const input = buildUserTurn(playerText, hist, { whisper: opts.whisper, playerName: ctx.playerName });
    const res = await this.rest.generate({
      system, input, temperature: settings.llm?.temperature ?? 0.85, maxTokens,
      reasoning: settings.llm?.reasoning ?? 'off', timeoutMs: 30000,
    });
    if (!res) return null;
    const text = cleanReply(res.content, scrubCtx);
    if (!this._valid(text)) return null;
    return { text, directions: [] };  // inline [[tags]] compiled downstream
  }

  _valid(text) {
    if (!text || text.length < 2) return false;
    if (/^(i cannot|i can't|i'm sorry|as an ai|i am unable)/i.test(text)) return false;
    return true;
  }

  /** back-compat: some callers used `.client.status()` */
  get client() { return this._mode === 'rest' ? this.rest : this.engine; }
}
