// @ts-check
// Bed game engine. Actions are gate-checked through gates.js (the sole authority).
// Escalation is a consent ladder: "Ask for more" attempts to offer+grant the next
// tier IF the partner's stats support it (canOffer) — otherwise they decline. The
// explicitness setting caps the reachable top tier. All actions run through the
// same paired-pose + stat pipeline as the rest of the game.
import { BED_ACTIONS, BED_TIERS } from '../../data/games/bedActions.js';
import { GATE_LADDER, tierIndex, canOffer, gateCheck } from '../chars/gates.js';
import { animTempo } from '../chars/mood.js';
import { startPairedPose, endPairedPose } from '../humanoid/pairedPoses.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';

const TIER_GATE = { 1: 'light_touch', 2: 'kiss', 3: 'touch', 4: 'intimate', 5: 'explicit' };

export class BedGame {
  /**
   * @param {Object} deps
   * @param {() => Record<string, import('../chars/character.js').Character>} deps.cast
   * @param {() => string} deps.explicitness
   * @param {() => number} deps.nowMinute
   * @param {import('../core/rng.js').RngStream} deps.rng
   * @param {(id:string)=>void} deps.sfx
   */
  constructor(deps) {
    this.d = deps;
    this.active = false;
    /** @type {import('../chars/character.js').Character|null} */
    this.partner = null;
  }

  /** @param {string} partnerId */
  start(partnerId) {
    const partner = this.d.cast()[partnerId];
    if (!partner || partner.id === 'vox') return { ok: false, reason: 'no_partner' };
    // must at least be willing to be touched
    partner.gate('light_touch', 'offer', this.d.nowMinute());
    if (partner.stats.trust < 20 || partner.stats.openness < 20) {
      return { ok: false, reason: 'not_ready', line: this._decline(partner) };
    }
    partner.gate('light_touch', 'grant', this.d.nowMinute());
    this.partner = partner;
    this.active = true;
    // move onto the bed together (paired pose)
    startPairedPose('couch_close', partner, partner); // solo anchor; partner leads
    feed(`${partner.name} and you slip away together.`, 'gate');
    emit('bedgame.started', { partner: partner.id });
    return { ok: true, state: this.state() };
  }

  state() {
    if (!this.partner) return null;
    const p = this.partner;
    const settings = { explicitness: this.d.explicitness() };
    const cap = tierIndex({ suggestive: 'kiss', mature: 'intimate', full: 'depraved' }[settings.explicitness]);
    const tiers = BED_TIERS.map((t) => {
      const gateOk = gateCheck(p, TIER_GATE[t.tier], settings).allowed;
      const capped = tierIndex(TIER_GATE[t.tier]) > cap;
      return {
        tier: t.tier, name: t.name, unlocked: gateOk, capped,
        actions: t.actions.map((a) => ({
          id: a.id, label: a.label,
          enabled: gateCheck(p, a.gate, settings).allowed,
        })),
      };
    });
    return {
      partner: p.id, partnerName: p.name,
      arousal: Math.round(p.stats.arousal), pleasure: Math.round(p.stats.pleasure),
      topGate: p.topGate, compliance: Math.round(p.compliance),
      canEscalate: this._nextTierOfferable(),
      tiers,
    };
  }

  /** the next locked gate tier the partner *could* be asked for */
  _nextTierOfferable() {
    if (!this.partner) return null;
    const settings = { explicitness: this.d.explicitness() };
    const top = this.partner.topGate;
    const nextIdx = top ? tierIndex(top) + 1 : 0;
    const tier = GATE_LADDER[nextIdx];
    if (!tier) return null;
    return canOffer(this.partner, tier, settings) ? tier : null;
  }

  /** Ask the partner to open the next tier. Consent hinges on their stats. */
  askForMore() {
    if (!this.partner) return { granted: false };
    const settings = { explicitness: this.d.explicitness() };
    const top = this.partner.topGate;
    const nextIdx = top ? tierIndex(top) + 1 : 0;
    const tier = GATE_LADDER[nextIdx];
    if (!tier) return { granted: false, line: 'There is nowhere further to go.' };
    if (tierIndex(tier) > tierIndex({ suggestive: 'kiss', mature: 'intimate', full: 'depraved' }[settings.explicitness])) {
      return { granted: false, line: '(The explicitness setting holds this line.)' };
    }
    this.partner.gate(tier, 'offer', this.d.nowMinute());
    if (canOffer(this.partner, tier, settings) && this.partner.compliance > 35) {
      this.partner.gate(tier, 'grant', this.d.nowMinute());
      const line = this._consentLine(this.partner, tier);
      feed(`${this.partner.name}: ${line}`, 'gate');
      emit('bedgame.state', this.state());
      return { granted: true, tier, line };
    }
    const line = this._decline(this.partner);
    feed(`${this.partner.name}: ${line}`, 'gate');
    this.partner.applyStats({ tension: 2, arousal: -2 }, 'declined');
    return { granted: false, tier, line };
  }

  /** perform one action (must pass its gate) */
  act(actionId) {
    const a = BED_ACTIONS.find((x) => x.id === actionId);
    if (!a || !this.partner) return { ok: false };
    const settings = { explicitness: this.d.explicitness() };
    const check = gateCheck(this.partner, a.gate, settings);
    if (!check.allowed) {
      return { ok: false, reason: check.reason, line: this._decline(this.partner) };
    }
    // stat effects (partner receives; personality-weighted through applyStats)
    this.partner.applyStats(a.fx, `bed:${a.id}`);
    // tempo-scaled paired clip
    if (a.anim) {
      this.partner.actor.setTempo(animTempo(this.partner.stats));
      this.partner.queue.pushPriority({ type: 'playClip', args: [a.anim, 0.4] });
    }
    this.d.sfx(a.tier >= 3 ? 'thump' : 'ui_confirm');
    const line = this.d.rng.pick(a.lines);
    feed(line, 'dialogue');
    emit('bedgame.action', { id: a.id, tier: a.tier, line });
    emit('bedgame.state', this.state());
    // safeword check: if the partner's tension spikes past arousal, they pull back
    if (this.partner.stats.tension > this.partner.stats.arousal + 30) {
      this._withdraw();
      return { ok: true, line, withdrawn: true };
    }
    return { ok: true, line };
  }

  _withdraw() {
    if (!this.partner) return;
    const top = this.partner.topGate;
    if (top) this.partner.gate(top, 'revoke', this.d.nowMinute());
    feed(`${this.partner.name} tenses and pulls back. "...Wait. Slow down."`, 'gate');
    emit('bedgame.withdraw', { partner: this.partner.id });
  }

  end() {
    if (this.partner) {
      // afterglow
      this.partner.applyStats({ tension: -8, happiness: 4, arousal: -10 }, 'afterglow');
      endPairedPose(this.partner, this.partner);
      feed(`The night winds down. ${this.partner.name} settles against you.`, 'gate');
      emit('bedgame.ended', { partner: this.partner.id });
    }
    this.active = false;
    this.partner = null;
  }

  _consentLine(p, tier) {
    const pools = {
      kiss: ['"...Yes. Kiss me like you mean it."', '"I\'ve been waiting for you to."'],
      touch: ['"Touch me. I want you to."', '"...Please. Don\'t stop there."'],
      undress: ['"Take it off. All of it."', '"I trust you. Show me you deserve it."'],
      intimate: ['"I\'m yours tonight. Prove you know what to do with that."', '"No more waiting. Come here."'],
      explicit: ['"Everything. I want everything."', '"Ruin me. I\'m asking."'],
      depraved: ['"There\'s nothing I won\'t give you right now."', '"Take all of it. Take me apart."'],
      light_touch: ['"...Okay. Come closer."', '"I won\'t bite. Much."'],
    };
    return this.d.rng.pick(pools[tier] || ['"...Yes."']);
  }

  _decline(p) {
    const cold = p.stats.trust < 25;
    const pool = cold
      ? ['"Slow down. You haven\'t earned that."', '"No. Not yet. Maybe not you."', '"Nice try, legend."']
      : ['"...Not quite yet. Soon, though."', '"Patience. Make me want it more."', '"Almost. Keep working for it."'];
    return this.d.rng.pick(pool);
  }
}
