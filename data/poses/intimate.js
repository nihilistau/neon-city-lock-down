// @ts-check
// Intimate bed poses for the in-scene bed game. Played while the partner is
// seated/reclined on the bed surface facing the player (first person). Built on
// a STABLE seated-recline leg base (knees up, feet planted) — the sexual read
// comes from the spine/arms/head/hips, not risky leg contortions, so skinning
// stays clean. Euler degrees, XYZ. Bind pose is A-pose (arms pull DOWN).
import { registerClips } from '../../src/humanoid/clips.js';

// shared reclined-on-the-bed leg base: knees up and slightly apart, feet planted
const LEGS = {
  thighL: [-96, 14, -10], thighR: [-96, -14, 10],
  shinL: [78, 0, 2], shinR: [78, 0, -2],
  footL: [12, 0, 0], footR: [12, 0, 0],
};

registerClips([
  // Reclined, propped back on one arm, the other draped — open and inviting.
  {
    id: 'bed_recline', duration: 5.5, loop: 'pingpong',
    bones: {
      ...LEGS,
      spine1: [-14, 4, 0], chest: [-8, 0, 0], neck: [10, -4, 0],
      armL: [-40, 0, 20], foreL: [70, -20, 0], handL: [10, 0, 0],   // propped behind
      armR: [18, 0, 34], foreR: [40, -10, 10],                       // draped over a knee
    },
    tracks: {
      head: [[0, [4, -8, 2]], [5.5, [8, 8, -2]]],
      hips: [[0, [0, 0, -3]], [2.75, [1, 2, 2]], [5.5, [0, 0, -3]]],  // slow roll
    },
    hipsPos: [[0, [0, -0.24, 0.02]]],
  },

  // Both arms reaching for the player — pull me closer.
  {
    id: 'bed_reach', duration: 3.4, loop: 'pingpong',
    bones: {
      ...LEGS,
      spine1: [8, 2, 0], chest: [6, 0, 0], neck: [-6, 0, 0], head: [-4, 0, 0],
      armR: [-58, 6, 30], foreR: [40, -18, 6], handR: [-8, 0, 0],
      armL: [-58, -6, -30], foreL: [40, 18, -6], handL: [8, 0, 0],
    },
    tracks: {
      foreL: [[0, [40, 18, -6]], [3.4, [30, 22, -6]]],
      foreR: [[0, [40, -18, 6]], [3.4, [30, -22, 6]]],
    },
    hipsPos: [[0, [0, -0.22, 0.05]]],
  },

  // Arched back in pleasure — chest up, head thrown back, hands gripping the sheets.
  {
    id: 'bed_arch', duration: 3.0, loop: 'pingpong',
    bones: {
      ...LEGS,
      spine1: [-22, 0, 0], chest: [-16, 0, 0], neck: [22, 0, 0],
      armL: [-52, 0, 16], foreL: [64, -16, 0], handL: [6, 0, 0],
      armR: [-52, 0, -16], foreR: [64, 16, 0], handR: [-6, 0, 0],
    },
    tracks: {
      head: [[0, [26, -6, 0]], [1.5, [30, 0, 2]], [3.0, [26, 6, 0]]],
      chest: [[0, [-16, 0, 0]], [1.5, [-20, 0, 0]], [3.0, [-16, 0, 0]]],
      hips: [[0, [0, 0, 0]], [1.5, [-4, 0, 0]], [3.0, [0, 0, 0]]],
    },
    hipsPos: [[0, [0, -0.20, 0]]],
  },

  // Leaning forward over the player — hands planted, hips lifted, head low and close.
  {
    id: 'bed_straddle', duration: 3.6, loop: 'pingpong',
    bones: {
      thighL: [-104, 16, -12], thighR: [-104, -16, 12],
      shinL: [92, 0, 2], shinR: [92, 0, -2], footL: [16, 0, 0], footR: [16, 0, 0],
      spine1: [26, 0, 0], chest: [14, 0, 0], neck: [-18, 0, 0], head: [-14, 0, 0],
      armL: [-70, 0, 12], foreL: [50, -12, 0], handL: [14, 0, 0],
      armR: [-70, 0, -12], foreR: [50, 12, 0], handR: [-14, 0, 0],
    },
    tracks: {
      hips: [[0, [0, 0, 0]], [1.8, [10, 0, 0]], [3.6, [0, 0, 0]]],       // rock
      head: [[0, [-14, -6, 0]], [1.8, [-10, 0, 0]], [3.6, [-14, 6, 0]]],
    },
    hipsPos: [[0, [0, -0.16, 0.12]]],
  },

  // Climax — hard arch, head flung back, one hand gripping her own hair, shuddering.
  {
    id: 'bed_climax', duration: 1.8, loop: 'pingpong',
    bones: {
      ...LEGS,
      spine1: [-26, 4, 0], chest: [-20, 0, 0], neck: [26, 0, 0],
      armR: [-120, 10, 10], foreR: [90, -10, 0], handR: [10, 0, 0],       // hand to hair
      armL: [-46, 0, 18], foreL: [70, -14, 0], handL: [8, 0, 0],
    },
    tracks: {
      head: [[0, [28, -4, -2]], [0.45, [32, 2, 2]], [0.9, [28, 6, -2]], [1.35, [32, 2, 2]], [1.8, [28, -4, -2]]],
      chest: [[0, [-20, 0, 0]], [0.45, [-24, 0, 2]], [0.9, [-18, 0, -2]], [1.8, [-20, 0, 0]]],
      hips: [[0, [-2, 0, 0]], [0.45, [-8, 0, 3]], [0.9, [-2, 0, -3]], [1.8, [-2, 0, 0]]],
    },
    hipsPos: [[0, [0, -0.18, 0]]],
  },
]);
