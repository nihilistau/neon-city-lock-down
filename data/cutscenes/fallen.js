// @ts-check
// A named cast member is gone. VOX logs it. The room is smaller.

/** @param {string} name */
export function fallenCutscene(name = 'Someone') {
  return [
    { type: 'light', preset: 'security_red', fade: 0.9 },
    {
      type: 'shot',
      from: [2.4, 2.1, 6.2], to: [1.1, 1.7, 3.8], look: [-2.2, 1.15, 1.2], dur: 4.2,
    },
    {
      type: 'line', speaker: 'vox',
      text: `${name} is down. I am required to log this. I am not required to like it.`,
    },
    { type: 'titleCard', text: String(name).toUpperCase(), sub: 'the tower is smaller now', dur: 2.6 },
  ];
}
