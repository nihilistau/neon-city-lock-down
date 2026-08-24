// @ts-check
// Base locomotion + idle + social pose clips. Euler degrees, XYZ order.
// Bind pose is A-pose, so a relaxed standing idle must pull the arms DOWN
// toward the body (negative-ish rotations on armL/armR about Z).
import { registerClips } from '../../src/humanoid/clips.js';

registerClips([
  // Arms rest ~ along the sides from the A-pose splay.
  {
    id: 'idle_stand',
    duration: 4.2, loop: 'pingpong',
    tracks: {
      armL: [[0, [3, 0, -34]], [4.2, [1, 0, -36]]],
      armR: [[0, [3, 0, 34]], [4.2, [1, 0, 36]]],
      foreL: [[0, [6, 8, -6]], [4.2, [10, 6, -4]]],
      foreR: [[0, [6, -8, 6]], [4.2, [10, -6, 4]]],
      spine1: [[0, [2, 0, 0]], [4.2, [3.2, 0, 0]]],
      chest: [[0, [0, 0, 0]], [4.2, [1, 0, 0]]],
      head: [[0, [2, 0, 0]], [4.2, [0, 0, 0]]],
    },
  },
  // Confident wide stance (Lola default) — hip cocked, chin up.
  {
    id: 'idle_confident',
    duration: 5.0, loop: 'pingpong',
    tracks: {
      armL: [[0, [2, 0, -30]], [5, [0, 0, -33]]],
      armR: [[0, [2, 0, 30]], [5, [0, 0, 33]]],
      foreL: [[0, [12, 10, -8]], [5, [16, 8, -6]]],
      foreR: [[0, [12, -10, 8]], [5, [16, -8, 6]]],
      hips: [[0, [-1, 0, 5]], [5, [-1, 0, 6.5]]],
      spine1: [[0, [1, 0, -3]], [5, [1.5, 0, -4]]],
      chest: [[0, [-2, 0, 2]], [5, [-2.5, 0, 2.5]]],
      head: [[0, [-3, 4, 0]], [5, [-3, 2, 0]]],
      thighL: [[0, [0, 0, -3]], [5, [0, 0, -3]]],
      thighR: [[0, [0, 0, 4]], [5, [0, 0, 4]]],
    },
  },
  // Shy closed idle (Aria default) — arms drawn in, slight forward fold.
  {
    id: 'idle_shy',
    duration: 4.6, loop: 'pingpong',
    tracks: {
      armL: [[0, [8, 0, -40]], [4.6, [6, 0, -42]]],
      armR: [[0, [8, 0, 40]], [4.6, [6, 0, 42]]],
      foreL: [[0, [55, 20, -8]], [4.6, [58, 18, -6]]],
      foreR: [[0, [55, -20, 8]], [4.6, [58, -18, 6]]],
      handL: [[0, [0, 0, -10]], [4.6, [0, 0, -8]]],
      spine1: [[0, [5, 0, 2]], [4.6, [6, 0, 1]]],
      chest: [[0, [4, 0, 0]], [4.6, [5, 0, 0]]],
      head: [[0, [8, -3, 0]], [4.6, [7, 2, 0]]],
    },
  },
  // Walk base pose (gait layer adds the cycle on top; this sets carriage).
  {
    id: 'walk',
    duration: 0, loop: 'hold',
    bones: {
      armL: [4, 0, -32], armR: [4, 0, 32],
      foreL: [22, 8, -4], foreR: [22, -8, 4],
      spine1: [4, 0, 0], chest: [-1, 0, 0], head: [-1, 0, 0],
    },
  },
  // Sit — used with a seat socket; hips drop handled by socket placement.
  {
    id: 'sit_relaxed',
    duration: 5.5, loop: 'pingpong',
    bones: {
      thighL: [-88, 4, -3], thighR: [-88, -4, 3],
      shinL: [85, 0, 0], shinR: [85, 0, 0],
      footL: [8, 0, 0], footR: [8, 0, 0],
      armL: [6, 0, -26], armR: [6, 0, 26],
      foreL: [40, 10, -6], foreR: [40, -10, 6],
      spine1: [-4, 0, 0], chest: [2, 0, 0],
    },
    tracks: {
      head: [[0, [2, -5, 0]], [5.5, [1, 5, 0]]],
    },
    hipsPos: [[0, [0, -0.34, -0.02]]],
  },
  // Lounge — reclined, one arm draped (couch/bed).
  {
    id: 'lounge',
    duration: 6, loop: 'pingpong',
    bones: {
      thighL: [-52, 8, -6], thighR: [-40, -12, 8],
      shinL: [48, 0, 0], shinR: [30, 0, 0],
      armL: [10, 0, -18], armR: [-30, 0, 44],
      foreL: [30, 0, 0], foreR: [70, -10, 10],
      spine1: [-10, 3, 0], chest: [-6, 0, 0], neck: [8, 0, 0], head: [6, -6, 0],
    },
    hipsPos: [[0, [0, -0.30, 0]]],
  },
  // Sitting, leaning into a partner on the character's left (couch seat1 → seat0).
  {
    id: 'sit_lean_partner',
    duration: 5.2, loop: 'pingpong',
    bones: {
      thighL: [-84, 6, -4], thighR: [-86, -2, 2],
      shinL: [82, 0, 0], shinR: [86, 0, 0],
      footL: [6, 0, 0], footR: [8, 0, 0],
      armL: [12, 0, -38], armR: [8, 0, 20],
      foreL: [30, 14, -4], foreR: [48, -16, 6],
      spine1: [-2, 6, -8], chest: [1, 8, -6],
      neck: [0, 4, -7],
    },
    tracks: {
      head: [[0, [3, 10, -8]], [5.2, [5, 14, -10]]],
    },
    hipsPos: [[0, [0.05, -0.34, -0.02]]],
  },
  // Combat crouch — knees bent low behind cover, braced, alert.
  {
    id: 'crouch',
    duration: 3.2, loop: 'pingpong',
    bones: {
      thighL: [-70, 8, -6], thighR: [-95, -6, 4],
      shinL: [95, 0, 0], shinR: [110, 0, 0],
      footL: [10, 0, 0], footR: [24, 0, 0],
      spine1: [18, 0, 0], chest: [8, 0, 0],
      armL: [20, 0, -30], armR: [35, 0, 25],
      foreL: [55, 15, -5], foreR: [70, -20, 5],
    },
    tracks: {
      head: [[0, [-12, -6, 0]], [3.2, [-12, 8, 0]]],   // scanning over the cover
    },
    hipsPos: [[0, [0, -0.42, -0.06]]],
  },
  // Talk gesture accents (short, non-looping; layered by dialogue).
  {
    id: 'gesture_lean_in',
    duration: 1.2, loop: 'hold',
    tracks: {
      spine1: [[0, [2, 0, 0]], [0.5, [10, 0, 0]], [1.2, [8, 0, 0]]],
      chest: [[0, [0, 0, 0]], [0.5, [6, 0, 0]], [1.2, [5, 0, 0]]],
      head: [[0, [0, 0, 0]], [0.5, [-4, 0, 0]], [1.2, [-3, 0, 0]]],
      armR: [[0, [2, 0, 30]], [0.6, [10, 0, 22]], [1.2, [8, 0, 24]]],
    },
  },
  {
    id: 'gesture_shrug',
    duration: 1.0, loop: 'hold',
    tracks: {
      clavL: [[0, [0, 0, 0]], [0.4, [0, 0, -8]], [1, [0, 0, 0]]],
      clavR: [[0, [0, 0, 0]], [0.4, [0, 0, 8]], [1, [0, 0, 0]]],
      armL: [[0, [3, 0, -32]], [0.4, [3, 0, -20]], [1, [3, 0, -32]]],
      armR: [[0, [3, 0, 32]], [0.4, [3, 0, 20]], [1, [3, 0, 32]]],
      foreL: [[0, [10, 0, 0]], [0.4, [40, 30, 0]], [1, [10, 0, 0]]],
      foreR: [[0, [10, 0, 0]], [0.4, [40, -30, 0]], [1, [10, 0, 0]]],
    },
  },
  {
    // MEASURED, not eyeballed. The old values spread the elbows APART — from the
    // idle 0.475m to 0.630m — and put the hands 20cm BEHIND the torso, so the
    // "arms crossed" gesture rendered as a shrug bordering on a T-pose. It is
    // what the intro cutscene puts Lola in, so it was the first pose a new
    // player ever saw. Swept the parameter space against the real rig and scored
    // on elbow tuck, hand proximity and how far in front of the chest the hands
    // land: elbows now 0.223m apart, hands meeting at chest height 19cm forward.
    id: 'gesture_cross_arms',
    duration: 4, loop: 'pingpong',
    bones: {
      armL: [8, 0, -60], armR: [8, 0, 60],
      foreL: [-95, 75, 0], foreR: [-95, -75, 0],
      chest: [-3, 0, 0], head: [-2, 0, 0],
    },
  },
  // Dance sway — tempoScaled so arousal/energy speeds it.
  {
    id: 'dance_sway',
    duration: 2.4, loop: 'loop', tempoScaled: true,
    tracks: {
      hips: [[0, [0, 0, -8]], [0.6, [2, 8, 0]], [1.2, [0, 0, 8]], [1.8, [2, -8, 0]], [2.4, [0, 0, -8]]],
      spine1: [[0, [2, 0, 6]], [1.2, [2, 0, -6]], [2.4, [2, 0, 6]]],
      chest: [[0, [-2, 6, -4]], [1.2, [-2, -6, 4]], [2.4, [-2, 6, -4]]],
      armL: [[0, [10, 0, -50]], [1.2, [30, 0, -70]], [2.4, [10, 0, -50]]],
      armR: [[0, [30, 0, 70]], [1.2, [10, 0, 50]], [2.4, [30, 0, 70]]],
      foreL: [[0, [40, 20, 0]], [1.2, [70, 30, 0]], [2.4, [40, 20, 0]]],
      foreR: [[0, [70, -30, 0]], [1.2, [40, -20, 0]], [2.4, [70, -30, 0]]],
      head: [[0, [0, 8, -4]], [1.2, [0, -8, 4]], [2.4, [0, 8, -4]]],
    },
  },
]);
