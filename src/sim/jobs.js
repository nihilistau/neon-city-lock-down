// @ts-check
// Spatial destinations for day-plan actions. The plan panel still spends AP
// through dayPlan.performAction; App.startJob rides the elevator there first
// so "forage" actually happens on the roof.

/** @type {Record<string, {floor:string, zone:string, durationMin:number, label:string}>} */
export const JOB_DEST = {
  repair:  { floor: 'fl27',      zone: 'vox_core',   durationMin: 10, label: 'VOX core' },
  fortify: { floor: 'fl40',      zone: 'armoury',    durationMin: 10, label: 'the armoury' },
  forage:  { floor: 'rooftop',   zone: 'rooftop',    durationMin: 8,  label: 'the rooftop garden' },
  train:   { floor: 'fl40',      zone: 'armoury',    durationMin: 8,  label: 'the range' },
  rest:    { floor: 'penthouse', zone: 'bed_alcove', durationMin: 12, label: 'the bed alcove' },
  deal:    { floor: 'fl27',      zone: 'vox_core',   durationMin: 10, label: 'VOX\'s terminal' },
  // refugees work the same beds you do, and leave through the doors they came in
  refugee_work:    { floor: 'rooftop', zone: 'rooftop',   durationMin: 8, label: 'the rooftop garden' },
  refugee_release: { floor: 'ground',  zone: 'reception', durationMin: 6, label: 'the reception doors' },
};

/** @param {string} id */
export function jobDest(id) {
  return JOB_DEST[id] || null;
}

/**
 * High-threat forage can fail after you already rode up. Player still spends AP.
 * @param {any} run @param {string} id @param {{chance:(p:number)=>boolean}} rng
 */
export function interruptChance(run, id, rng) {
  if (id !== 'forage') return false;
  const t = run.threat || 0;
  if (t < 45) return false;
  const p = Math.min(0.55, 0.15 + (t - 45) / 100);
  return !!rng.chance?.(p);
}
