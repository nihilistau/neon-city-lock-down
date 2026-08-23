// @ts-check
// The player character's visible body (used for third-person + first-person
// combat). Proportions/colours flex with the chosen gender and appearance.

export const SKIN_TONES = ['#e8c4a8', '#d4a07a', '#b98a6e', '#8a6752', '#6e5142', '#3d2a22'];
export const HAIR_COLORS = ['#141018', '#3a2418', '#8a5a28', '#c4c0c8', '#1a1420', '#1a4a55'];
export const HAIR_STYLES = ['short', 'bob', 'long', 'undercut', 'ponytail', 'slick', 'pixie'];

export const DEFAULT_APPEARANCE = {
  skin: '#b98a6e',
  hair: '#141018',
  hairStyle: 'bob',
  height: 1.74,
  build: 1.0,
};

/**
 * @param {string} name
 * @param {'she'|'he'} pronouns
 * @param {{skin?:string, hair?:string, hairStyle?:string, height?:number, build?:number}} [look]
 */
export function buildPlayerPersona(name = 'Cipher', pronouns = 'she', look = {}) {
  const male = pronouns === 'he';
  const skin = look.skin || DEFAULT_APPEARANCE.skin;
  const hair = look.hair || (male ? '#141018' : DEFAULT_APPEARANCE.hair);
  const hairStyle = HAIR_STYLES.includes(look.hairStyle)
    ? look.hairStyle
    : (male ? 'short' : 'bob');
  const height = Math.max(1.60, Math.min(1.92, look.height || (male ? 1.82 : 1.74)));
  const build = Math.max(0.85, Math.min(1.25, look.build || (male ? 1.15 : 1.0)));
  const scale = height / (male ? 1.82 : 1.74);
  return {
    id: 'player',
    name,
    archetype: 'the legend',
    voice: male ? 'casual_male' : 'neutral_female',
    accent: '#39e6ff',
    colors: {
      skin,
      hair,
      eyes: '#39e6ff',
      lips: male ? '#7a4636' : '#8a3a4a',
      brows: 'rgba(18,12,16,0.9)',
    },
    hairStyle,
    // No faceAsset, deliberately. The player picks from 6 skin tones, 6 hair
    // colours and 7 styles above; a fixed face texture contradicts every one of
    // those choices. v0.4's player-f had cyan pixie hair, a face tattoo and a
    // hoop earring painted into it, so choosing dark skin and long blonde hair
    // produced a dark-skinned body wearing a light-skinned tattooed face under
    // blonde strands. The procedural face derives from `colors` instead.
    face: { browWeight: male ? 1.3 : 1.0 },
    body: male
      ? { height, shoulderW: 0.46 * scale, hipW: 0.36 * scale, bust: 0, waist: 1.0, hips: 0.92, build }
      : { height, shoulderW: 0.40 * scale, hipW: 0.37 * scale, bust: 0.9, waist: 0.9, hips: 1.04, build },
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
