// @ts-check
// Kai's card game — five tricks of high/low. You see your card, call whether
// his is lower (high) or higher (low). He cheats when dominance is high.
// The cards aren't the game. You are.
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';

const TRICKS = 5;
const RANK = ['', '', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export class Cards {
  /**
   * @param {Object} deps
   * @param {import('../core/rng.js').RngStream} deps.rng
   * @param {() => number} [deps.kaiDominance]
   */
  constructor(deps) {
    this.d = deps;
    this.active = false;
    this.playerTricks = 0;
    this.kaiTricks = 0;
    this.round = 0;
    this.winner = null;
    /** @type {{yours:number, his:number, call:string, win:boolean, cheated:boolean}[]} */
    this.log = [];
  }

  start() {
    this.active = true;
    this.playerTricks = 0;
    this.kaiTricks = 0;
    this.round = 0;
    this.winner = null;
    this.log = [];
    emit('cards.started', {});
    feed('Kai splits a deck that has seen too many rooms.', 'event');
    return this.state();
  }

  /**
   * Play one trick. `call` is 'high' (you win if yours > his) or 'low'.
   * @param {'high'|'low'} call
   */
  play(call) {
    if (!this.active) return null;
    const yours = 2 + this.d.rng.int(0, 12);
    let his = 2 + this.d.rng.int(0, 12);
    let cheated = false;
    const dom = this.d.kaiDominance ? this.d.kaiDominance() : 50;
    if (dom > 70 && this.d.rng.chance(0.28)) {
      his = call === 'high' ? Math.min(14, yours + 1 + this.d.rng.int(0, 2)) : Math.max(2, yours - 1 - this.d.rng.int(0, 2));
      cheated = true;
    }
    const win = call === 'high' ? yours > his : yours < his;
    if (win) this.playerTricks++;
    else this.kaiTricks++;
    const trick = { yours, his, call, win, cheated };
    this.log.push(trick);
    this.round++;
    const line = win
      ? `You called ${call}. ${RANK[yours]} over ${RANK[his]}. The trick is yours.`
      : cheated
        ? `You called ${call}. ${RANK[yours]} against ${RANK[his]}. His sleeve is faster than the deck.`
        : `You called ${call}. ${RANK[yours]} against ${RANK[his]}. He takes it without looking at you.`;
    feed(line, 'event');
    if (this.round >= TRICKS) {
      this.active = false;
      this.winner = this.playerTricks > this.kaiTricks ? 'player'
        : this.playerTricks < this.kaiTricks ? 'kai' : 'draw';
      emit('cards.ended', { winner: this.winner, playerTricks: this.playerTricks, kaiTricks: this.kaiTricks });
    } else {
      emit('cards.trick', trick);
    }
    return { ...trick, line, ...this.state() };
  }

  state() {
    return {
      active: this.active,
      round: this.round,
      total: TRICKS,
      playerTricks: this.playerTricks,
      kaiTricks: this.kaiTricks,
      winner: this.winner,
      last: this.log[this.log.length - 1] || null,
    };
  }
}
