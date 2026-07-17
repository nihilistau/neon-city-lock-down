// @ts-check
// Dialogue turn orchestrator. Player input → normalize → intents + tone →
// addressee → topic → line variant → effects → output (with stage directions).
// The LLM adapter (P3) may replace cleanText only; authored effects/directions
// stay authoritative.

import { normalize } from './parser/normalize.js';
import { matchIntents, captureSlots } from './parser/intents.js';
import { toneOf, dominantTone } from './parser/tone.js';
import { candidateTopics } from './topics.js';
import { selectLine } from './selector.js';
import { applyLineEffects } from './effects.js';
import { selectFallback } from './interject.js';
import { makeDispatcher, compileLine } from './stageDirections.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';

export class DialogueEngine {
  /**
   * @param {Object} deps
   * @param {Record<string, import('../chars/character.js').Character>} deps.cast
   * @param {() => number} deps.nowMinute
   * @param {() => number} deps.day
   * @param {import('../core/rng.js').RngStream} deps.rng
   * @param {Object} deps.stageCtx  world/lighting/audio/cutscene for dispatch
   * @param {{chars?:string[], zones?:string[], items?:string[]}} deps.vocab
   * @param {import('./llmAdapter.js').LLMAdapter} [deps.llm]
   * @param {import('./ttsRouter.js').TtsRouter} [deps.tts]
   */
  constructor(deps) {
    this.cast = deps.cast;
    this.nowMinute = deps.nowMinute;
    this.day = deps.day;
    this.rng = deps.rng;
    this.stageCtx = deps.stageCtx;
    this.vocab = deps.vocab;
    this.llm = deps.llm;
    this.tts = deps.tts;
    /** @type {string|null} who the player is addressing ('room' or a char id) */
    this.addressee = null;
  }

  /**
   * Process one player utterance.
   * @param {string} rawText
   * @param {string} [target] explicit addressee (char id) or 'room'
   * @param {{whisper?: boolean}} [opts]
   * @returns {Promise<{speaker:string, line:any}[]>}
   */
  async playerSays(rawText, target, opts = {}) {
    const n = normalize(rawText);
    const intents = matchIntents(n);
    const slots = captureSlots(n, this.vocab);
    const tone = toneOf(n);
    const dtone = dominantTone(tone);

    emit('chat.player', { text: rawText, target, whisper: !!opts.whisper });
    feed(opts.whisper
      ? `${this.stageCtx.playerName || 'You'} whispers to ${target}…`
      : `${this.stageCtx.playerName || 'You'}: ${rawText}`, 'dialogue');

    const present = this._presentCast();
    const addressed = this._resolveAddressee(target, slots, intents, present);
    if (!addressed) return [];

    // a whisper is intimate by nature: closeness bonus before the reply lands
    if (opts.whisper) {
      addressed.applyStats({ trust: 1.5, arousal: 1 }, 'whisper');
    }

    const replies = [];
    const primary = await this._respond(addressed, intents, tone, dtone);
    if (primary) replies.push({ speaker: addressed.id, line: primary });

    // bystander interjection (room mode only, never for whispers)
    if (!opts.whisper && (target === 'room' || !target) && present.length > 1 && this.rng.chance(0.4)) {
      const others = present.filter((c) => c !== addressed);
      const bystander = this.rng.pick(others);
      const inter = await this._respond(bystander, intents, tone, dtone, true);
      if (inter) replies.push({ speaker: bystander.id, line: inter });
    }

    return replies;
  }

  /**
   * Director "give line": the character says the text verbatim (stage tags OK).
   * @param {string} charId @param {string} rawText
   */
  forceSay(charId, rawText) {
    const char = this.cast[charId];
    if (!char) throw new Error(`unknown character: ${charId}`);
    const compiled = compileLine(rawText);
    this._perform(char, compiled, { _key: `director:${this.nowMinute()}` });
  }

  _presentCast() {
    // slice: everyone is co-located; later filter by shared zone with the player
    return Object.values(this.cast).filter((c) => c.alive);
  }

  _resolveAddressee(target, slots, intents, present) {
    if (target && target !== 'room' && this.cast[target]) return this.cast[target];
    if (slots.char && this.cast[slots.char]) return this.cast[slots.char];
    if (this.addressee && this.cast[this.addressee] && target !== 'room') return this.cast[this.addressee];
    // room mode: best responder scores intents against their own topics
    let best = null, bestScore = -Infinity;
    for (const c of present) {
      const cands = candidateTopics(c, intents, { day: this.day() });
      const sc = cands.length ? cands[0].score : (c.compliance / 100);
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    return best || present[0] || null;
  }

  /**
   * @param {import('../chars/character.js').Character} char
   * @param {any[]} intents @param {any} tone @param {string} dtone
   * @param {boolean} [isInterjection]
   */
  async _respond(char, intents, tone, dtone, isInterjection = false) {
    const now = this.nowMinute();
    char.setPlayerDominance(this.stageCtx.playerDominance ?? 55);

    const cands = candidateTopics(char, intents, { day: this.day() });
    let topic = null, line = null;

    if (cands.length && (!isInterjection || cands[0].score > 3)) {
      topic = cands[0].topic;
      line = selectLine(topic, char, now, this.rng);
    }

    if (!line) {
      // fallback ladder keyed by tone
      const fb = selectFallback(char.id, dtone, this.rng, char);
      if (!fb) return null;
      // synthesize a throwaway line object carrying the compiled fallback
      line = { compiled: fb, _key: `fb:${char.id}:${dtone}`, fx: null };
      topic = { id: `fallback:${dtone}`, effects: null };
    } else {
      applyLineEffects(char, line, topic, { tone, nowMinute: now });
    }

    // optional LLM surface rewrite (authored effects already applied)
    let compiled = line.compiled;
    if (compiled.cleanText.includes('{player}')) {
      compiled = {
        cleanText: compiled.cleanText.replace(/\{player\}/g, this.stageCtx.playerName || 'you'),
        directions: compiled.directions,
      };
    }
    if (this.llm?.enabled && !isInterjection) {
      const rewritten = await this.llm.rewrite(char, compiled.cleanText, { tone });
      if (rewritten) compiled = { cleanText: rewritten, directions: compiled.directions };
    }

    this._perform(char, compiled, line);
    return { ...line, compiled, topic: topic.id, branches: topic.branches };
  }

  /**
   * Emit the line to UI + fire stage directions + route TTS.
   * @param {import('../chars/character.js').Character} char
   * @param {import('../core/types.js').CompiledLine} compiled
   */
  _perform(char, compiled, line) {
    const dispatch = makeDispatcher({
      speaker: char, cast: this.cast, ...this.stageCtx,
      nowMinute: this.nowMinute(),
    });
    // face the player while speaking
    if (this.stageCtx.playerMarker) char.actor.lookAt(this.stageCtx.playerMarker);

    emit('chat.reply', {
      speaker: char.id, name: char.name,
      accent: char.persona.accent,
      compiled, lineKey: line._key,
    });
    feed(`${char.name}: ${compiled.cleanText}`, 'dialogue');

    // stage directions fire on a schedule matching the typewriter; the chat panel
    // emits 'chat.direction' as the text reveals, which we handle here.
    this._pendingDispatch = dispatch;
    this._pendingDirections = compiled.directions.slice();

    // TTS (baked/sidecar/synth) — resolved in P1.6
    this.tts?.speak(char, compiled, line._key);
  }

  /** Called by the chat panel as the typewriter passes character offsets. */
  onReveal(offset) {
    if (!this._pendingDirections) return;
    while (this._pendingDirections.length && this._pendingDirections[0].at <= offset) {
      const d = this._pendingDirections.shift();
      try { this._pendingDispatch(d); } catch (err) { console.error('[dispatch]', d, err); }
    }
  }

  /** Fire any directions not yet revealed (line finished/skipped). */
  flushDirections() {
    if (!this._pendingDirections) return;
    for (const d of this._pendingDirections) {
      try { this._pendingDispatch(d); } catch (err) { console.error('[dispatch]', d, err); }
    }
    this._pendingDirections = null;
  }
}
