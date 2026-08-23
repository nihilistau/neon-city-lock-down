// @ts-check
// The licensed extraction. Seats limited. The city falls away.

export const SHUTTLE_CUTSCENE = [
  { type: 'light', preset: 'dawn_grey', fade: 1.4 },
  {
    type: 'shot',
    from: [210, 4.5, 12], to: [204, 3.2, 6], look: [200, 1.2, 0], dur: 5.5,
  },
  {
    type: 'line', speaker: 'vox',
    text: 'Rooftop is clear. I have filed a complaint with whoever sells miracles. It will not be read. Go. I will keep the lights on for whoever is left.',
  },
  {
    type: 'shot',
    from: [198, 2.2, -4], to: [201, 8, 18], look: [4, 2, 40], dur: 6,
  },
  {
    type: 'line', speaker: 'vox',
    text: 'The city is still burning. That is not your assignment anymore. Goodbye, resident. I have enjoyed not being a maintenance request.',
  },
  { type: 'titleCard', text: 'EXTRACTED', sub: 'the tower remembers · the city does not forgive', dur: 3.4 },
];
