// @ts-check
// Utility AI. Each brain tracks needs, scores the action catalog when its
// character is idle, softmax-picks, and drives the ActorQueue. Dialogue
// engagement and combat suspend autonomous behavior.
import { defaultNeeds, growNeeds, satisfy } from './needs.js';
import { ACTIONS } from './actionCatalog.js';
import { feed } from '../../core/log.js';
import { nightScoreMul } from '../livingBeats.js';

export class Brain {
  /**
   * @param {import('../../chars/character.js').Character} character
   * @param {{ rng: import('../../core/rng.js').RngStream,
   *           others: (c:any)=>any[], threat: ()=>number, sfx:(id:string)=>void,
   *           combatActive: ()=>boolean }} ctx
   */
  constructor(character, ctx) {
    this.c = character;
    this.ctx = ctx;
    this.needs = defaultNeeds();
    this.engagedUntil = 0;      // game-minute until which dialogue holds the floor
    this._pendingAction = null; // action whose satisfy fires when queue drains
    this._cooldown = ctx.rng.range(1, 4); // minutes before first plan
  }

  /** Mark the character as engaged (dialogue). @param {number} untilMinute */
  engage(untilMinute) {
    this.engagedUntil = Math.max(this.engagedUntil, untilMinute);
    // stop wandering off mid-conversation
    if (this.c.queue.busy && this._pendingAction) {
      this.c.queue.clear();
      this._pendingAction = null;
    }
  }

  /**
   * Per-game-minute tick.
   * @param {number} nowMinute @param {number} minutes elapsed since last tick
   */
  tick(nowMinute, minutes = 1) {
    growNeeds(this.needs, minutes, this.c.stats, this.ctx.threat());

    if (!this.c.alive) return;
    if (this.ctx.combatActive()) return;
    if (nowMinute < this.engagedUntil) return;

    // action completion: queue drained with a pending action → collect payoff
    if (this._pendingAction && !this.c.queue.busy) {
      const a = this._pendingAction;
      satisfy(this.needs, a.satisfy);
      if (a.statFx) this.c.applyStats(a.statFx, `ai:${a.id}`);
      this._pendingAction = null;
      this._cooldown = this.ctx.rng.range(2, 6);
      return;
    }
    if (this.c.queue.busy) return;

    this._cooldown -= minutes;
    if (this._cooldown > 0) return;

    // score catalog, softmax pick
    const minuteOfDay = ((nowMinute % 1440) + 1440) % 1440;
    const ctx = { ...this.ctx, threat: this.ctx.threat(), minuteOfDay };
    const scored = ACTIONS
      .map((a) => ({
        a,
        s: Math.max(0, a.score(this.c, this.needs, ctx) * nightScoreMul(minuteOfDay, a.id)),
      }))
      .filter((x) => x.s > 0);
    if (!scored.length) { this._cooldown = 3; return; }

    const temp = 14; // exploration temperature
    const weights = scored.map((x) => Math.exp(x.s / temp));
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = this.ctx.rng.next() * total;
    let pick = scored[0];
    for (let i = 0; i < scored.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { pick = scored[i]; break; }
    }

    pick.a.exec(this.c, ctx);
    this._pendingAction = pick.a;
    feed(`${this.c.name} → ${pick.a.id.replace(/_/g, ' ')}`, 'info');
  }

  serialize() {
    return { needs: this.needs, engagedUntil: this.engagedUntil };
  }
  deserialize(d) {
    if (d?.needs) this.needs = d.needs;
    this.engagedUntil = d?.engagedUntil ?? 0;
  }
}
