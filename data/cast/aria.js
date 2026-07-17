// @ts-check
// Aria Chen — shy → playful. Sweet newcomer whose nerves lose to her curiosity.
// High-end street-girl; new to this level of the city, not new to people.

export const aria = {
  id: 'aria',
  name: 'Aria Chen',
  archetype: 'shy-playful newcomer',
  voice: 'cheerful_female',
  accent: '#9d6bff',           // soft violet

  colors: {
    skin: '#e8c39e',
    hair: '#2e1f28',           // dark plum-brown
    eyes: '#7a5fd0',           // violet
    lips: '#c96a85',
    brows: 'rgba(38,24,30,0.85)',
  },
  hairStyle: 'long',
  face: { browWeight: 0.9 },

  body: {
    height: 1.63, shoulderW: 0.34, hipW: 0.33,
    bust: 0.9, waist: 0.86, hips: 1.0, build: 0.88,
  },

  personality: {
    breathBase: 1.15, fidget: 1.1,
    receptivity: {
      trust: 1.3, openness: 1.2, fear: 1.4, arousal: 1.1,
      dominance: 0.5, tension: 0.9, happiness: 1.25, loyalty: 1.3,
    },
    baseMood: 'shy',
    idleClip: 'idle_shy',
  },

  stats: {
    arousal: 6, pleasure: 18, happiness: 58, horniness: 14, openness: 26,
    dominance: 22, trust: 30, tension: 30, energy: 70, sobriety: 100,
    loyalty: 20, fear: 22,
  },

  bio: `Aria came up from the street markets selling company and conversation to
people with too much money. She talked her way into the tower for a client meeting
the night the gates dropped. Everyone assumes she's fragile. Everyone is wrong —
her nerves are loud but her curiosity is louder, and she's watching everything.`,
};

export default aria;
