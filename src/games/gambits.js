// @ts-check
// Conversational mind-games. A gambit is an opposed roll: the player's move vs a
// character stat, modified by mood/relationship. Outcomes shift stats and the
// dice are shown in the Actions tab. Usable against any character, any time.
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';

/**
 * @typedef {Object} GambitDef
 * @property {string} id @property {string} label @property {string} desc
 * @property {string} vs   character stat the target resists with
 * @property {number} dc   base difficulty add
 * @property {(win:boolean) => {selfFx?:Object, targetFx:Object, line:(name:string)=>string}} outcome
 */

/** @type {Record<string, GambitDef>} */
export const GAMBITS = {
  probe: {
    id: 'probe', label: 'Probe', desc: 'Fish for what they\'re hiding.', vs: 'openness', dc: 8,
    outcome: (win) => win
      ? { targetFx: { openness: 6, trust: 2 }, line: (n) => `${n} lets something slip they meant to keep.` }
      : { targetFx: { tension: 3, trust: -2 }, line: (n) => `${n} sees the hook coming and closes up.` },
  },
  bluff: {
    id: 'bluff', label: 'Bluff', desc: 'Claim you know more than you do.', vs: 'dominance', dc: 10,
    outcome: (win) => win
      ? { targetFx: { fear: 4, dominance: -3, tension: 3 }, line: (n) => `${n} believes you know more than you do. Advantage: yours.` }
      : { targetFx: { dominance: 3 }, selfFx: {}, line: (n) => `${n} calls it. The bluff dies on the table.` },
  },
  flatter: {
    id: 'flatter', label: 'Flatter', desc: 'Charm them off balance.', vs: 'dominance', dc: 6,
    outcome: (win) => win
      ? { targetFx: { happiness: 5, trust: 4, openness: 3, tension: -3 }, line: (n) => `${n} warms despite themselves.` }
      : { targetFx: { trust: -2 }, line: (n) => `${n} recognizes the technique. It curdles.` },
  },
  needle: {
    id: 'needle', label: 'Needle', desc: 'Get under their skin on purpose.', vs: 'tension', dc: 7,
    outcome: (win) => win
      ? { targetFx: { tension: 8, dominance: -2, openness: 3 }, line: (n) => `${n} loses composure — and gives ground.` }
      : { targetFx: { dominance: 4, tension: 2 }, line: (n) => `${n} takes it and smiles. That backfired.` },
  },
  dare_them: {
    id: 'dare_them', label: 'Dare', desc: 'Push them to prove something.', vs: 'openness', dc: 9,
    outcome: (win) => win
      ? { targetFx: { happiness: 5, openness: 5, dominance: 2 }, line: (n) => `${n} rises to it. The temperature climbs.` }
      : { targetFx: { tension: 2 }, line: (n) => `${n} shrugs it off. No sale.` },
  },
  stonewall: {
    id: 'stonewall', label: 'Stonewall', desc: 'Give them nothing, make them work.', vs: 'openness', dc: 8,
    outcome: (win) => win
      ? { selfFx: {}, targetFx: { openness: 4, happiness: 3, tension: 2 }, line: (n) => `Your silence works on ${n}. They lean in to fill it.` }
      : { targetFx: { trust: -3, tension: 2 }, line: (n) => `${n} shrugs and moves on. Cold reads cold.` },
  },
};

export class Gambits {
  /**
   * @param {Object} deps
   * @param {import('../core/rng.js').RngStream} deps.rng
   * @param {number|(() => number)} [deps.playerSkill] 0..100, value or live accessor
   */
  constructor(deps) {
    this.d = deps;
    this._skill = deps.playerSkill ?? 60;
  }

  /** Read live so training actually improves social play. */
  get playerSkill() {
    return (typeof this._skill === 'function' ? this._skill() : this._skill) ?? 60;
  }

  /**
   * @param {string} gambitId
   * @param {import('../chars/character.js').Character} target
   */
  play(gambitId, target) {
    const g = GAMBITS[gambitId];
    if (!g || !target) return null;
    // opposed d20: player skill/5 + roll  vs  target stat/5 + dc/2 + roll
    const pRoll = this.d.rng.dice(1, 20);
    const tRoll = this.d.rng.dice(1, 20);
    const pTotal = pRoll + Math.round(this.playerSkill / 8);
    const tResist = target.stats[g.vs] ?? 40;
    const tTotal = tRoll + Math.round(tResist / 8) + Math.round(g.dc / 3);
    const win = pTotal >= tTotal;

    const res = g.outcome(win);
    target.applyStats(res.targetFx, `gambit:${g.id}`);
    const line = res.line(target.name);
    feed(`⚄ ${g.label} vs ${target.name}: ${pTotal} vs ${tTotal} — ${win ? 'success' : 'fail'}. ${line}`,
      win ? 'dialogue' : 'event');
    emit('gambit.resolved', {
      gambit: g.id, target: target.id, win,
      dice: { player: pRoll, target: tRoll, pTotal, tTotal }, line,
    });
    return { win, line, dice: { pRoll, tRoll, pTotal, tTotal } };
  }
}
