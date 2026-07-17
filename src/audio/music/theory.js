// @ts-check
// PURE music theory: scales, chord walks. Unit-testable, no WebAudio.

export const SCALES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

/** Markov chord-degree transitions (noir flavour: i→VI→III→VII orbits). */
const CHORD_WALK = {
  0: [[5, 0.35], [2, 0.2], [6, 0.25], [3, 0.2]],   // i  → VI/III/VII/iv
  2: [[6, 0.4], [0, 0.3], [5, 0.3]],               // III
  3: [[0, 0.5], [6, 0.3], [5, 0.2]],               // iv
  5: [[6, 0.35], [2, 0.3], [0, 0.35]],             // VI
  6: [[0, 0.55], [5, 0.25], [3, 0.2]],             // VII
};

/**
 * @param {number} current degree index
 * @param {() => number} rand 0..1
 * @returns {number} next degree
 */
export function nextDegree(current, rand) {
  const options = CHORD_WALK[current] || [[0, 1]];
  let roll = rand();
  for (const [deg, p] of options) {
    roll -= p;
    if (roll <= 0) return deg;
  }
  return options[options.length - 1][0];
}

/**
 * Build a chord (semitone offsets from key root) on a scale degree.
 * @param {number[]} scale @param {number} degree @param {number} [notes] triad=3
 */
export function chordOn(scale, degree, notes = 3) {
  const out = [];
  for (let i = 0; i < notes; i++) {
    const idx = degree + i * 2;
    const oct = Math.floor(idx / scale.length);
    out.push(scale[idx % scale.length] + oct * 12);
  }
  return out;
}

/** midi note number → frequency */
export function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

/**
 * Pick a scale tone near a previous one (melodic wander for arps).
 * @param {number[]} scale @param {number} prevIdx @param {() => number} rand
 */
export function wander(scale, prevIdx, rand) {
  const step = rand() < 0.6 ? (rand() < 0.5 ? -1 : 1) : (rand() < 0.5 ? -2 : 2);
  const n = scale.length * 2; // two octaves
  let idx = prevIdx + step;
  if (idx < 0) idx = 0;
  if (idx >= n) idx = n - 1;
  return idx;
}
