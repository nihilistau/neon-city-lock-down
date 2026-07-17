// @ts-check
// Hourly consumption + hunger/thirst/morale cascades. Pure over (run, cast).
import { spend } from './world.js';

/**
 * Called once per game-hour.
 * @param {any} run
 * @param {import('../chars/character.js').Character[]} cast living NPCs
 * @returns {{notes: string[]}} feed-worthy happenings
 */
export function hourlyTick(run, cast) {
  const notes = [];
  const heads = cast.length + 1 + run.refugees; // NPCs + player + refugees
  const p = run.player;

  // eat/drink on 6-hour cadence equivalents: spread as fractional hourly draw
  const foodRate = run.rationPolicy.food === 'none' ? 0 : run.rationPolicy.food === 'half' ? 0.5 : 1;
  const waterRate = run.rationPolicy.water === 'none' ? 0 : run.rationPolicy.water === 'half' ? 0.5 : 1;

  const foodNeeded = (heads * 3 / 24) * foodRate;   // 3 meals/day/head
  const waterNeeded = (heads * 1 / 24) * waterRate; // 1 unit/day/head
  const gotFood = spend(run, 'food', foodNeeded);
  const gotWater = run.systems.water.online ? spend(run, 'water', waterNeeded) : 0;

  const foodShort = foodNeeded > 0 ? 1 - gotFood / foodNeeded : 1 - foodRate;
  const waterShort = waterNeeded > 0 ? 1 - gotWater / waterNeeded : 1 - waterRate;

  // player biology
  p.hunger = clamp(p.hunger + 1.4 * (0.4 + foodShort) - (1 - foodShort) * 1.6);
  p.thirst = clamp(p.thirst + 2.0 * (0.4 + waterShort) - (1 - waterShort) * 2.4);
  if (p.hunger > 80) { p.health = clamp(p.health - 1); notes.push('Hunger is eating at you.'); }
  if (p.thirst > 75) { p.health = clamp(p.health - 2); notes.push('Dehydration is setting in.'); }
  p.morale = clamp(p.morale - foodShort * 1.2 - waterShort * 1.5 + 0.25);

  // cast morale/tension cascade when rations run short
  for (const c of cast) {
    const deltas = {};
    if (foodShort > 0.3) { deltas.happiness = -1.5 * foodShort; deltas.tension = 2 * foodShort; }
    if (waterShort > 0.3) { deltas.tension = (deltas.tension || 0) + 2.5 * waterShort; }
    if (run.rationPolicy.food === 'half') deltas.tension = (deltas.tension || 0) + 0.4;
    if (Object.keys(deltas).length) c.applyStats(deltas, 'rations');
    c.tickMinutes(60);
  }

  if (run.resources.food <= 6 && !run.flags.warnedFood) {
    run.flags.warnedFood = true;
    notes.push('Food reserves are running low.');
  }
  if (run.resources.water <= 8 && !run.flags.warnedWater) {
    run.flags.warnedWater = true;
    notes.push('Water reserves are running low.');
  }
  return { notes };
}

function clamp(v) { return Math.max(0, Math.min(100, v)); }
