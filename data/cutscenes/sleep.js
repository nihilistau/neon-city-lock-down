// @ts-check
// 01:00 peel-off. People go to bed even if you skip the lines.

/** @param {number} [day] */
export function sleepCutscene(day = 1) {
  return [
    { type: 'light', preset: 'candlelit', fade: 1.0 },
    { type: 'teleport', char: 'aria', at: [-12.2, 2.4], yaw: 0.4 },
    { type: 'teleport', char: 'lola', at: [-11.0, 2.8], yaw: -0.3 },
    { type: 'teleport', char: 'kai', at: [-9.8, 4.4], yaw: Math.PI },
    { type: 'anim', char: 'aria', clip: 'lounge' },
    { type: 'anim', char: 'lola', clip: 'lounge' },
    { type: 'shot', from: [-9.4, 1.8, 0.6], to: [-10.6, 1.5, 1.8], look: [-12.0, 1.1, 3.2], dur: 3.4 },
    {
      type: 'line', speaker: 'vox',
      text: day % 2
        ? 'Lights down. I will keep the quiet ones. Sleep is not a request I can file, but I can dim the hall.'
        : 'The hour is indecent. I am turning the corridors into a suggestion. Use it.',
    },
    { type: 'wait', sec: 0.4 },
  ];
}
