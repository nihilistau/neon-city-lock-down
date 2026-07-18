// @ts-check
// NPC↔NPC social simulation. Every so often, two co-located idle characters have
// a beat: banter (affinity up), needling (the dominant one digs), or a clash
// (tension spikes, grudges form). Everyone is in it for themselves — bonds and
// grudges grow from the same proximity.
import { emit } from '../../core/bus.js';
import { feed } from '../../core/log.js';

/** authored beat lines: [aggressor][target] pools */
const NEEDLE_LINES = {
  lola: {
    aria: ['Lola, dry: "Sit up straight, street girl. Posture is armor."',
      'Lola asks Aria exactly how much her smile bills per hour. Aria goes quiet.'],
    kai: ['Lola tells Kai to stop cataloguing her weaknesses or start paying rent on them.',
      'Lola: "Say one more cryptic thing, Mercer, and you\'ll be cryptic through a missing tooth."'],
  },
  kai: {
    lola: ['Kai wonders aloud what Lola\'s debt ledger would fetch at auction. Her jaw tightens.',
      'Kai, mildly: "You telegraph your left hook, Voss. I\'d sell you the fix, but I enjoy the tell."'],
    aria: ['Kai mentions a client of Aria\'s by name — softly, like a hook sliding into water.',
      'Kai asks Aria what she\'s NOT telling everyone. Twice. Politely.'],
  },
  aria: {
    lola: ['Aria, sweetly: "Do you ever get tired, Lola? Of the armor?" The silence is loud.'],
    kai: ['Aria asks Kai who he talks to when the information runs out. He doesn\'t answer.'],
  },
};

const BANTER_LINES = [
  '{a} and {b} trade war stories about the city below. There\'s almost laughter.',
  '{a} pours two glasses without being asked. {b} takes one. Progress.',
  '{a} and {b} watch the fires from the glass, shoulder to shoulder, saying nothing.',
  '{a} shows {b} a trick with a knife/a coin/a memory. {b} pretends not to be impressed.',
];

const CLASH_LINES = [
  '{a} and {b} go from zero to knives-out over the last of the good whiskey. VOX dims the lights meaningfully.',
  'An old job comes up. {a} was on one side, {b} on the other. The room drops five degrees.',
  '{a} accuses {b} of hoarding supplies. Nobody apologizes. Everyone recounts the pantry.',
];

export class Relationships {
  /**
   * @param {Object} deps
   * @param {() => Record<string, import('../../chars/character.js').Character>} deps.cast
   * @param {Record<string, import('./brain.js').Brain>} deps.brains
   * @param {import('../../core/rng.js').RngStream} deps.rng
   * @param {() => number} deps.nowMinute
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
      c.alive && c.present !== false && c.actor.root.visible !== false && c.id !== 'vox');
    // co-located idle pairs
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

  /** @param {import('../../chars/character.js').Character} a @param {import('../../chars/character.js').Character} b */
  _beat(a, b) {
    const rng = this.d.rng;
    const now = this.d.nowMinute();
    const relA = a.memory.relTo(b.id);
    const relB = b.memory.relTo(a.id);
    const heat = (a.stats.tension + b.stats.tension) / 2 + relA.grudge + relB.grudge;
    const warmth = (relA.affinity + relB.affinity) / 2 + (a.stats.happiness + b.stats.happiness) / 4;

    // outcome weights shift with the room temperature
    const roll = rng.next() * 100;
    if (roll < Math.min(55, 18 + heat * 0.35)) {
      // needle or clash
      if (rng.chance(0.35) && heat > 40) {
        // full clash
        const line = rng.pick(CLASH_LINES).replace('{a}', a.name).replace('{b}', b.name);
        feed(line, 'event');
        for (const [x, other] of [[a, b], [b, a]]) {
          x.applyStats({ tension: 7, happiness: -3 }, 'clash');
          const rel = x.memory.relTo(other.id);
          rel.grudge = Math.min(40, rel.grudge + 5);
          rel.affinity = Math.max(-40, rel.affinity - 4);
          rel.lastClash = now;
          x.actor.face.setExpression({ mouth: 'grit', browAngle: -0.7 });
          x.queue.playClip('gesture_cross_arms', 0.3, 8);
        }
        emit('rel.clash', { a: a.id, b: b.id });
      } else {
        // one needles the other (the more dominant digs)
        const [agg, tgt] = a.stats.dominance >= b.stats.dominance ? [a, b] : [b, a];
        const pool = NEEDLE_LINES[agg.id]?.[tgt.id];
        if (pool) feed(rng.pick(pool), 'dialogue');
        else feed(`${agg.name} needles ${tgt.name}. It lands.`, 'dialogue');
        tgt.applyStats({ tension: 4, happiness: -2 }, 'needled');
        agg.applyStats({ dominance: 1 }, 'needling');
        const rel = tgt.memory.relTo(agg.id);
        rel.affinity = Math.max(-40, rel.affinity - 2);
        rel.grudge = Math.min(40, rel.grudge + 2);
        tgt.actor.face.setExpression({ mouth: 'frown', browAngle: 0.3 });
      }
    } else if (roll < Math.min(96, 40 + warmth * 0.4)) {
      // banter — bonds form in the tank
      const line = rng.pick(BANTER_LINES).replace('{a}', a.name).replace('{b}', b.name);
      feed(line, 'dialogue');
      for (const [x, other] of [[a, b], [b, a]]) {
        x.applyStats({ happiness: 3, tension: -3 }, 'banter');
        const rel = x.memory.relTo(other.id);
        rel.affinity = Math.min(60, rel.affinity + 3);
        rel.grudge = Math.max(0, rel.grudge - 1);
      }
      a.queue.look(b.actor.root); b.queue.look(a.actor.root);
      emit('rel.banter', { a: a.id, b: b.id });
    }
    // else: nothing happens; sharks circle in silence
  }
}
