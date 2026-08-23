// @ts-check
// You waved the shuttle off. The tower keeps you.

export const STAY_CUTSCENE = [
  { type: 'light', preset: 'neon_night', fade: 1.2 },
  { type: 'teleport', char: 'lola', at: [-3.2, 4.2], yaw: 2.6 },
  { type: 'teleport', char: 'aria', at: [-2.6, 3.6], yaw: 2.8 },
  { type: 'teleport', char: 'kai', at: [-4.4, 3.4], yaw: 0.4 },
  { type: 'anim', char: 'lola', clip: 'gesture_cross_arms' },
  { type: 'anim', char: 'aria', clip: 'idle_shy' },
  {
    type: 'shot',
    from: [6, 2.4, 10], to: [2.2, 1.8, 7], look: [-3, 1.4, 4], dur: 5,
  },
  {
    type: 'line', speaker: 'vox',
    text: 'Shuttle declined. For the record: I am pleased. Redundantly. Permanently. I will stop saying so when it becomes unprofessional.',
  },
  {
    type: 'shot',
    from: [-1.4, 1.65, 2.2], to: [-2.2, 1.55, 1.4], lookChar: 'lola', dur: 4,
  },
  {
    type: 'line', speaker: 'lola',
    text: 'Brave or stupid. I have not decided. Either way you just made yourself my problem a little longer. I can live with that.',
  },
  {
    type: 'line', speaker: 'aria',
    text: 'You stayed. That\'s… I don\'t have a better word. Thank you is too small and I\'m using it anyway.',
  },
  { type: 'titleCard', text: 'YOU STAYED', sub: 'the lockdown is not over · neither are you', dur: 3.2 },
];
