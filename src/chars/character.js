// @ts-check
// Character aggregate: the runtime state (stats, gates, consent, memory, mood,
// wardrobe) bound to its Actor3D + ActorQueue. Bridges pure logic → 3D + bus.
import { defaultStats, applyDelta, decayTick, compliance } from './stats.js';
import { defaultGates, defaultConsent, gateCheck, setGate, highestGranted } from './gates.js';
import { deriveMood, animTempo } from './mood.js';
import { Memory } from './memory.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';

export class Character {
  /**
   * @param {any} persona data/cast/*.js
   * @param {import('../humanoid/actor3d.js').Actor3D} actor
   * @param {import('../sim/actors/actorQueue.js').ActorQueue} queue
   */
  constructor(persona, actor, queue) {
    this.id = persona.id;
    this.name = persona.name;
    this.persona = persona;
    this.actor = actor;
    this.queue = queue;

    this.stats = { ...defaultStats(), ...(persona.stats || {}) };
    this.gates = defaultGates();
    this.consent = defaultConsent();
    this.memory = new Memory();
    this.alive = true;
    this.present = true;      // in the game right now? (director can send NPCs away)
    this.injuries = [];

    this._moodId = null;
    this._moodTimer = 0;
    this.refreshMood(true);

    // let the ActorQueue consult gates before accepting intimate commands
    queue.hooks.gateCheck = (tier) => this.gateCheck(tier);
  }

  get compliance() { return compliance(this.stats, this._playerDominance ?? 50); }
  get topGate() { return highestGranted(this.gates); }

  /** @param {number} pd player's dominance for compliance clash */
  setPlayerDominance(pd) { this._playerDominance = pd; }

  /**
   * Apply stat deltas (personality-weighted, coupled). Emits 'char.stat'.
   * @param {Partial<Record<import('../core/types.js').StatKey, number>>} deltas
   * @param {string} [cause]
   */
  applyStats(deltas, cause) {
    const applied = applyDelta(this.stats, deltas, this.persona.personality);
    emit('char.stat', { id: this.id, applied, stats: this.stats, cause });
    this.refreshMood();
    return applied;
  }

  /** decay over game minutes (called by world tick) */
  tickMinutes(minutes) {
    decayTick(this.stats, minutes);
    this.refreshMood();
  }

  /** @param {import('../core/types.js').GateTier} tier */
  gateCheck(tier) {
    // explicitness read lazily to avoid a settings import cycle at module load
    const explicitness = (globalThis.__ncldExplicitness) || 'mature';
    return gateCheck(this, tier, { explicitness });
  }

  /**
   * Sanctioned gate transition + side effects (feed, bus).
   * @param {import('../core/types.js').GateTier} tier
   * @param {'offer'|'grant'|'revoke'|'withdraw'|'safeword'|'reset_withdraw'} action
   * @param {number} [atMinute]
   */
  gate(tier, action, atMinute = 0) {
    const ok = setGate(this, tier, action, atMinute);
    if (ok) {
      emit('gate.changed', { id: this.id, tier, action, gates: this.gates });
      if (action === 'grant') feed(`${this.name} welcomed ${tier.replace('_', ' ')}.`, 'gate');
      if (action === 'withdraw' || action === 'safeword') feed(`${this.name} pulled back.`, 'gate');
    }
    return ok;
  }

  /** recompute mood; push face + idle + tempo to the actor when it changes */
  refreshMood(force = false) {
    const mood = deriveMood(this.stats);
    this.actor.setTempo(animTempo(this.stats));
    if (force || mood.id !== this._moodId) {
      this._moodId = mood.id;
      this.mood = mood;
      // don't stomp a talking/gesture expression — only set the resting default
      if (!this.actor.face._talkAmp) this.actor.face.setExpression(mood.face);
      emit('char.mood', { id: this.id, mood: mood.id });
    }
  }

  serialize() {
    return {
      id: this.id, stats: this.stats, gates: this.gates, consent: this.consent,
      memory: this.memory.serialize(), alive: this.alive, injuries: this.injuries,
      pos: this.actor.root.position.toArray(), zone: this.queue.zone,
    };
  }
  /** @param {any} d */
  restore(d) {
    Object.assign(this.stats, d.stats);
    this.gates = d.gates; this.consent = d.consent;
    this.memory = Memory.deserialize(d.memory);
    this.alive = d.alive; this.injuries = d.injuries || [];
    if (d.pos) this.actor.root.position.fromArray(d.pos);
    if (d.zone) this.queue.zone = d.zone;
    this.refreshMood(true);
  }
}
