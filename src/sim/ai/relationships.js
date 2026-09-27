// @ts-check
// NPC↔NPC social simulation. Beats are spoken (chat + TTS) and animated, not
// just activity-feed narration.
import { emit } from '../../core/bus.js';
import { feed } from '../../core/log.js';

/** first-person needle lines: [aggressor][target] */
export const NEEDLE_SPOKEN = {
  lola: {
    aria: [
      'Sit up straight, deal-maker. Posture is armor. Yours is currently a suggestion.',
      'Remind me what an hour of that charm bills a client these days. I like to know the market.',
    ],
    kai: [
      'Cataloguing my weaknesses is a hobby, Mercer. Start paying rent on them or shut up.',
      'Say one more cryptic thing and you\'ll be cryptic through a missing tooth.',
    ],
  },
  kai: {
    lola: [
      'I was just wondering what your debt ledger would fetch at auction. Hypothetically.',
      'You telegraph the left hook, Voss. I\'d sell you the fix, but I enjoy the tell.',
    ],
    aria: [
      'A client of yours asked after you last week. Softly. Like a hook sliding into water.',
      'What are you not telling everyone? I\'ll ask twice. Politely.',
    ],
  },
  aria: {
    lola: [
      'Do you ever get tired, Lola? Of the armor. It looks heavy from over here.',
    ],
    kai: [
      'Who do you talk to when the information runs out, Kai? Anyone? Or is the silence the product?',
    ],
  },
};

export const BANTER_SPOKEN = [
  'You ever miss the noise? Not the sirens. The ordinary kind.',
  'If we live through this I\'m stealing that bottle. Fair warning.',
  'The city looks almost pretty from up here. Don\'t tell it I said that.',
  'Hold still. You had ash on your collar. There. Professional.',
];

export const CLASH_SPOKEN = [
  'Put the bottle down. That one is not communal.',
  'We were on opposite sides of that job. You don\'t get to rewrite it in a penthouse.',
  'Count the pantry again. Someone\'s been generous with their own mouth.',
];

export class Relationships {
  /**
   * @param {Object} deps
   * @param {() => Record<string, import('../../chars/character.js').Character>} deps.cast
   * @param {Record<string, import('./brain.js').Brain>} deps.brains
   * @param {import('../../core/rng.js').RngStream} deps.rng
   * @param {() => number} deps.nowMinute
   * @param {(c:any, text:string)=>void} [deps.speak]
   */
  constructor(deps) {
    this.d = deps;
    this._sinceBeat = 0;
  }

  /** call once per game-minute */
  tick() {
    this._sinceBeat++;
    if (this._sinceBeat < 15) return;
    this._sinceBeat = 0;

    const cast = Object.values(this.d.cast()).filter((c) =>
      c.alive && c.present !== false && c.actor.root.visible !== false && c.id !== 'vox'
      && !String(c.id).startsWith('refugee'));
    const pairs = [];
    for (let i = 0; i < cast.length; i++) {
      for (let j = i + 1; j < cast.length; j++) {
        const a = cast[i], b = cast[j];
        if (a.queue.zone === b.queue.zone && !a.queue.busy && !b.queue.busy) pairs.push([a, b]);
      }
    }
    if (!pairs.length || !this.d.rng.chance(0.55)) return;
    const [a, b] = this.d.rng.pick(pairs);
    this._beat(a, b);
  }

  _say(char, text) {
    if (this.d.speak) this.d.speak(char, text);
    else feed(`${char.name}: ${text}`, 'dialogue');
  }

  /** @param {import('../../chars/character.js').Character} a @param {import('../../chars/character.js').Character} b */
  _beat(a, b) {
    const rng = this.d.rng;
    const now = this.d.nowMinute();
    const relA = a.memory.relTo(b.id);
    const relB = b.memory.relTo(a.id);
    const heat = (a.stats.tension + b.stats.tension) / 2 + relA.grudge + relB.grudge;
    const warmth = (relA.affinity + relB.affinity) / 2 + (a.stats.happiness + b.stats.happiness) / 4;

    const roll = rng.next() * 100;
    if (roll < Math.min(55, 18 + heat * 0.35)) {
      if (rng.chance(0.35) && heat > 40) {
        const speaker = rng.pick([a, b]);
        this._say(speaker, rng.pick(CLASH_SPOKEN));
        for (const [x, other] of [[a, b], [b, a]]) {
          x.applyStats({ tension: 7, happiness: -3 }, 'clash');
          const rel = x.memory.relTo(other.id);
          rel.grudge = Math.min(40, rel.grudge + 5);
          rel.affinity = Math.max(-40, rel.affinity - 4);
          rel.lastClash = now;
          x.actor.face.setExpression({ mouth: 'grit', browAngle: -0.7 });
          x.queue.playClip('gesture_cross_arms', 0.3, 8);
          x.queue.look(other.actor.root);
        }
        emit('rel.clash', { a: a.id, b: b.id });
      } else {
        const [agg, tgt] = a.stats.dominance >= b.stats.dominance ? [a, b] : [b, a];
        const pool = NEEDLE_SPOKEN[agg.id]?.[tgt.id];
        this._say(agg, pool ? rng.pick(pool) : 'Don\'t look at me like that.');
        tgt.applyStats({ tension: 4, happiness: -2 }, 'needled');
        agg.applyStats({ dominance: 1 }, 'needling');
        const rel = tgt.memory.relTo(agg.id);
        rel.affinity = Math.max(-40, rel.affinity - 2);
        rel.grudge = Math.min(40, rel.grudge + 2);
        tgt.actor.face.setExpression({ mouth: 'frown', browAngle: 0.3 });
        agg.queue.look(tgt.actor.root);
        tgt.queue.look(agg.actor.root);
        agg.queue.playClip('gesture_lean_in', 0.3, 6);
      }
    } else if (roll < Math.min(96, 40 + warmth * 0.4)) {
      this._say(a, rng.pick(BANTER_SPOKEN));
      for (const [x, other] of [[a, b], [b, a]]) {
        x.applyStats({ happiness: 3, tension: -3 }, 'banter');
        const rel = x.memory.relTo(other.id);
        rel.affinity = Math.min(60, rel.affinity + 3);
        rel.grudge = Math.max(0, rel.grudge - 1);
      }
      a.queue.look(b.actor.root); b.queue.look(a.actor.root);
      emit('rel.banter', { a: a.id, b: b.id });
    }
  }
}
