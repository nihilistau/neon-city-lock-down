// @ts-check
// Mystery case runner: discover clues (via prop interactions in the right zone),
// unlock interrogations as clues accrue, then accuse. Correct accusations grant
// codex + reputation; wrong ones cost trust across the room.
import { MYSTERY_CASES } from '../../data/games/mysteryCases.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';
import { addCodex } from '../sim/meta.js';

export class Mystery {
  /**
   * @param {Object} deps
   * @param {() => Record<string, import('../chars/character.js').Character>} deps.cast
   */
  constructor(deps) {
    this.d = deps;
    this.caseId = null;
    /** @type {Set<string>} */
    this.found = new Set();
    this.solved = false;
  }

  /** @param {string} caseId */
  start(caseId) {
    const c = MYSTERY_CASES[caseId];
    if (!c) return false;
    this.caseId = caseId;
    this.found = new Set();
    this.solved = false;
    feed(`Case opened: ${c.title}. ${c.intro}`, 'event');
    emit('mystery.started', { caseId, title: c.title, intro: c.intro });
    return true;
  }

  /** called when a prop is used — reveals a clue if it belongs to this case */
  onProp(propId, zoneId) {
    if (!this.caseId || this.solved) return;
    const c = MYSTERY_CASES[this.caseId];
    // A clue that names a prop must be found ON that prop. The old
    // `cl.prop === propId || cl.zone === zoneId` also matched on zone alone, so
    // now that every clue prop is a registered interactable, using the security
    // desk's neighbouring monitor wall would hand you the desk's clue.
    const clue = c.clues.find((cl) => !this.found.has(cl.id)
      && (cl.prop ? cl.prop === propId : cl.zone === zoneId));
    if (!clue) return;
    this.found.add(clue.id);
    feed(`🔍 Clue: ${clue.text}`, 'event');
    emit('mystery.clue', { id: clue.id, text: clue.text, found: this.found.size, total: c.clues.length });
  }

  /** interrogations currently unlocked by found clues */
  availableInterrogations() {
    if (!this.caseId) return [];
    const c = MYSTERY_CASES[this.caseId];
    return c.interrogations.filter((iq) => iq.needsClues.every((cl) => this.found.has(cl)));
  }

  interrogate(iqId) {
    const c = MYSTERY_CASES[this.caseId];
    const iq = c?.interrogations.find((x) => x.id === iqId);
    if (!iq || !iq.needsClues.every((cl) => this.found.has(cl))) return null;
    const char = this.d.cast()[iq.char];
    feed(`${char?.name || iq.char}: ${iq.line}`, 'dialogue');
    emit('mystery.interrogation', { char: iq.char, line: iq.line });
    return iq.line;
  }

  /** @param {string} accusedId */
  accuse(accusedId) {
    if (!this.caseId || this.solved) return null;
    const c = MYSTERY_CASES[this.caseId];
    const correct = accusedId === c.culprit;
    this.solved = true;
    if (correct) {
      feed(c.resolution.correct, 'event');
      addCodex(`case_${c.id}`, `Solved: ${c.title}`, c.resolution.correct);
      for (const ch of Object.values(this.d.cast())) ch.applyStats({ trust: 2 }, 'case_solved');
    } else {
      feed(c.resolution.wrong, 'event');
      for (const ch of Object.values(this.d.cast())) ch.applyStats({ trust: -3, tension: 2 }, 'false_accusation');
    }
    emit('mystery.solved', { caseId: c.id, correct, culprit: c.culprit });
    return { correct, culprit: c.culprit };
  }

  state() {
    if (!this.caseId) return null;
    const c = MYSTERY_CASES[this.caseId];
    return {
      caseId: c.id, title: c.title, intro: c.intro,
      found: [...this.found], total: c.clues.length,
      interrogations: this.availableInterrogations().map((iq) => ({ id: iq.id, char: iq.char })),
      solved: this.solved,
      suspects: c.interrogations.map((iq) => iq.char).filter((v, i, a) => a.indexOf(v) === i),
    };
  }
}
