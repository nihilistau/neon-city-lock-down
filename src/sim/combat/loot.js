// @ts-check
// Loot table for downed hostiles. Pure so combat and tests share it.

const LOOT_ITEMS = ['stim', 'shiv', 'ration'];

/**
 * @param {{int:(a:number,b:number)=>number, chance:(p:number)=>boolean, pick:(a:any[])=>any}} rng
 * @returns {{ammo:number, item:string|null}}
 */
export function rollLoot(rng) {
  const ammo = rng.int(3, 8);
  const item = rng.chance(0.3) ? rng.pick(LOOT_ITEMS) : null;
  return { ammo, item };
}
