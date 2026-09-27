// @ts-check
// Perma-death: compile the run summary, record meta, delete the autosave.
import { recordRun, unlock } from './meta.js';
import { deleteAutosave } from '../core/save.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';
import { bondTier } from '../chars/bond.js';

/**
 * @param {import('../core/app.js').App} app
 * @param {string} endedBy 'combat'|'starvation'|'dehydration'|'extracted'|'stayed'|'unknown'
 */
export function endRun(app, endedBy) {
  const run = app.run;
  // `bonds` stays raw trust: meta run history and the vox_confided unlock read
  // it. `bondTiers` is what the run summary shows — the character's live tier
  // (src/chars/bond.js, hysteresis included), not a second set of thresholds.
  const bonds = {};
  /** @type {Record<string, string>} */
  const bondTiers = {};
  /** cast who didn't make it — NPCs can die now (Character.die), so record them */
  const lost = [];
  for (const c of Object.values(app.cast)) {
    bonds[c.id] = Math.round(c.stats.trust);
    bondTiers[c.id] = c.bond || bondTier(c.stats);
    if (!c.alive) lost.push(c.id);
  }
  const summary = {
    lost,
    days: app.clock.day,
    minutes: app.clock.totalMinutes,
    kills: run.history.kills || 0,
    endedBy,
    extractedWith: Array.isArray(run.flags.extractedWith) ? run.flags.extractedWith : [],
    stayed: !!run.flags.stayed,
    bonds,
    bondTiers,
    eventsSurvived: run.eventsFired.length,
    choices: run.history.choices.length,
    resourcesSpent: run.history.resourcesSpent,
    playerName: app.player?.name,
  };
  recordRun(summary);

  // Meta unlocks, earned from what the run actually was. Each one opens a
  // scenario on the new-run screen (data/scenarios.js `requiresUnlock`), which
  // is the only thing standing between "perma-death" and "start over identically".
  const earned = [];
  if (summary.days >= 5 && unlock('long_haul')) earned.push('Last Night Before the Gates Open');
  if ((summary.kills || 0) >= 10 && unlock('blooded')) earned.push('Armoury Inventory Night');
  if ((summary.bonds?.vox ?? 0) >= 60 && unlock('vox_confided')) earned.push('Mystery: The Grid Ghost');
  if (earned.length) {
    feed(`Unlocked: ${earned.join(' · ')}. Start a new run to play ${earned.length > 1 ? 'them' : 'it'}.`, 'system');
  }
  summary.unlocked = earned;

  deleteAutosave();
  feed('The run is over. The tower forgets no one.', 'system');
  emit('run.death', summary);
  return summary;
}
