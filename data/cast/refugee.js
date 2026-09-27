// @ts-check
// Named guests who make it through the doors. Corporeal — they eat, they can die,
// they have a face. The integer `run.refugees` is history; the body is the mouth.

const NAMES = [
  ['Rook', 'she'],
  ['Daren', 'he'],
  ['Nim', 'she'],
  ['Vesper', 'he'],
];

const SKIN = ['#c4a07a', '#8a6752', '#e0c4a8', '#6e5142'];
const HAIR = ['#1a1420', '#3a2418', '#4a3020', '#0c0a10'];

/**
 * @param {number} index
 * @returns {any} persona shaped like data/cast/*.js
 */
export function buildRefugee(index) {
  const i = Math.max(0, index | 0);
  const [name, pro] = NAMES[i % NAMES.length];
  const female = pro === 'she';
  return {
    id: i === 0 ? 'refugee' : `refugee${i + 1}`,
    name,
    archetype: 'uninvited guest',
    voice: female ? 'neutral_female' : 'casual_male',
    accent: '#7d93a3',
    corporeal: true,
    colors: {
      skin: SKIN[i % SKIN.length],
      hair: HAIR[i % HAIR.length],
      eyes: '#b0b8c0',
      lips: female ? '#8a3a4a' : '#5c4038',
      brows: 'rgba(18,12,16,0.9)',
    },
    hairStyle: female ? 'bob' : 'short',
    face: { browWeight: female ? 1.0 : 1.25 },
    body: female
      ? { height: 1.68, shoulderW: 0.38, hipW: 0.36, bust: 0.7, waist: 0.92, hips: 1.02, build: 0.92 }
      : { height: 1.78, shoulderW: 0.44, hipW: 0.34, bust: 0, waist: 1.02, hips: 0.9, build: 1.05 },
    personality: {
      breathBase: 1.15, fidget: 0.7,
      receptivity: { fear: 1.4, trust: 1.2, tension: 1.3, happiness: 0.8 },
      baseMood: 'afraid',
      idleClip: 'idle_stand',
    },
    stats: {
      happiness: 22, openness: 40,
      dominance: 18, trust: 12, tension: 55, energy: 38, sobriety: 100,
      loyalty: 6, fear: 62,
    },
    bio: 'Came in bleeding. Staying is a negotiation that resets every hour.',
  };
}

export default buildRefugee;
