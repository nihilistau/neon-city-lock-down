// @ts-check
// Soft 19:00 dinner. Teleports first so a skip still leaves people at the bar.

const LOUNGE = [
  { type: 'teleport', char: 'lola', at: [3.2, -3.1], yaw: Math.PI },
  { type: 'teleport', char: 'aria', at: [4.2, -3.1], yaw: Math.PI },
  { type: 'teleport', char: 'kai', at: [5.2, -3.1], yaw: Math.PI },
  { type: 'anim', char: 'lola', clip: 'sit_relaxed' },
  { type: 'anim', char: 'aria', clip: 'sit_relaxed' },
  { type: 'anim', char: 'kai', clip: 'sit_relaxed' },
  { type: 'light', preset: 'neon_night', fade: 0.8 },
  { type: 'shot', from: [4.2, 1.7, -0.6], to: [4.2, 1.45, -1.8], look: [4.2, 1.1, -4.2], dur: 3.2 },
];

const VOX = [
  'The whiskey is the correct temperature. I have opinions about that now. Sit. Eat what we have.',
  'Day-cycle complete enough. If you require a toast, I can invent one that is not a maintenance log.',
  'The city is louder tonight. Inside, you are quieter. I prefer this arrangement.',
];

const CAST = [
  { speaker: 'lola', text: 'Sit down. Nobody impresses me by hovering. The noodles are almost food.' },
  { speaker: 'aria', text: 'I set three bowls. That is the whole speech. Please don\'t make it a bigger thing.' },
  { speaker: 'kai', text: 'A table is a truce. Cheap, local, and it expires at dessert. I recommend using it.' },
];

/** @param {number} [day] */
export function dinnerCutscene(day = 1) {
  const i = Math.max(0, day - 1) % 3;
  return [
    ...LOUNGE,
    { type: 'line', speaker: 'vox', text: VOX[i] },
    { type: 'line', speaker: CAST[i].speaker, text: CAST[i].text },
    { type: 'wait', sec: 0.4 },
  ];
}
