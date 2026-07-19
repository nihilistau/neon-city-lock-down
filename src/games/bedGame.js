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
import { cfg } from '../core/config.js';   // desire/climax/safeword tuning → config/gameplay.yaml (bed)

const TIER_GATE = { 1: 'light_touch', 2: 'kiss', 3: 'touch', 4: 'intimate', 5: 'explicit' };
// tier → intimate bed pose (data/poses/intimate.js)
const BED_CLIP = { 1: 'bed_recline', 2: 'bed_reach', 3: 'bed_straddle', 4: 'bed_straddle', 5: 'bed_arch' };

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
    // must be at least a little warmed to you — reachable through rapport
    partner.gate('light_touch', 'offer', this.d.nowMinute());
    if (partner.stats.trust < cfg('gameplay.bed.startTrust', 15) && partner.stats.arousal < cfg('gameplay.bed.startArousal', 20)) {
      return { ok: false, reason: 'not_ready', line: this._decline(partner) };
    }
    partner.gate('light_touch', 'grant', this.d.nowMinute());
    this.partner = partner;
    this.active = true;
    this.climaxed = false;
    this.peakPleasure = 0;
    // move onto the bed together (paired pose)
    startPairedPose('couch_close', partner, partner); // solo anchor; partner leads
    feed(`${partner.name} and you slip away together.`, 'gate');
    emit('bedgame.started', { partner: partner.id });
    return { ok: true, state: this.state() };
  }

  /**
   * Desire-based willingness to open a tier — arousal/horniness/trust pull it up,
   * tension/fear/withdrawal hold it back. Replaces obedience-"compliance", which
   * a dominant, guarded character (high dominance clash) could never clear even
   * when genuinely turned on. 0..~100; each tier raises the bar it must clear.
   * @param {import('../chars/character.js').Character} p @param {string} tier
   */
  _willing(p, tier) {
    const s = p.stats;
    if (p.consent.withdrawn || p.consent.safeword) return { willing: false, score: 0, need: 999 };
    const w = cfg('gameplay.bed.willing', {});
    const desire = s.arousal * (w.arousal ?? 0.42) + s.horniness * (w.horniness ?? 0.30) + s.trust * (w.trust ?? 0.16) + s.openness * (w.openness ?? 0.12);
    const resist = s.tension * (w.tension ?? 0.22) + s.fear * (w.fear ?? 0.45);
    const score = Math.max(0, desire - resist);
    const need = (w.base ?? 18) + tierIndex(tier) * (w.perTier ?? 5); // kiss 23 · touch 28 · undress 33 · intimate 38 · explicit 43 · depraved 48
    return { willing: score >= need, score: Math.round(score), need };
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
    const nextTier = this._nextTier();
    const want = nextTier ? this._willing(p, nextTier) : null;
    return {
      partner: p.id, partnerName: p.name,
      arousal: Math.round(p.stats.arousal), pleasure: Math.round(p.stats.pleasure),
      horniness: Math.round(p.stats.horniness), tension: Math.round(p.stats.tension),
      topGate: p.topGate, mood: p.mood?.id,
      canEscalate: this._nextTierOfferable(),
      nextTier, want,                 // {willing, score, need} — drives the escalate UI
      climaxed: !!this.climaxed, peakPleasure: Math.round(this.peakPleasure || 0),
      tiers,
    };
  }

  /** the next locked gate tier the partner *could* be asked for */
  _nextTier() {
    if (!this.partner) return null;
    const top = this.partner.topGate;
    const nextIdx = top ? tierIndex(top) + 1 : 0;
    return GATE_LADDER[nextIdx] || null;
  }

  _capTier() {
    return { suggestive: 'kiss', mature: 'intimate', full: 'depraved' }[this.d.explicitness()];
  }

  /** the next locked tier the partner is BOTH able and willing to open (or null) */
  _nextTierOfferable() {
    const tier = this._nextTier();
    if (!tier) return null;
    const settings = { explicitness: this.d.explicitness() };
    if (tierIndex(tier) > tierIndex(this._capTier())) return null;
    return (canOffer(this.partner, tier, settings) && this._willing(this.partner, tier).willing) ? tier : null;
  }

  /** Ask the partner to open the next tier. Consent hinges on their DESIRE. */
  askForMore() {
    if (!this.partner) return { granted: false };
    const settings = { explicitness: this.d.explicitness() };
    const tier = this._nextTier();
    if (!tier) return { granted: false, line: 'There is nowhere further to go.' };
    if (tierIndex(tier) > tierIndex(this._capTier())) {
      return { granted: false, line: '(The explicitness setting holds this line.)' };
    }
    this.partner.gate(tier, 'offer', this.d.nowMinute());
    const w = this._willing(this.partner, tier);
    if (canOffer(this.partner, tier, settings) && w.willing) {
      this.partner.gate(tier, 'grant', this.d.nowMinute());
      // saying yes to more is itself arousing + trust-affirming
      this.partner.applyStats({ arousal: 4, horniness: 3, trust: 2, tension: -2 }, 'yes');
      const line = this._consentLine(this.partner, tier);
      feed(`${this.partner.name}: ${line}`, 'gate');
      emit('bedgame.state', this.state());
      return { granted: true, tier, line };
    }
    const line = this._decline(this.partner);
    feed(`${this.partner.name}: ${line}`, 'gate');
    this.partner.applyStats({ tension: 2, arousal: -1 }, 'declined');
    return { granted: false, tier, line, want: w };
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
    // play a tier-appropriate intimate pose on the bed (tempo scales with arousal)
    this.partner.actor.setTempo(animTempo(this.partner.stats));
    this.partner.actor.playClip(BED_CLIP[a.tier] || 'bed_recline', 0.4);
    this.d.sfx(a.tier >= 3 ? 'thump' : 'ui_confirm');
    const line = this.d.rng.pick(a.lines);
    feed(line, 'dialogue');
    emit('bedgame.action', { id: a.id, tier: a.tier, line });

    // pleasure builds toward a climax; giving pleasure is the point and the payoff
    this.peakPleasure = Math.max(this.peakPleasure || 0, this.partner.stats.pleasure);
    let climaxed = false;
    if (!this.climaxed && a.tier >= cfg('gameplay.bed.climaxTier', 4)
        && this.partner.stats.pleasure >= cfg('gameplay.bed.climaxPleasure', 82)
        && this.partner.stats.arousal >= cfg('gameplay.bed.climaxArousal', 70)) {
      this._climax();
      climaxed = true;
    }
    emit('bedgame.state', this.state());
    // safeword check: if the partner's tension spikes past arousal, they pull back
    if (this.partner.stats.tension > this.partner.stats.arousal + cfg('gameplay.bed.safewordGap', 30)) {
      this._withdraw();
      return { ok: true, line, withdrawn: true };
    }
    return { ok: true, line, climaxed };
  }

  /** The partner comes apart — the reward for attentive, escalating pleasure. */
  _climax() {
    if (!this.partner) return;
    this.climaxed = true;
    this.partner.applyStats(
      { pleasure: 6, happiness: 14, loyalty: 8, trust: 8, tension: -18, arousal: -12, horniness: -20 },
      'climax');
    this.partner.actor.face.setExpression({ mouth: 'open', browRaise: 0.6, blush: 0.9 });
    this.partner.actor.playClip('bed_climax', 0.25);
    this.d.sfx('thump');
    const lines = [
      `${this.partner.name} comes apart in your hands, shaking, your name breaking on their lips.`,
      `${this.partner.name} arches, gasps, and shatters — utterly undone, clinging to you.`,
      `You feel ${this.partner.name} tip over the edge, wrecked and gasping and grinning through it.`,
    ];
    feed(this.d.rng.pick(lines), 'dialogue');
    emit('bedgame.climax', { partner: this.partner.id });
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
