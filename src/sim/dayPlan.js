// @ts-check
// Day planning — the active layer between events. Each day the player gets a
// pool of Action Points; spending them on repairs / fortifying / foraging /
// training / dealing shapes the run (systems economy, threat levers, resources,
// player skill). Pure logic over `run` (+ an rng for foraging); the UI drives it.
// Tuning: config/sim.yaml (dayPlan).
import { cfg } from '../core/config.js';

export const AP_PER_DAY = 4;   // default; live value = cfg('sim.dayPlan.apPerDay')
const apOf = (a) => cfg(`sim.dayPlan.${a.id}.ap`, a.ap);

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
    can: (run) => run.resources.parts >= cfg('sim.dayPlan.repair.cost', 1) && weakestSystem(run) != null,
    apply: (run) => {
      const k = weakestSystem(run);
      if (!k) return 'Everything is already holding.';
      run.resources.parts -= cfg('sim.dayPlan.repair.cost', 1);
      const s = run.systems[k];
      s.hp = Math.min(100, s.hp + cfg('sim.dayPlan.repair.amount', 35));
      s.online = s.hp > 15;
      return `Repaired the ${SYS_LABEL[k]} to ${Math.round(s.hp)}%.`;
    },
  },
  {
    id: 'fortify', label: 'Fortify the tower', ap: 1, hint: '1 part → +20% defence, lowers threat',
    can: (run) => run.resources.parts >= cfg('sim.dayPlan.fortify.cost', 1),
    apply: (run) => {
      run.resources.parts -= cfg('sim.dayPlan.fortify.cost', 1);
      run.systems.defence.hp = Math.min(100, run.systems.defence.hp + cfg('sim.dayPlan.fortify.defence', 20));
      run.systems.defence.online = true;
      run.threat = Math.max(0, run.threat - cfg('sim.dayPlan.fortify.threatDrop', 8));
      run.flags.fortified = (run.flags.fortified || 0) + 1;
      return 'Barricades up, turrets serviced — the tower is harder to crack.';
    },
  },
  {
    // Accepting a refugee used to be an unrecoverable spiral with no exit: a
    // fifth mouth pushed daily food demand past what four AP of foraging can
    // produce, and there was no way to remove them, put them to work, or even
    // acknowledge the problem. A choice you cannot respond to is not a choice.
    //
    // Put them to work and they earn their keep — a refugee who forages beside
    // you turns the decision into a BET (a mouth today, hands tomorrow) instead
    // of a punishment for compassion.
    id: 'refugee_work', label: 'Put the refugees to work', ap: 1,
    hint: 'they forage with you — food scaled by how many took you in',
    can: (run) => (run.refugees || 0) > 0 && !run.dayPlan?.done?.includes('refugee_work'),
    apply: (run, rng) => {
      const n = run.refugees || 0;
      const per = cfg('sim.dayPlan.refugeeWork.foodPer', 3);
      const food = n * (per + rng.int(0, 2));
      const water = n * rng.int(0, 2);
      run.resources.food += food; run.resources.water += water;
      return `They know where the city hides things. +${food} food, +${water} water.`;
    },
  },
  {
    // The other half of the answer. Asking someone to leave a besieged tower is
    // supposed to cost you something with the people watching you do it.
    id: 'refugee_release', label: 'Send the refugees back out', ap: 0,
    hint: 'one fewer mouth — and the cast will remember',
    can: (run) => (run.refugees || 0) > 0,
    apply: (run) => {
      run.refugees = Math.max(0, (run.refugees || 0) - 1);
      run.flags.sentRefugeeOut = true;
      run.player.morale = Math.max(0, run.player.morale - cfg('sim.dayPlan.refugeeRelease.morale', 10));
      return 'The doors opened, briefly, outward. Nobody spoke at dinner.';
    },
  },
  {
    id: 'forage', label: 'Forage the rooftop garden', ap: 1, hint: 'time → food/water, maybe parts',
    can: () => true,
    apply: (run, rng) => {
      // Letting the garden blight (data/events.js garden_blight, "Let it ride")
      // set a flag that nothing read, while its own alert told the player "the
      // rooftop will give less". It does now.
      const blight = run.flags.gardenBlight ? cfg('sim.dayPlan.forage.blightMul', 0.4) : 1;
      const food = Math.round((cfg('sim.dayPlan.forage.foodBase', 2) + rng.int(0, cfg('sim.dayPlan.forage.foodRand', 3))) * blight);
      const water = Math.round(rng.int(0, cfg('sim.dayPlan.forage.waterRand', 3)) * blight);
      const parts = rng.chance(cfg('sim.dayPlan.forage.partsChance', 0.35) * blight) ? 1 : 0;
      run.resources.food += food; run.resources.water += water; run.resources.parts += parts;
      return `Scavenged +${food} food, +${water} water${parts ? ', +1 part' : ''}.`
        + (blight < 1 ? ' The blighted beds gave up little.' : '');
    },
  },
  {
    id: 'train', label: 'Drill combat', ap: 1, hint: 'time → sharper aim in firefights',
    can: (run) => (run.player.skill ?? 60) < cfg('sim.dayPlan.train.cap', 92),
    apply: (run) => {
      const cap = cfg('sim.dayPlan.train.cap', 92);
      run.player.skill = Math.min(cap, (run.player.skill ?? 60) + cfg('sim.dayPlan.train.gain', 7));
      return `You run the range. Combat skill → ${run.player.skill}.`;
    },
  },
  {
    id: 'rest', label: 'Rest & regroup', ap: 1, hint: 'time → health + morale',
    can: (run) => run.player.health < 100 || run.player.morale < 100,
    apply: (run) => {
      run.player.health = Math.min(100, run.player.health + cfg('sim.dayPlan.rest.health', 16));
      run.player.morale = Math.min(100, run.player.morale + cfg('sim.dayPlan.rest.morale', 12));
      return 'A few hours off your feet. You feel steadier.';
    },
  },
  {
    id: 'deal', label: 'Broker a faction deal', ap: 2, hint: '3 luxury → buy the tower a quiet night',
    can: (run) => run.resources.luxury >= cfg('sim.dayPlan.deal.cost', 3),
    apply: (run) => {
      run.resources.luxury -= cfg('sim.dayPlan.deal.cost', 3);
      run.threat = Math.max(0, run.threat - cfg('sim.dayPlan.deal.threatDrop', 20));
      run.flags.dealt = (run.flags.dealt || 0) + 1;
      return 'A crate of whiskey changes hands. The knives stay sheathed — tonight.';
    },
  },
];

/** Reset the AP pool (called on day rollover). */
export function resetDayPlan(run) {
  const ap = cfg('sim.dayPlan.apPerDay', AP_PER_DAY);
  run.dayPlan = { ap, apMax: ap };
}

/** Can the player perform action `id` right now? */
export function canAct(run, id) {
  const a = DAY_ACTIONS.find((x) => x.id === id);
  if (!a) return false;
  const ap = run.dayPlan?.ap ?? 0;
  return ap >= apOf(a) && a.can(run);
}

/**
 * Perform an action. Returns { ok, msg }.
 * @param {any} run @param {string} id @param {import('../core/rng.js').RngStream} rng
 */
export function performAction(run, id, rng) {
  const a = DAY_ACTIONS.find((x) => x.id === id);
  if (!a) return { ok: false, msg: 'unknown action' };
  const ap = apOf(a);
  if ((run.dayPlan?.ap ?? 0) < ap) return { ok: false, msg: 'Out of action points for today.' };
  if (!a.can(run)) return { ok: false, msg: 'Can\'t do that right now.' };
  const msg = a.apply(run, rng);
  run.dayPlan.ap -= ap;
  return { ok: true, msg, ap: run.dayPlan.ap };
}

/** Spend AP without applying the action (job interrupted on-site). */
export function spendAp(run, id) {
  const a = DAY_ACTIONS.find((x) => x.id === id);
  if (!a) return false;
  const ap = apOf(a);
  if ((run.dayPlan?.ap ?? 0) < ap) return false;
  run.dayPlan.ap -= ap;
  return true;
}
