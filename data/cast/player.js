// @ts-check
// The player character's visible body (used for third-person + first-person
// combat). Proportions/colours flex with the chosen gender; name comes from
// settings. The player has no dialogue persona — this is purely the avatar.

/**
 * @param {string} name @param {'she'|'he'} pronouns
 * @returns {any} a persona object shaped like data/cast/*.js for Actor3D
 */
export function buildPlayerPersona(name = 'Cipher', pronouns = 'she') {
  const male = pronouns === 'he';
  return {
    id: 'player',
    name,
    archetype: 'the legend',
    voice: male ? 'casual_male' : 'neutral_female',
    accent: '#39e6ff',          // cyan rim — reads as "you"
    colors: {
      skin: '#b98a6e',
      hair: '#141018',
      eyes: '#39e6ff',
      lips: male ? '#7a4636' : '#8a3a4a',
      brows: 'rgba(18,12,16,0.9)',
    },
    hairStyle: male ? 'short' : 'bob',
    face: { browWeight: male ? 1.3 : 1.0 },
    body: male
      ? { height: 1.82, shoulderW: 0.46, hipW: 0.36, bust: 0, waist: 1.0, hips: 0.92, build: 1.15 }
      : { height: 1.74, shoulderW: 0.40, hipW: 0.37, bust: 0.9, waist: 0.9, hips: 1.04, build: 1.0 },
    personality: {
      breathBase: 1.0, fidget: 0.3,
      receptivity: {},
      baseMood: 'confident',
      idleClip: 'idle_confident',
    },
    stats: {},
    bio: 'You. The one they still tell stories about.',
  };
}
