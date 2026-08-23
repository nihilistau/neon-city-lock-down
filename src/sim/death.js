// @ts-check
// Perma-death: compile the run summary, record meta, delete the autosave.
import { recordRun } from './meta.js';
import { deleteAutosave } from '../core/save.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';

/**
 * @param {import('../core/app.js').App} app
 * @param {string} endedBy 'combat'|'starvation'|'dehydration'|'extracted'|'stayed'|'unknown'
 */
export function endRun(app, endedBy) {
  const run = app.run;
  const bonds = {};
  /** cast who didn't make it — NPCs can die now (Character.die), so record them */
  const lost = [];
  for (const c of Object.values(app.cast)) {
    bonds[c.id] = Math.round(c.stats.trust);
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
    eventsSurvived: run.eventsFired.length,
    choices: run.history.choices.length,
    resourcesSpent: run.history.resourcesSpent,
    playerName: app.player?.name,
  };
  recordRun(summary);
  deleteAutosave();
  feed('The run is over. The tower forgets no one.', 'system');
  emit('run.death', summary);
  return summary;
}
