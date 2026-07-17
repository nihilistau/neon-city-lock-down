// @ts-check
// Scenario definitions. The slice ships the default "First Night"; the full 15
// land in Phase 7 with the same schema.
import { INTRO_CUTSCENE } from './cutscenes/intro.js';

/**
 * @typedef {Object} ScenarioDef
 * @property {string} id @property {string} title @property {string} blurb
 * @property {Record<string, Record<string, number>>} [castMoodShifts] stat deltas per char
 * @property {any[]} [openingCutscene]
 * @property {string} [startZone]
 */

/** @type {Record<string, ScenarioDef>} */
export const SCENARIOS = {
  first_night: {
    id: 'first_night',
    title: 'First Night Introductions',
    blurb: 'The gates just came down. Three dangerous strangers, one penthouse, and a city on fire below.',
    castMoodShifts: {
      lola: { tension: 5 },
      aria: { fear: 6, openness: -4 },
    },
    openingCutscene: INTRO_CUTSCENE,
    startZone: 'lounge',
  },
};
