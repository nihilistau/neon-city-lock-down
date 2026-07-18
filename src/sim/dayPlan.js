// @ts-check
// Day planning — the active layer between events. Each day the player gets a
// pool of Action Points; spending them on repairs / fortifying / foraging /
// training / dealing shapes the run (systems economy, threat levers, resources,
// player skill). Pure logic over `run` (+ an rng for foraging); the UI drives it.

export const AP_PER_DAY = 4;

const SYS_LABEL = { power: 'power grid', water: 'water', defence: 'defence grid', elevator: 'elevator', cameras: 'cameras' };

/** the most-damaged online-relevant system (or null if all healthy) */
function weakestSystem(run) {
  let key = null, hp = 96;
  for (const k of Object.keys(run.systems)) {
    if (run.systems[k].hp < hp) { hp = run.systems[k].hp; key = k; }
  }
  return key;
}

/**
 * Action catalogue. Each: { id, label, ap, hint, can(run), apply(run, rng) → msg }.
 * apply() mutates run and returns a short outcome string.
 */
export const DAY_ACTIONS = [
  {
    id: 'repair', label: 'Repair a system', ap: 1, hint: '1 part → +35% to the weakest system',
    can: (run) => run.resources.parts >= 1 && weakestSystem(run) != null,
    apply: (run) => {
      const k = weakestSystem(run);
      if (!k) return 'Everything is already holding.';
      run.resources.parts -= 1;
      const s = run.systems[k];
      s.hp = Math.min(100, s.hp + 35);
      s.online = s.hp > 15;
      return `Repaired the ${SYS_LABEL[k]} to ${Math.round(s.hp)}%.`;
    },
  },
  {
    id: 'fortify', label: 'Fortify the tower', ap: 1, hint: '1 part → +20% defence, lowers threat',
    can: (run) => run.resources.parts >= 1,
    apply: (run) => {
      run.resources.parts -= 1;
      run.systems.defence.hp = Math.min(100, run.systems.defence.hp + 20);
      run.systems.defence.online = true;
      run.threat = Math.max(0, run.threat - 8);
      run.flags.fortified = (run.flags.fortified || 0) + 1;
      return 'Barricades up, turrets serviced — the tower is harder to crack.';
    },
  },
  {
    id: 'forage', label: 'Forage the rooftop garden', ap: 1, hint: 'time → food/water, maybe parts',
    can: () => true,
    apply: (run, rng) => {
      const food = 2 + rng.int(0, 3), water = rng.int(0, 3), parts = rng.chance(0.35) ? 1 : 0;
      run.resources.food += food; run.resources.water += water; run.resources.parts += parts;
      return `Scavenged +${food} food, +${water} water${parts ? ', +1 part' : ''}.`;
    },
  },
  {
    id: 'train', label: 'Drill combat', ap: 1, hint: 'time → sharper aim in firefights',
    can: (run) => (run.player.skill ?? 60) < 92,
    apply: (run) => {
      run.player.skill = Math.min(92, (run.player.skill ?? 60) + 7);
      return `You run the range. Combat skill → ${run.player.skill}.`;
    },
  },
  {
    id: 'rest', label: 'Rest & regroup', ap: 1, hint: 'time → health + morale',
    can: (run) => run.player.health < 100 || run.player.morale < 100,
    apply: (run) => {
      run.player.health = Math.min(100, run.player.health + 16);
      run.player.morale = Math.min(100, run.player.morale + 12);
      return 'A few hours off your feet. You feel steadier.';
    },
  },
  {
    id: 'deal', label: 'Broker a faction deal', ap: 2, hint: '3 luxury → buy the tower a quiet night',
    can: (run) => run.resources.luxury >= 3,
    apply: (run) => {
      run.resources.luxury -= 3;
      run.threat = Math.max(0, run.threat - 20);
      run.flags.dealt = (run.flags.dealt || 0) + 1;
      return 'A crate of whiskey changes hands. The knives stay sheathed — tonight.';
    },
  },
];

/** Reset the AP pool (called on day rollover). */
export function resetDayPlan(run) {
  run.dayPlan = { ap: AP_PER_DAY, apMax: AP_PER_DAY };
}

/** Can the player perform action `id` right now? */
export function canAct(run, id) {
  const a = DAY_ACTIONS.find((x) => x.id === id);
  if (!a) return false;
  const ap = run.dayPlan?.ap ?? 0;
  return ap >= a.ap && a.can(run);
}

/**
 * Perform an action. Returns { ok, msg }.
 * @param {any} run @param {string} id @param {import('../core/rng.js').RngStream} rng
 */
export function performAction(run, id, rng) {
  const a = DAY_ACTIONS.find((x) => x.id === id);
  if (!a) return { ok: false, msg: 'unknown action' };
  if ((run.dayPlan?.ap ?? 0) < a.ap) return { ok: false, msg: 'Out of action points for today.' };
  if (!a.can(run)) return { ok: false, msg: 'Can\'t do that right now.' };
  const msg = a.apply(run, rng);
  run.dayPlan.ap -= a.ap;
  return { ok: true, msg, ap: run.dayPlan.ap };
}
