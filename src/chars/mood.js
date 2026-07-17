// @ts-check
// PURE stats → mood label + expression hints. Drives dialogue line variants,
// idle animation choice, and default facial expression.

/** @typedef {import('../core/types.js').StatKey} StatKey */

/**
 * Named moods with the scoring function over stats. Highest score wins.
 * Order matters only for ties (earlier wins).
 * @type {{id:string, score:(s:Record<StatKey,number>)=>number, face:any, idle?:string}[]}
 */
export const MOODS = [
  {
    id: 'volatile',
    score: (s) => s.tension * 0.85 + s.fear * 0.2 - s.happiness * 0.2,
    face: { mouth: 'grit', browAngle: -0.6, browRaise: -0.4 },
    idle: 'gesture_cross_arms',
  },
  {
    id: 'afraid',
    score: (s) => s.fear * 0.9 - s.dominance * 0.2,
    face: { mouth: 'frown', browAngle: 0.5, browRaise: 0.3, pupil: 0.7 },
    idle: 'idle_shy',
  },
  {
    id: 'sultry',
    score: (s) => s.arousal * 0.5 + s.horniness * 0.4 - s.tension * 0.3,
    face: { mouth: 'smirk', browRaise: -0.15, blush: 0.4, pupil: 0.7 },
    idle: 'idle_confident',
  },
  {
    id: 'playful',
    score: (s) => s.happiness * 0.4 + s.openness * 0.3 + (100 - s.tension) * 0.2 - s.dominance * 0.1,
    face: { mouth: 'grin', browRaise: 0.2 },
    idle: 'idle_stand',
  },
  {
    id: 'confident',
    score: (s) => s.dominance * 0.5 + s.happiness * 0.2 + (100 - s.fear) * 0.2,
    face: { mouth: 'smirk', browRaise: -0.1 },
    idle: 'idle_confident',
  },
  {
    id: 'guarded',
    // closed-off but composed; genuine tension tips into volatile instead
    score: (s) => (100 - s.openness) * 0.42 + (100 - s.trust) * 0.42 - s.tension * 0.15,
    face: { mouth: 'neutral', browAngle: -0.2, browRaise: -0.1 },
    idle: 'gesture_cross_arms',
  },
  {
    id: 'exhausted',
    score: (s) => (100 - s.energy) * 0.6 - s.arousal * 0.2,
    face: { mouth: 'neutral', lids: 0.4, browRaise: -0.2 },
    idle: 'idle_stand',
  },
  {
    id: 'warm',
    score: (s) => s.happiness * 0.35 + s.trust * 0.3 + s.loyalty * 0.2,
    face: { mouth: 'smile', browRaise: 0.1, blush: 0.15 },
    idle: 'idle_stand',
  },
];

/**
 * @param {Record<StatKey, number>} stats
 * @returns {{id:string, face:any, idle:string}}
 */
export function deriveMood(stats) {
  let best = MOODS[MOODS.length - 1], bestScore = -Infinity;
  for (const m of MOODS) {
    const sc = m.score(stats);
    if (sc > bestScore) { bestScore = sc; best = m; }
  }
  return { id: best.id, face: best.face, idle: best.idle || 'idle_stand' };
}

/**
 * Tempo scalar for arousal/energy-scaled animation. 0.7 (drained) .. 1.6 (charged).
 * @param {Record<StatKey, number>} stats
 */
export function animTempo(stats) {
  const arousal = stats.arousal / 100, energy = stats.energy / 100;
  return 0.7 + arousal * 0.6 + energy * 0.3;
}
