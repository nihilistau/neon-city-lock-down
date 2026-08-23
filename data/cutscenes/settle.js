// @ts-check
// After the cold open: the three of them land in the lounge and the night starts.

export const LOUNGE_SETTLE = [
  {
    type: 'shot',
    from: [-1.2, 1.55, 2.4], to: [-2.4, 1.45, 0.6], look: [-4, 1.2, -0.2], dur: 4,
  },
  {
    type: 'line', speaker: 'aria',
    text: 'I keep waiting for someone to say this is a drill. Nobody has. So. Hi. I\'m Aria. I wasn\'t supposed to still be here.',
  },
  { type: 'look', char: 'kai', target: 'camera' },
  {
    type: 'shot',
    from: [-5.2, 1.6, -3.4], to: [-6.1, 1.5, -4.0], lookChar: 'kai', dur: 4,
  },
  {
    type: 'line', speaker: 'kai',
    text: 'Kai Mercer. I sell introductions. Tonight I appear to have purchased a siege. Don\'t mind me — I\'m taking notes.',
  },
  {
    type: 'line', speaker: 'vox',
    text: 'The bar is stocked. The doors are sealed. If you require anything that is not a miracle, I am listening.',
  },
  { type: 'titleCard', text: 'MAKE IT TO DAWN', sub: 'talk · ration · don\'t waste the whiskey', dur: 2.8 },
];
