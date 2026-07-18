// @ts-check
// Day-3 balcony beat — the trio watches the city burn. Fires at dusk on day 3.

export const DAY3_CUTSCENE = [
  { type: 'light', preset: 'golden_hour', fade: 1.5 },
  { type: 'teleport', char: 'lola', at: [3.2, 8.0], yaw: Math.PI },
  { type: 'teleport', char: 'aria', at: [4.4, 8.2], yaw: Math.PI },
  { type: 'teleport', char: 'kai', at: [5.6, 7.9], yaw: Math.PI },
  { type: 'anim', char: 'lola', clip: 'gesture_cross_arms' },
  { type: 'anim', char: 'aria', clip: 'idle_shy' },
  { type: 'anim', char: 'kai', clip: 'idle_stand' },

  { type: 'titleCard', text: 'DAY THREE', sub: 'the fires learn to move', dur: 2.8 },

  // wide from beyond the rail, the three silhouetted against the burning city
  { type: 'shot', from: [4.2, 3.2, 16], to: [4.2, 1.9, 11.5], look: [4.2, 1.5, 7.5], dur: 6 },
  { type: 'line', speaker: 'vox', bakedId: 'cut.day3.1',
    text: 'Day three. The fires have opinions now. They move with purpose.' },

  { type: 'shot', from: [2.0, 1.7, 9.6], to: [3.4, 1.6, 9.2], lookChar: 'aria', dur: 4.5 },
  { type: 'line', speaker: 'aria', bakedId: 'cut.day3.2',
    text: 'It is almost beautiful from up here. Is that terrible? That it can burn and still be beautiful?' },

  { type: 'shot', from: [6.8, 1.8, 9.4], to: [6.0, 1.65, 9.0], lookChar: 'kai', dur: 4 },
  { type: 'line', speaker: 'kai', bakedId: 'cut.day3.3',
    text: 'Everything valuable is a little bit on fire. That is what makes it valuable.' },

  { type: 'shot', from: [4.2, 1.6, 10.5], to: [3.6, 1.7, 9.6], lookChar: 'lola', dur: 4.5 },
  { type: 'line', speaker: 'lola', bakedId: 'cut.day3.4',
    text: 'Enjoy the view, both of you. Cities grow back. People do not. Stay sharp.' },

  { type: 'light', preset: 'neon_night', fade: 3 },
];
