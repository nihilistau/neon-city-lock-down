// @ts-check
// Combat stance pose for the player avatar (and any armed character): a raised
// two-handed weapon-ready hold — both forearms up in front, the right hand
// gripping the weapon so its barrel presents forward. Held while combat is
// active (firstPerson.js sets `aiming`). Euler degrees, XYZ, over the A-pose
// bind (arms pull DOWN). Tuned in-browser against the player rig; see
// docs/systems/combat.md. Bones are held static so the weapon stays up; the
// gentle life comes from a head/chest sway track + a hips bob.
import { registerClips } from '../../src/humanoid/clips.js';

registerClips([
  {
    id: 'aim', duration: 3.6, loop: 'pingpong',
    bones: {
      spine1: [9, -4, 0], chest: [6, -2, 0], neck: [2, 3, 0], head: [-7, 4, 0],
      // right arm: forearm up, hand presenting the weapon forward
      clavR: [0, -4, -4], armR: [6, -6, 24], foreR: [80, -42, 0], handR: [-4, -6, 0],
      // left arm: forearm up, bracing toward centre
      clavL: [0, 4, 4], armL: [4, 6, -18], foreL: [76, 44, 0], handL: [4, 6, 0],
      // braced, weight-back legs
      thighL: [-8, 2, -3], thighR: [-3, -2, 5], shinL: [12, 0, 0], shinR: [7, 0, 0],
    },
    tracks: {
      // faint aiming sway (head/chest only, so the arm hold stays put)
      head: [[0, [-7, 3, 0]], [1.8, [-6, 5, 0]], [3.6, [-7, 3, 0]]],
      chest: [[0, [6, -3, 0]], [1.8, [6, -1, 0]], [3.6, [6, -3, 0]]],
    },
    hipsPos: [[0, [0, -0.05, 0.01]], [1.8, [0, -0.03, 0.01]], [3.6, [0, -0.05, 0.01]]],
  },
]);
