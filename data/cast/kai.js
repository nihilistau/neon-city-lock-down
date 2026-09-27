// @ts-check
// Kai Mercer — enigmatic, charming, patient. A fixer who trades in information
// and watches everything. Unnervingly calm; the lockdown is just leverage.

export const kai = {
  id: 'kai',
  name: 'Kai Mercer',
  archetype: 'patient information fixer',
  voice: 'casual_male',
  accent: '#ffb347',           // measured amber

  colors: {
    skin: '#a8795c',
    hair: '#14100e',
    eyes: '#c8a860',           // gold-amber
    lips: '#7a5548',
    brows: 'rgba(16,10,8,0.9)',
  },
  hairStyle: 'short',
  face: { browWeight: 1.05 },

  body: {
    height: 1.84, shoulderW: 0.43, hipW: 0.34,
    bust: 0, waist: 1.0, hips: 0.88, build: 1.0,
  },

  personality: {
    breathBase: 0.75, fidget: 0.2,          // unnervingly still
    receptivity: {
      trust: 0.5, openness: 0.4, fear: 0.3, tension: 0.6,
      happiness: 0.7, dominance: 0.9, loyalty: 0.5,
    },
    baseMood: 'confident',
    idleClip: 'idle_stand',
  },

  stats: {
    happiness: 60, openness: 42,
    dominance: 62, trust: 25, tension: 18, energy: 74, sobriety: 100,
    loyalty: 6, fear: 3,
  },

  bio: `Nobody remembers inviting Kai anywhere; he is simply there, already holding
a drink, already knowing your name. He brokers information between factions that
would shoot each other on sight, which means everyone owes him and no one trusts
him. He finds the lockdown fascinating. He finds you more fascinating.`,
};

export default kai;
