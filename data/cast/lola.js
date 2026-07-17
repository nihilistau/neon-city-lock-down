// @ts-check
// Lola Voss — bold, dominant, renowned fixer. One of the toughest in the city.

/** @type {import('../../src/core/types.js')} */
export const lola = {
  id: 'lola',
  name: 'Lola Voss',
  archetype: 'dominant fixer',
  voice: 'neutral_female',      // voxtral preset
  accent: '#ff3fa4',           // UI + rim-light accent (hot magenta)

  colors: {
    skin: '#c98b6e',
    hair: '#1a1420',           // near-black with violet sheen
    eyes: '#c94f8a',           // striking magenta-brown
    lips: '#a52a4a',
    brows: 'rgba(20,12,16,0.92)',
  },
  hairStyle: 'bob',
  face: { browWeight: 1.15 },

  // proportions (meters + scalars) — tall, athletic, commanding
  body: {
    height: 1.76, shoulderW: 0.40, hipW: 0.36,
    bust: 1.0, waist: 0.92, hips: 1.05, build: 1.02,
  },

  // personality weights → how stat deltas land (receptivity per stat)
  personality: {
    breathBase: 0.9, fidget: 0.35,
    // multipliers on incoming stat deltas
    receptivity: {
      dominance: 1.4, trust: 0.6, openness: 0.7, fear: 0.4,
      arousal: 0.9, tension: 1.2, happiness: 0.8, loyalty: 0.7,
    },
    baseMood: 'confident',
    idleClip: 'idle_confident',
  },

  // starting stats for a fresh run
  stats: {
    arousal: 8, pleasure: 20, happiness: 55, horniness: 25, openness: 35,
    dominance: 88, trust: 18, tension: 42, energy: 82, sobriety: 100,
    loyalty: 8, fear: 6,
  },

  bio: `A fixer who closes contracts nobody else will touch. Lola walked into the
tower to collect on a debt the night the gates slammed. She is not afraid of anyone
here — least of all you — and she has decided the lockdown is simply a longer
negotiation. She respects competence and despises being handled.`,
};

export default lola;
