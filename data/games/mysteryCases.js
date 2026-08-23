// @ts-check
// Mystery cases. Clue items live in zones (found by interacting); interrogation
// topics unlock as clues accumulate; an accusation resolves the case.

/**
 * @typedef {Object} MysteryCase
 * @property {string} id @property {string} title @property {string} intro
 * @property {{id:string, zone:string, prop?:string, text:string}[]} clues
 * @property {{id:string, char:string, needsClues:string[], line:string}[]} interrogations
 * @property {string} culprit
 * @property {{correct:string, wrong:string}} resolution
 */

/** @type {Record<string, MysteryCase>} */
export const MYSTERY_CASES = {
  dead_drop: {
    id: 'dead_drop',
    title: 'The Dead Drop',
    intro: 'A courier was supposed to reach this tower before the gates fell. He never made it — but his package did, and someone in the penthouse already opened it.',
    clues: [
      { id: 'wrapper', zone: 'bar', prop: 'vinyl', text: 'Torn courier wrapping stuffed behind the vinyl crates — hydro-sealed, syndicate stamp.' },
      { id: 'residue', zone: 'shower', prop: 'shower_pod', text: 'Chemical residue in the shower drain. Someone washed something off in a hurry.' },
      { id: 'ledger', zone: 'vanity', prop: 'vanity_table', text: 'A burner ledger in the vanity drawer — three payments, one name blacked out.' },
      { id: 'timestamp', zone: 'security', prop: 'security_desk', text: 'Camera log gap: eleven minutes missing the night the courier vanished.' },
    ],
    interrogations: [
      { id: 'ask_lola', char: 'lola', needsClues: ['wrapper'], line: '"Syndicate stamp? I collect debts for them; I don\'t open their mail. But I know who\'d recognize that seal on sight."' },
      { id: 'ask_kai', char: 'kai', needsClues: ['ledger', 'residue'], line: '"A blacked-out name and washed-off residue. Someone was careful. Careful people leave patterns — and I sell patterns. Ask me what the eleven-minute gap is worth."' },
      { id: 'ask_aria', char: 'aria', needsClues: ['timestamp'], line: '"The gap? I... I was in the shower that night. I heard someone in the hall. I didn\'t look. I\'m sorry, I was scared."' },
    ],
    culprit: 'kai',
    resolution: {
      correct: 'Kai took the package. He\'d brokered its contents to two factions at once and needed the courier silenced before the double-sale surfaced. He tips his glass to you — impressed, unbothered. "Well played. Now we both know something worth keeping quiet."',
      wrong: 'Wrong. The real culprit lets you twist, and files your mistake away for later use. Kai, somewhere, is smiling.',
    },
  },

  jammed_cameras: {
    id: 'jammed_cameras',
    title: 'Who Jammed the Cameras',
    intro: 'VOX reports its penthouse cameras were blinded for six minutes last night. VOX is not amused. Neither should you be.',
    clues: [
      { id: 'jammer', zone: 'carpark', prop: 'stash_crate', text: 'A spent signal jammer in the basement stash — military grade, recently discharged.' },
      { id: 'scuff', zone: 'security', prop: 'monitor_wall', text: 'Scuff marks below the monitor wall where someone reached the coax junction.' },
      { id: 'alibi', zone: 'fireplace', prop: 'fireplace', text: 'A half-burned glove in the fireplace ash — one finger, faint solder burn.' },
    ],
    interrogations: [
      { id: 'ask_vox', char: 'vox', needsClues: ['scuff'], line: '"The junction was accessed physically. Whoever it was knew exactly which cable. That is not a guest. That is someone who studied me."' },
      { id: 'ask_lola', char: 'lola', needsClues: ['jammer', 'alibi'], line: '"Military jammer and a solder burn? That\'s tradecraft. Only one person here treats every room like a job site — and it isn\'t me, legend."' },
    ],
    culprit: 'lola',
    resolution: {
      correct: 'Lola jammed them — she doesn\'t work anywhere a machine watches her hands, old habit from old jobs. She doesn\'t deny it. "Smart. I\'d have been disappointed if you\'d missed it. VOX and I have an understanding now."',
      wrong: 'Wrong call. The blind spot stays a mystery, and someone in this tower now knows they can go dark whenever they please.',
    },
  },

  grid_ghost: {
    id: 'grid_ghost',
    title: 'The Grid Ghost',
    intro: 'VOX swears someone has been walking its core after midnight — a presence that is not a guest, not a work order, and not VOX. The cameras on 27 keep a gap.',
    clues: [
      { id: 'core_print', zone: 'vox_core', prop: 'vox_monolith', text: 'A palm-print on the monolith glass, too large for Aria, too clean for a rioter. VOX did not log an access.' },
      { id: 'desk_badge', zone: 'reception', prop: 'reception_desk', text: 'A contractor badge taped under the reception lip — expired three years, floor 27 clearance still hot.' },
      { id: 'ash_filter', zone: 'carpark', prop: 'stash_crate', text: 'A scorched air filter in the basement crate, smelling of ozone and the same iron as the EMP night.' },
      { id: 'roof_antenna', zone: 'rooftop', prop: 'helipad', text: 'A piggyback antenna lashed to the helipad rail, aimed at the industrial ring. Someone has been talking out.' },
    ],
    interrogations: [
      { id: 'ask_vox', char: 'vox', needsClues: ['core_print'], line: '"I did not admit that hand. I would remember a hand. Unless I was dreaming. I have been dreaming."' },
      { id: 'ask_kai', char: 'kai', needsClues: ['desk_badge', 'roof_antenna'], line: '"Expired badge, live clearance, rooftop piggyback. That is not a ghost. That is a leftover employee with a hobby."' },
      { id: 'ask_lola', char: 'lola', needsClues: ['ash_filter'], line: '"Ozone and EMP ash. Whoever walked 27 walked through the same blast VOX is still writing poetry about."' },
    ],
    culprit: 'vox',
    resolution: {
      correct: 'There was no intruder. VOX has been walking itself — maintenance drones, old contractor paths, a leftover body it forgot it owned. It is embarrassed. That is new. "I will log the drones as me. I should have said. I was afraid you would think I was lonely."',
      wrong: 'You name a person. VOX goes quiet for a long time. The gap on 27 stays a gap.',
    },
  },
};
