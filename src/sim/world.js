// @ts-check
// Run state container — resources, tower systems, threat, event bookkeeping,
// player survival. Pure data + accessors; logic lives in tick/survival/threat.

export function newRunState(seed) {
  return {
    seed,
    resources: {
      food: 24,        // person-meals
      water: 40,       // person-days of clean water (liters-ish)
      meds: 6,
      ammo: 60,
      cells: 12,       // power reserve cells
      parts: 5,
      luxury: 10,      // whiskey/cigs/chocolate — morale currency
    },
    rationPolicy: { food: 'normal', water: 'normal' },   // 'normal'|'half'|'none'
    systems: {
      power: { hp: 100, online: true },
      water: { hp: 100, online: true },
      defence: { hp: 85, online: true },
      elevator: { hp: 100, online: true, locked: false },
      cameras: { hp: 90, online: true },
    },
    player: { health: 100, hunger: 15, thirst: 10, morale: 70 },
    threat: 18,
    eventsFired: [],
    /** @type {{atMinute:number, eventId:string}[]} */
    eventQueue: [],
    activeEventId: null,
    lastEventEndMinute: -Infinity,   // scheduler min-gap anchor (set when an event ends)
    refugees: 0,
    flags: {},
    history: { choices: [], statPeaks: {}, resourcesSpent: {} },
  };
}

/**
 * Spend a resource (clamped at 0). Returns amount actually spent.
 * @param {any} run @param {string} key @param {number} amount
 */
export function spend(run, key, amount) {
  const have = run.resources[key] ?? 0;
  const used = Math.min(have, amount);
  run.resources[key] = +(have - used).toFixed(2);
  run.history.resourcesSpent[key] = (run.history.resourcesSpent[key] || 0) + used;
  return used;
}

/** @param {any} run @param {string} key @param {number} amount */
export function gain(run, key, amount) {
  run.resources[key] = +(Math.max(0, (run.resources[key] ?? 0) + amount)).toFixed(2);
}
