// @ts-check
// Character aggregate: the runtime state (stats, gates, consent, memory, mood,
// wardrobe) bound to its Actor3D + ActorQueue. Bridges pure logic → 3D + bus.
import { defaultStats, applyDelta, decayTick, compliance } from './stats.js';
import { defaultGates, defaultConsent, gateCheck, setGate, highestGranted } from './gates.js';
import { deriveMood, animTempo } from './mood.js';
import { Memory } from './memory.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';

/** Starting/ceiling body integrity for a cast member (the player has run.player.health). */
const MAX_HEALTH = 100;
/** Health lost per game-hour of ration shortfall, and regained per fed hour. */
const STARVE_LOSS = 6;
const FED_REGEN = 1.5;

/** feed/obituary wording per cause */
const CAUSE_TEXT = {
  wounds: 'bled out from the breach',
  starvation: 'starved',
  unknown: 'is gone',
};

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
    this.health = MAX_HEALTH;  // body integrity; 0 → dead (see hurt()/die())
    this.present = true;      // in the game right now? (director can send NPCs away)
    this.injuries = [];
    this._hungryHour = false;  // set by the 'rations' stat pass, consumed by tickMinutes

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
    if (!this.alive) return {};
    const applied = applyDelta(this.stats, deltas, this.persona.personality);
    // survival.js tags the hourly hunger/thirst cascade 'rations' — the only
    // starvation signal that reaches a Character. It always lands immediately
    // before that character's tickMinutes(60) in the same hourly loop.
    if (cause === 'rations') this._hungryHour = true;
    emit('char.stat', { id: this.id, applied, stats: this.stats, cause });
    this.refreshMood();
    return applied;
  }

  /** decay over game minutes (called by world tick) */
  tickMinutes(minutes) {
    if (!this.alive) return;
    decayTick(this.stats, minutes);
    // slow half of mortality: hungry hours eat into health, fed hours heal it
    const hours = minutes / 60;
    if (this._hungryHour) {
      this._hungryHour = false;
      this.hurt(STARVE_LOSS * hours, 'starvation');
    } else {
      this.health = Math.min(MAX_HEALTH, this.health + FED_REGEN * hours);
    }
    this.refreshMood();
  }

  /**
   * Take damage. Returns true if this was the killing blow.
   * The cast used to be immortal: `alive` was set true in the constructor and
   * never cleared anywhere in src/, so every livingCast / _castFire /
   * Relationships.tick filter on it was a no-op.
   * @param {number} amount @param {string} [cause] 'wounds'|'starvation'
   */
  hurt(amount, cause = 'wounds') {
    if (!this.alive || !(amount > 0)) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health > 0) return false;
    this.die(cause);
    return true;
  }

  /**
   * Down this character for good: stop the queue, drop the body, tell the world.
   * @param {string} [cause]
   */
  die(cause = 'unknown') {
    if (!this.alive) return false;
    this.alive = false;
    this.health = 0;
    this._down();
    feed(`${this.name} ${CAUSE_TEXT[cause] || CAUSE_TEXT.unknown}.`, 'combat');
    emit('char.died', { id: this.id, name: this.name, cause });
    return true;
  }

  /** Apply the downed body state (also re-applied after a load). */
  _down() {
    this.queue.clear();
    this.queue.frozen = true;   // nothing — AI, director, events — drives a corpse
    this.actor.setDowned(true);
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
    if (!this.alive) return;   // the dead don't emote
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
      memory: this.memory.serialize(), alive: this.alive, health: this.health,
      injuries: this.injuries,
      pos: this.actor.root.position.toArray(), zone: this.queue.zone,
    };
  }
  /** @param {any} d */
  restore(d) {
    Object.assign(this.stats, d.stats);
    this.gates = d.gates; this.consent = d.consent;
    this.memory = Memory.deserialize(d.memory);
    this.alive = d.alive ?? true;
    this.health = d.health ?? (this.alive ? MAX_HEALTH : 0);
    this.injuries = d.injuries || [];
    if (d.pos) this.actor.root.position.fromArray(d.pos);
    if (d.zone) this.queue.zone = d.zone;
    // a dead character must come back dead: applySave replays an idle clip right
    // after this, which setDowned() overrides for good
    if (!this.alive) this._down();
    this.refreshMood(true);
  }
}
