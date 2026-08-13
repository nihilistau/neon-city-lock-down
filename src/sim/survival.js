// @ts-check
// Hourly consumption + hunger/thirst/morale cascades. Pure over (run, cast).
// Tuning: config/sim.yaml (survival).
import { spend } from './world.js';
import { cfg } from '../core/config.js';

/**
 * Called once per game-hour.
 * @param {any} run
 * @param {import('../chars/character.js').Character[]} cast living NPCs
 * @returns {{notes: string[]}} feed-worthy happenings
 */
export function hourlyTick(run, cast) {
  const notes = [];
  const s = cfg('sim.survival', {});
  // Only corporeal characters eat and drink. VOX is the tower itself and used to
  // be counted as a fifth mouth, over-consuming food and water by ~25% all run.
  const eaters = cast.filter((c) => c.persona?.corporeal !== false);
  const heads = eaters.length + 1 + run.refugees; // corporeal NPCs + player + refugees
  const p = run.player;

  // eat/drink on 6-hour cadence equivalents: spread as fractional hourly draw
  const foodRate = run.rationPolicy.food === 'none' ? 0 : run.rationPolicy.food === 'half' ? 0.5 : 1;
  const waterRate = run.rationPolicy.water === 'none' ? 0 : run.rationPolicy.water === 'half' ? 0.5 : 1;

  const foodNeeded = (heads * (s.mealsPerDay ?? 3) / 24) * foodRate;
  const waterNeeded = (heads * (s.waterPerDay ?? 1) / 24) * waterRate;
  const gotFood = spend(run, 'food', foodNeeded);
  const gotWater = run.systems.water.online ? spend(run, 'water', waterNeeded) : 0;

  const foodShort = foodNeeded > 0 ? 1 - gotFood / foodNeeded : 1 - foodRate;
  const waterShort = waterNeeded > 0 ? 1 - gotWater / waterNeeded : 1 - waterRate;

  // player biology
  p.hunger = clamp(p.hunger + (s.hungerRate ?? 1.4) * (0.4 + foodShort) - (1 - foodShort) * (s.hungerRelief ?? 1.6));
  p.thirst = clamp(p.thirst + (s.thirstRate ?? 2.0) * (0.4 + waterShort) - (1 - waterShort) * (s.thirstRelief ?? 2.4));
  if (p.hunger > (s.hungerHealthAt ?? 80)) { p.health = clamp(p.health - (s.hungerHealthLoss ?? 1)); notes.push('Hunger is eating at you.'); }
  if (p.thirst > (s.thirstHealthAt ?? 75)) { p.health = clamp(p.health - (s.thirstHealthLoss ?? 2)); notes.push('Dehydration is setting in.'); }
  p.morale = clamp(p.morale - foodShort * (s.moraleFoodDrain ?? 1.2) - waterShort * (s.moraleWaterDrain ?? 1.5) + (s.moraleRecover ?? 0.25));

  // cast morale/tension cascade when rations run short
  for (const c of cast) {
    // rations only bite characters that eat; everyone still decays hourly
    if (c.persona?.corporeal !== false) {
      const deltas = {};
      if (foodShort > (s.castFoodShortAt ?? 0.3)) { deltas.happiness = -1.5 * foodShort; deltas.tension = 2 * foodShort; }
      if (waterShort > (s.castWaterShortAt ?? 0.3)) { deltas.tension = (deltas.tension || 0) + 2.5 * waterShort; }
      if (run.rationPolicy.food === 'half') deltas.tension = (deltas.tension || 0) + 0.4;
      if (Object.keys(deltas).length) c.applyStats(deltas, 'rations');
    }
    c.tickMinutes(60);
  }

  if (run.resources.food <= (s.warnFoodAt ?? 6) && !run.flags.warnedFood) {
    run.flags.warnedFood = true;
    notes.push('Food reserves are running low.');
  }
  if (run.resources.water <= (s.warnWaterAt ?? 8) && !run.flags.warnedWater) {
    run.flags.warnedWater = true;
    notes.push('Water reserves are running low.');
  }
  return { notes };
}

function clamp(v) { return Math.max(0, Math.min(100, v)); }
