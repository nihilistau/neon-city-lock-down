// @ts-check
// Cold Open — Day One of the lockdown. Establishes the city, the penthouse,
// and the three sharks in the tank. Voiced lines use baked takes from
// data/voiceScript.js (cut.intro.1 / cut.intro.2).

export const INTRO_CUTSCENE = [
  { type: 'light', preset: 'neon_night', fade: 0.01 },
  { type: 'teleport', char: 'lola', at: [-3.2, 4.2], yaw: 2.6 },   // at the window, watching the city
  { type: 'teleport', char: 'aria', at: [-3.4, -1.0], yaw: 0.2 }, // near the couch
  { type: 'anim', char: 'lola', clip: 'gesture_cross_arms' },
  { type: 'anim', char: 'aria', clip: 'idle_shy' },

  { type: 'titleCard', text: 'NEON-CITY', sub: 'day one of the lockdown', dur: 3.2 },

  // high exterior drift: the burning city through the glass
  {
    type: 'shot',
    from: [14, 7, 20], to: [7, 3.4, 12], look: [-2, 2, -2], dur: 6.5,
  },
  {
    type: 'line', speaker: 'vox', bakedId: 'cut.intro.1',
    text: 'Neon City. Day one of the lockdown. The gates are down and the streets belong to the fire.',
  },

  // slide in through the glass toward the lounge
  {
    type: 'shot',
    from: [5, 2.2, 8], to: [-0.5, 1.7, 3.4], look: [-3.5, 1.3, 0], dur: 5,
  },

  // Lola turns from the window and delivers the thesis
  { type: 'look', char: 'lola', target: 'camera' },
  { type: 'face', char: 'lola', expr: { mouth: 'smirk', browRaise: -0.15 } },
  {
    type: 'shot',
    from: [-1.6, 1.7, 2.6], to: [-2.6, 1.55, 1.2], lookChar: 'lola', dur: 4.5,
  },
  {
    type: 'line', speaker: 'lola', bakedId: 'cut.intro.2',
    text: 'So we are stuck in here together. Three sharks in a very expensive tank. This should be fun.',
  },

  { type: 'titleCard', text: 'LOCK-DOWN', sub: 'survive the nights · manage the tower · trust no one entirely', dur: 3.4 },
];
