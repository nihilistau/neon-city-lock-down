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
import { emit, on } from '../core/bus.js';

/** The guest's side of the mattress (src/scene3d/tower/furniture.js bed()). */
export const GUEST_SEAT = 'bed.seat1';
/** How long "stay the night" skips, in game minutes. */
export const STAY_MINUTES = 180;

/** @typedef {'none'|'sitting'|'lying'} PlayerBedState */

/** Does a command (current or queued) take this character onto the bed? */
const toBed = (cmd) => !!cmd && (cmd.type === 'sit' || cmd.type === 'gotoSocket')
  && String(cmd.args?.[0]).startsWith('bed.');

/**
 * Characters on the bed or already on their way to it: seated at a bed socket,
 * or with a bed sit/approach queued. Queued counts — that is the reservation,
 * so two sleepers deciding in the same minute can't both claim the mattress.
 * @param {any[]} chars
 * @returns {any[]}
 */
export function bedUsers(chars) {
  return chars.filter((c) => {
    const q = c?.queue;
    if (!q || c.alive === false) return false;
    if (q.seatedAt?.startsWith?.('bed.')) return true;
    return toBed(q.current) || (Array.isArray(q.queue) && q.queue.some(toBed));
  });
}

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
   *   others?: () => any[],
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
    // A guest who dies leaves the bed; combat gets everyone up.
    on('char.died', ({ id } = {}) => {
      const c = this._guestChars.get(id);
      if (c) this._release(c);
    });
    on('combat.started', () => this.dismissAll());
  }

  /**
   * Nobody is on the bed or heading to it — the player, a guest, or an NPC who
   * has queued a sleep there. The AI sleep action checks this (and by queueing
   * its sit, reserves the bed for the next brain that asks).
   */
  isFree() {
    if (this.playerState !== 'none' || this.guests.length) return false;
    return !bedUsers(this.p.others?.() ?? []).length;
  }

  /**
   * Unconditional teardown for a load: the bed state is not saved, so the
   * player is standing and nobody is a guest afterwards, whatever was running.
   */
  reset() {
    this.busy = false;
    if (this.playerState !== 'none') {
      this.playerState = 'none';
      this.p.releasePlayer();
      emit('bedscene.state', { player: 'none' });
    }
    this.dismissAll();
  }

  /** E on the bed: sit → lie down → get up. @returns {PlayerBedState} */
  use() {
    if (this.busy) return this.playerState;
    if (this.playerState === 'none') { this._evictSleepers(); this._setPlayer('sitting'); }
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
    if (this.busy) return { ok: false, reason: 'busy' };
    if (!char || !char.alive) return { ok: false, reason: 'absent' };
    // you ask someone to come and sit WITH you — so you have to be on the bed
    if (this.playerState === 'none') return { ok: false, reason: 'player' };
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

  /** Ask a guest to leave (ignored during the stay-the-night fade). @param {any} char */
  dismiss(char) {
    if (this.busy) return;
    this._release(char);
  }

  /** Every guest gets up — getting up yourself, combat, a load. */
  dismissAll() {
    for (const c of [...this._guestChars.values()]) this._release(c);
  }

  /** @param {any} char */
  _release(char) {
    if (!char || !this.guests.includes(char.id)) return;
    this.guests = this.guests.filter((id) => id !== char.id);
    this._guestChars.delete(char.id);
    this._standUp(char);
    emit('bedscene.guest', { id: char.id, seated: false });
  }

  /**
   * Off the bed NOW, not at the back of the queue: a queued stand is wiped by
   * the next queue.clear() (applySave clears every queue), which would leave
   * seatedAt on a bed socket and the bed "occupied" by someone standing.
   * @param {any} char
   */
  _standUp(char) {
    char.queue.clear();
    if (char.queue.standNow) char.queue.standNow();
    else char.queue.stand();
  }

  /** NPCs sleeping on (or heading to) the bed make room when the player sits. */
  _evictSleepers() {
    for (const c of bedUsers(this.p.others?.() ?? [])) {
      if (this.guests.includes(c.id)) continue;
      this._standUp(c);
      emit('bedscene.evicted', { id: c.id });
    }
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
    if (this.playerState === 'none') return { ok: false, reason: 'player' };
    if (!char.bondAtLeast('trusted')) return { ok: false, reason: 'bond' };
    if (!this.guests.includes(char.id)) {
      // they said yes — whoever else was sitting here makes room (one guest)
      for (const other of [...this._guestChars.values()]) this._release(other);
      const r = this.invite(char);
      if (!r.ok) return r;
    }
    this.busy = true;
    emit('bedscene.started', { id: char.id });
    try {
      await this.p.fade(true);
      this.p.scheduler.hold = true;
      this._evictSleepers();
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
