// @ts-check
// `requiresUnlock` (optional) gates a scenario behind a meta unlock id awarded in
// src/sim/death.js at the end of a run; `unlockHint` is the one line the locked
// card shows so the player knows what to go and do. src/sim/meta.js has exported
// unlock() since day one and NOTHING ever called it — the whole unlocks array was
// written by nobody and read by nobody, and the new-run screen told the player
// "more unlock as you play" while offering every scenario from the first boot.
// The 15 scenarios. Each sets a stage: mood shifts, lighting, character
// placement, and optionally launches an event, game, or cutscene.
import { INTRO_CUTSCENE } from './cutscenes/intro.js';
import { LOUNGE_SETTLE } from './cutscenes/settle.js';
import { DAY3_CUTSCENE } from './cutscenes/day3.js';

/**
 * @typedef {Object} ScenarioDef
 * @property {string} id @property {string} title @property {string} blurb
 * @property {Record<string, Record<string, number>>} [castMoodShifts]
 * @property {any[]} [openingCutscene]
 * @property {string} [lighting]
 * @property {Record<string, [string, string?]>} [placements] charId → [zone, waypoint]
 * @property {string} [fireEvent]
 * @property {string} [game]  'cards' | 'mystery:<caseId>'
 */

/** @type {Record<string, ScenarioDef>} */
export const SCENARIOS = {
  first_night: {
    id: 'first_night', title: 'First Night Introductions',
    blurb: 'The gates just came down. Three dangerous strangers, one penthouse, and a city on fire below.',
    castMoodShifts: { lola: { tension: 5 }, aria: { fear: 6, openness: -4 } },
    openingCutscene: [...INTRO_CUTSCENE, ...LOUNGE_SETTLE],
  },
  blackout_confessions: {
    id: 'blackout_confessions', title: 'Blackout Confessions',
    blurb: 'The grid dies mid-evening. In the dark, with the reserve cells humming, people say true things.',
    castMoodShifts: { lola: { openness: 8, tension: 4 }, aria: { fear: 8, trust: 5 }, kai: { openness: 6 } },
    lighting: 'candlelit',
    fireEvent: 'blackout',
  },
  bar_stories: {
    id: 'bar_stories', title: 'Bar Stories & War Wounds',
    blurb: 'The whiskey comes out. Everyone has scars; tonight they have provenance.',
    castMoodShifts: { lola: { sobriety: -12, openness: 10 }, aria: { sobriety: -8, openness: 8 }, kai: { sobriety: -6, openness: 6 } },
    placements: { lola: ['bar', 'front'], aria: ['bar', 'center'], kai: ['bar', 'corner'] },
    lighting: 'neon_night',
  },
  rooftop_smoke: {
    id: 'rooftop_smoke', title: 'Rooftop Smoke Break',
    blurb: 'Above the sirens, under the ash-orange sky. The garden grows regardless.',
    castMoodShifts: { lola: { tension: -6 }, aria: { fear: -4, happiness: 4 }, kai: { openness: 4 } },
    placements: { lola: ['rooftop', 'edge'], aria: ['rooftop', 'garden'], kai: ['rooftop', 'helipad'] },
    lighting: 'dawn_grey',
  },
  armoury_night: {
    id: 'armoury_night', title: 'Armoury Inventory Night',
    requiresUnlock: 'blooded', unlockHint: 'Put down ten hostiles across a single run.',
    blurb: 'Counting rounds is meditation for some people. Lola is some people.',
    castMoodShifts: { lola: { dominance: 5, tension: -4 }, aria: { fear: 3 } },
    placements: { lola: ['armoury', 'racks'], kai: ['armoury', 'lockers'] },
    lighting: 'security_red',
  },
  cabin_fever: {
    id: 'cabin_fever', title: 'Cabin Fever',
    blurb: 'Day after day of the same walls. Something small will start it. Something small always does.',
    castMoodShifts: {
      lola: { tension: 18, happiness: -8 }, aria: { tension: 12, fear: 6 },
      kai: { tension: 8, happiness: -4 },
    },
    lighting: 'storm',
  },
  refugee_question: {
    id: 'refugee_question', title: 'The Refugee Question',
    blurb: 'Another knock at the doors below. The pantry math hasn\'t changed. Neither has the screaming.',
    castMoodShifts: { aria: { happiness: -4 }, lola: { tension: 5 } },
    fireEvent: 'refugee',
  },
  fireplace_detente: {
    id: 'fireplace_detente', title: 'Fireplace Detente',
    blurb: 'A truce measured in firelight. Old grudges get an evening off.',
    castMoodShifts: {
      lola: { tension: -10, openness: 6, happiness: 5 },
      aria: { fear: -6, trust: 5 }, kai: { openness: 5 },
    },
    placements: { lola: ['fireplace', 'center'], aria: ['fireplace', 'hearth'], kai: ['fireplace', 'center'] },
    lighting: 'fireplace_warm',
  },
  kais_card_game: {
    id: 'kais_card_game', title: "Kai's Card Game",
    blurb: 'He deals a game nobody knows the rules to. The cards aren\'t the game. You are.',
    castMoodShifts: { kai: { dominance: 6, openness: 4 }, lola: { tension: 4 }, aria: { openness: 5 } },
    placements: { kai: ['lounge', 'couch_front'], lola: ['lounge', 'center'], aria: ['lounge', 'couch_front'] },
    lighting: 'neon_night',
    game: 'cards',
  },
  arias_first_job: {
    id: 'arias_first_job', title: "Aria's First Job Story",
    blurb: 'She almost never talks about the beginning. Tonight the sirens are far away and she almost wants to.',
    castMoodShifts: { aria: { openness: 15, trust: 8, fear: -4 } },
    placements: { aria: ['bed_alcove', 'window'] },
    lighting: 'morning_haze',
  },
  lolas_debt_call: {
    id: 'lolas_debt_call', title: "Lola's Debt Collection Call",
    blurb: 'Three floors down, a man owes the syndicate. Lola intends to collect mid-lockdown. She wants backup.',
    castMoodShifts: { lola: { dominance: 8, tension: 8 }, kai: { openness: 4 } },
    fireEvent: 'elevator_stranger',
    lighting: 'security_red',
  },
  mystery_dead_drop: {
    id: 'mystery_dead_drop', title: 'Mystery: The Dead Drop',
    blurb: 'A courier package, opened. A camera gap. Someone in this tower is lying to your face.',
    game: 'mystery:dead_drop',
    castMoodShifts: { kai: { tension: 4 }, lola: { tension: 3 } },
  },
  mystery_cameras: {
    id: 'mystery_cameras', title: 'Mystery: Who Jammed the Cameras',
    blurb: 'Six minutes of blindness. VOX wants a name. VOX usually gets what it wants.',
    game: 'mystery:jammed_cameras',
    castMoodShifts: { lola: { tension: 5 } },
  },
  ghost_on_the_grid: {
    id: 'ghost_on_the_grid', title: 'Mystery: The Grid Ghost',
    requiresUnlock: 'vox_confided', unlockHint: 'End a run with VOX trusting you (60+).',
    blurb: 'Something walks floor 27 after midnight. VOX did not admit it. VOX is a terrible liar.',
    game: 'mystery:grid_ghost',
    placements: { kai: ['vox_core', 'core'] },
    lighting: 'security_red',
  },
  last_night: {
    id: 'last_night', title: 'Last Night Before the Gates Open',
    requiresUnlock: 'long_haul', unlockHint: 'Survive five days in a single run.',
    blurb: 'The rumor is everywhere: tomorrow the barricades lift. One more night in the tank. Make it count.',
    castMoodShifts: {
      lola: { openness: 12, tension: -8 },
      aria: { openness: 12, happiness: 8, fear: -8 },
      kai: { openness: 10, happiness: 6 },
    },
    openingCutscene: DAY3_CUTSCENE,
    lighting: 'golden_hour',
  },
};
