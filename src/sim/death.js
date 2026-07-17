// @ts-check
// Perma-death: compile the run summary, record meta, delete the autosave.
import { recordRun } from './meta.js';
import { deleteAutosave } from '../core/save.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';

/**
 * @param {import('../core/app.js').App} app
 * @param {string} endedBy 'combat'|'starvation'|'dehydration'|'unknown'
 */
export function endRun(app, endedBy) {
  const run = app.run;
  const bonds = {};
  for (const c of Object.values(app.cast)) {
    bonds[c.id] = Math.round(c.stats.trust);
  }
  const summary = {
    days: app.clock.day,
    minutes: app.clock.totalMinutes,
    kills: run.history.kills || 0,
    endedBy,
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
