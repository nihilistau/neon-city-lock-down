// @ts-check
// The bed as ordinary furniture. The player can sit, lie down and get up; a
// character the player has become an ally of will come and sit beside them;
// one who trusts them can be asked to stay the night — the only implied moment
// in the game, and it is exactly that: a fade to black, one line of narration,
// three hours passing, and both of you waking rested. No animation beyond
// sitting and reclining, no explicit text.
//
// Pure over injected ports (camera placement, clock skip, fades, narration) so
// the whole state machine runs under node --test; src/core/app.js wires them.
import { emit } from '../core/bus.js';

/** The guest's side of the mattress (src/scene3d/tower/furniture.js bed()). */
export const GUEST_SEAT = 'bed.seat1';
/** How long "stay the night" skips, in game minutes. */
export const STAY_MINUTES = 180;

/** @typedef {'none'|'sitting'|'lying'} PlayerBedState */

/** @param {PlayerBedState} s */
export function bedPrompt(s) {
  return s === 'none' ? 'Sit on the bed' : s === 'sitting' ? 'Lie down' : 'Get up';
}

export class BedScene {
  /**
   * @param {{
   *   placePlayer: (pose: 'sitting'|'lying') => void,
   *   releasePlayer: () => void,
   *   skip: (minutes: number) => void,
   *   scheduler: { hold: boolean },
   *   fade: (on: boolean) => Promise<void>,
   *   narrate: (text: string) => Promise<void>,
   *   narration: (charId: string) => string,
   *   player: () => { morale: number },
   *   brain: (charId: string) => ({ needs: Record<string, number> } | undefined),
   * }} ports
   */
  constructor(ports) {
    this.p = ports;
    /** @type {PlayerBedState} */
    this.playerState = 'none';
    /** @type {string[]} ids of characters sitting on the bed at the player's invitation */
    this.guests = [];
    /** true while the stay-the-night fade runs; input is ignored until it ends */
    this.busy = false;
    /** @type {Map<string, any>} */
    this._guestChars = new Map();
  }

  /** E on the bed: sit → lie down → get up. @returns {PlayerBedState} */
  use() {
    if (this.busy) return this.playerState;
    if (this.playerState === 'none') this._setPlayer('sitting');
    else if (this.playerState === 'sitting') this._setPlayer('lying');
    else this.getUp();
    return this.playerState;
  }

  /** Leave the bed (E while lying, or any movement key). Guests get up too. */
  getUp() {
    if (this.busy || this.playerState === 'none') return;
    this.playerState = 'none';
    this.p.releasePlayer();
    this.dismissAll();
    emit('bedscene.state', { player: 'none' });
  }

  /**
   * Ask a character to come and sit on the bed.
   * @param {any} char a Character (duck-typed: id, alive, bondAtLeast, applyStats, queue)
   * @returns {{ok: boolean, reason?: string}}
   */
  invite(char) {
    if (!char || !char.alive) return { ok: false, reason: 'absent' };
    if (!char.bondAtLeast('ally')) return { ok: false, reason: 'bond' };
    if (this.guests.includes(char.id)) return { ok: true, reason: 'already' };
    if (this.guests.length) return { ok: false, reason: 'full' };
    char.queue.clear();
    char.queue.sit(GUEST_SEAT);
    char.applyStats({ trust: 3, tension: -5 }, 'bed:sit');
    this.guests.push(char.id);
    this._guestChars.set(char.id, char);
    emit('bedscene.guest', { id: char.id, seated: true });
    return { ok: true };
  }

  /** @param {any} char */
  dismiss(char) {
    if (!char || !this.guests.includes(char.id)) return;
    this.guests = this.guests.filter((id) => id !== char.id);
    this._guestChars.delete(char.id);
    char.queue.clear();
    char.queue.stand();
    emit('bedscene.guest', { id: char.id, seated: false });
  }

  dismissAll() {
    for (const c of [...this._guestChars.values()]) this.dismiss(c);
  }

  /**
   * The one implied moment. Requires a trusted bond; seats the character first
   * if they aren't already. The scheduler is held for the whole skip so no event
   * can fire while the screen is black, and is released even if a port throws.
   * @param {any} char
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async stayNight(char) {
    if (this.busy) return { ok: false, reason: 'busy' };
    if (!char || !char.alive) return { ok: false, reason: 'absent' };
    if (!char.bondAtLeast('trusted')) return { ok: false, reason: 'bond' };
    if (!this.guests.includes(char.id)) {
      const r = this.invite(char);
      if (!r.ok) return r;
    }
    this.busy = true;
    emit('bedscene.started', { id: char.id });
    try {
      await this.p.fade(true);
      this.p.scheduler.hold = true;
      if (this.playerState !== 'lying') this._setPlayer('lying');
      await this.p.narrate(this.p.narration(char.id));
      this.p.skip(STAY_MINUTES);
      const brain = this.p.brain(char.id);
      if (brain) brain.needs.rest = 0;
      char.applyStats({ happiness: 8, loyalty: 5, tension: -10 }, 'bed:stay');
      const pl = this.p.player();
      pl.morale = Math.min(100, (pl.morale ?? 50) + 10);
    } finally {
      this.p.scheduler.hold = false;
      this.busy = false;
      await this.p.fade(false);
      emit('bedscene.ended', { id: char.id });
    }
    return { ok: true };
  }

  /** @param {'sitting'|'lying'} s */
  _setPlayer(s) {
    this.playerState = s;
    this.p.placePlayer(s);
    emit('bedscene.state', { player: s });
  }
}
