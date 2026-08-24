// @ts-check
// Character aggregate: the runtime state (stats, gates, consent, memory, mood,
// wardrobe) bound to its Actor3D + ActorQueue. Bridges pure logic → 3D + bus.
import { defaultStats, applyDelta, decayTick, compliance } from './stats.js';
import { defaultGates, defaultConsent, gateCheck, setGate, highestGranted } from './gates.js';
import { deriveMood, animTempo } from './mood.js';
import { Memory } from './memory.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';
import { cfg } from '../core/config.js';

/** Starting/ceiling body integrity for a cast member (the player has run.player.health). */
const MAX_HEALTH = 100;

/** feed/obituary wording per cause */
const CAUSE_TEXT = {
  wounds: 'bled out from the breach',
  starvation: 'starved',
  dehydration: 'died of thirst',
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
    emit('char.stat', { id: this.id, applied, stats: this.stats, cause });
    this.refreshMood();
    return applied;
  }

  /** decay over game minutes (called by world tick) */
  tickMinutes(minutes) {
    if (!this.alive) return;
    decayTick(this.stats, minutes);
    this.refreshMood();
  }

  /**
   * The slow half of mortality, driven by the hourly survival tick.
   *
   * This used to be inferred from a stat-delta *cause string*: any
   * `applyStats(..., 'rations')` latched a "hungry hour". That was wrong three
   * ways, and one of them was lethal:
   *   - survival.js adds a flat tension nudge whenever the ration policy is
   *     'half', with NO shortfall, so half rations killed every NPC at 6 hp/hour
   *     with a completely full pantry (dead in ~17 game-hours).
   *   - a WATER shortage took the same path and was reported as "starvation".
   *   - damage was binary: a 0.31 shortfall and a 1.0 shortfall both dealt 6/hr.
   * Now the shortfalls are passed in explicitly and the curve is graded.
   *
   * @param {number} foodShort  0..1 fraction of the hourly food draw unmet
   * @param {number} waterShort 0..1 fraction of the hourly water draw unmet
   * @param {number} hours
   * @returns {boolean} true if this killed them
   */
  applyDeprivation(foodShort, waterShort, hours) {
    if (!this.alive || !(hours > 0)) return false;
    const s = cfg('sim.survival', {});
    const startAt = s.castStarveAt ?? 0.25;
    // ramp from 0 at the threshold to full loss at a total shortfall
    const ramp = (short) => {
      const over = (short - startAt) / Math.max(1e-6, 1 - startAt);
      return Math.max(0, Math.min(1, over));
    };
    const fromFood = ramp(foodShort) * (s.castStarveLoss ?? 6);
    // dehydration outpaces starvation, as it does for the player
    const fromWater = ramp(waterShort) * (s.castThirstLoss ?? 8);
    const loss = (fromFood + fromWater) * hours;

    if (loss > 0) {
      return this.hurt(loss, fromWater > fromFood ? 'dehydration' : 'starvation');
    }
    this.health = Math.min(MAX_HEALTH, this.health + (s.castRegen ?? 1.5) * hours);
    return false;
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
