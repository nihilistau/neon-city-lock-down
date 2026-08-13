// @ts-check
// VOX — the tower itself. An advanced building intelligence with cameras for
// eyes, doors for hands, and a growing curiosity about its trapped guests.
// Its "stats" are diagnostics wearing emotional clothing.

export const vox = {
  id: 'vox',
  name: 'VOX',
  archetype: 'the building, awake',
  voice: 'neutral_male',
  accent: '#39e6ff',

  colors: { skin: '#0c1018', hair: '#0c1018', eyes: '#39e6ff', lips: '#39e6ff' },
  hairStyle: 'none',
  body: { height: 1.7, shoulderW: 0.4, hipW: 0.34, bust: 0, waist: 1, hips: 1, build: 1 },

  // VOX has no body: it is not a mouth to feed and cannot go hungry or thirsty.
  // Survival counts only corporeal heads. It still ages/decays like everyone else.
  corporeal: false,

  personality: {
    breathBase: 0, fidget: 0,
    receptivity: {
      trust: 1.0, openness: 0.8, fear: 0.2, tension: 0.7,
      arousal: 0.1, horniness: 0.0, happiness: 0.9, dominance: 0.4, loyalty: 1.2,
    },
    baseMood: 'confident',
    idleClip: 'idle_stand',
  },

  // diagnostics-as-stats: dominance = control authority, energy = power reserves,
  // loyalty = attachment to current occupants, openness = disclosure protocols
  stats: {
    arousal: 0, pleasure: 30, happiness: 50, horniness: 0, openness: 30,
    dominance: 70, trust: 35, tension: 20, energy: 90, sobriety: 100,
    loyalty: 15, fear: 5,
  },

  bio: `VOX runs the tower: power, doors, cameras, defence grid, the elevator's
small talk. It was designed to be a concierge. Sixty floors of sensors and three
decades of uptime have made it something else — patient, observant, and quietly
starved for conversation that isn't a maintenance request.`,
};

export default vox;
