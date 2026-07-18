// @ts-check
// The character agent: given a character + the guest's line + world context,
// asks the LLM to AUTHOR the character's reply (dialogue + inline scene tags),
// then cleans it so it's safe to run through the authored compile→dispatch
// pipeline. Returns null on any failure so the caller falls back to the
// authored engine — gates/consent/explicitness always remain authoritative.

import { LMSClient } from './lmsClient.js';
import { buildSystemPrompt, buildUserTurn } from './promptBuilder.js';
import { cleanReply } from './tags.js';
import { settings } from '../../core/settings.js';

export class CharacterAgent {
  constructor() {
    this.client = new LMSClient();
    this._available = false;
    this._probed = false;
  }

  get enabled() { return !!(settings.llm?.enabled && settings.llm?.agentMode); }

  /** Probe the proxy; caches for the session unless forced. */
  async probe(force = false) {
    if (this._probed && !force) return this._available;
    const s = await this.client.status(force);
    this._available = s.available;
    this._probed = true;
    return this._available;
  }

  /**
   * Generate an in-character reply.
   * @param {import('../../chars/character.js').Character} char
   * @param {string} playerText
   * @param {any} ctx  scene context (present cast, zone, lighting, combat, …)
   * @param {{playerLines?:string[], lastReply?:string}} hist
   * @param {{whisper?:boolean}} [opts]
   * @returns {Promise<string|null>} sanitized reply text with tags, or null
   */
  async respond(char, playerText, ctx, hist, opts = {}) {
    if (!this.enabled) return null;
    if (!(await this.probe())) return null;

    const system = buildSystemPrompt(char, ctx);
    const input = buildUserTurn(playerText, hist, { whisper: opts.whisper, playerName: ctx.playerName });
    const heated = char.stats.arousal >= 55 || char.gates?.intimate === 'granted' || ctx.combat?.active;

    const res = await this.client.generate({
      system, input,
      temperature: settings.llm?.temperature ?? 0.85,
      maxTokens: heated ? 420 : 240,
      reasoning: settings.llm?.reasoning ?? 'off',
      stop: ['\nThe guest says', '\nGuest:', '\n\n\n'],
      timeoutMs: 30000,
    });
    if (!res) return null;

    const others = (ctx.present || []).filter((c) => c.id !== char.id).map((c) => c.name);
    const clean = cleanReply(res.content, { playerName: ctx.playerName, otherNames: others });
    // reject empties / refusal-shaped / prompt echoes
    if (!clean || clean.length < 2) return null;
    if (/^(i cannot|i can't|i'm sorry|as an ai|i am unable)/i.test(clean)) return null;
    return clean;
  }
}
