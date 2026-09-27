// @ts-check
// Character aggregate: the runtime state (stats, bond, memory, mood, wardrobe)
// bound to its Actor3D + ActorQueue. Bridges pure logic → 3D + bus.
import { defaultStats, applyDelta, decayTick, compliance } from './stats.js';
import { bondTier, bondAtLeast } from './bond.js';
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
    this.memory = new Memory();
    this.alive = true;
    this.health = MAX_HEALTH;  // body integrity; 0 → dead (see hurt()/die())
    this.present = true;      // in the game right now? (director can send NPCs away)
    this.injuries = [];

    this._moodId = null;
    this._moodTimer = 0;
    this.refreshMood(true);
    /** @type {import('./bond.js').BondTier} */
    this._bond = bondTier(this.stats);

    // the ActorQueue consults the bond before accepting a minBond-tagged command
    queue.hooks.bondCheck = (tier) => this.bondAtLeast(tier);
  }

  get compliance() { return compliance(this.stats, this._playerDominance ?? 50); }

  /** Relationship tier with the player — derived from trust + loyalty (src/chars/bond.js). */
  get bond() { return this._bond; }

  /** @param {import('./bond.js').BondTier} tier */
  bondAtLeast(tier) { return bondAtLeast(this.stats, tier, this._bond); }

  /**
   * Re-derive the tier after stats move; announce real crossings only.
   * @param {boolean} [silent] set when seeding (constructor / restore)
   */
  _refreshBond(silent = false) {
    const next = bondTier(this.stats, this._bond);
    if (next === this._bond) return;
    const from = this._bond;
    this._bond = next;
    if (!silent) {
      emit('bond.changed', { id: this.id, name: this.name, from, to: next });
      feed(`${this.name}: ${from} → ${next}.`, 'bond');
    }
  }

  /** @param {number} pd player's dominance for compliance clash */
  setPlayerDominance(pd) { this._playerDominance = pd; }

  /**
   * Apply stat deltas (personality-weighted, coupled). Emits 'char.stat'
   * (carrying the post-change bond, so the rail never has to guess it).
   * @param {Partial<Record<import('../core/types.js').StatKey, number>>} deltas
   * @param {string} [cause]
   */
  applyStats(deltas, cause) {
    if (!this.alive) return {};
    const applied = applyDelta(this.stats, deltas, this.persona.personality);
    this._refreshBond();
    emit('char.stat', { id: this.id, applied, stats: this.stats, cause, bond: this._bond });
    this.refreshMood();
    return applied;
  }

  /** decay over game minutes (called by world tick) */
  tickMinutes(minutes) {
    if (!this.alive) return;
    decayTick(this.stats, minutes);
    this.refreshMood();
    this._refreshBond();
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
      id: this.id, stats: this.stats, bond: this._bond,
      memory: this.memory.serialize(), alive: this.alive, health: this.health,
      injuries: this.injuries,
      pos: this.actor.root.position.toArray(), zone: this.queue.zone,
    };
  }
  /** @param {any} d */
  restore(d) {
    Object.assign(this.stats, d.stats);
    // legacy v0.5 saves carry gates/consent from the retired intimacy ladder; ignored
    this._bond = d.bond || undefined;
    this._refreshBond(true);
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
    // the bond was re-derived silently above (a load is not a crossing — no toast),
    // but the rail's bars and bond chip still have to catch up with the loaded state
    emit('char.stat', { id: this.id, applied: {}, stats: this.stats, cause: 'restore', bond: this._bond });
  }
}
