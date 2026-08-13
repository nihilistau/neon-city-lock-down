// @ts-check
// The one place a scenario is staged. Three entry points share it: the main-menu
// new-run path (App.startRun), the Director's Scenario tab, and the Creation
// Kit's Play/Test. Previously startRun had its own partial copy that applied
// lighting/moods/placements but silently dropped `fireEvent` and `game` — so 7
// of the 16 shipped scenarios did nothing when picked from the main menu.

/**
 * @param {import('../core/app.js').App} app
 * @param {any} s a scenario from data/scenarios.js (or user/scenarios/*.json)
 * @param {{lightingFade?: number, cutsceneDelayMs?: number}} [opts]
 */
export async function applyScenario(app, s, opts = {}) {
  if (!s) return;
  const { lightingFade = 2, cutsceneDelayMs = 0 } = opts;
  app.scenarioId = s.id;

  for (const [id, deltas] of Object.entries(s.castMoodShifts || {})) {
    app.cast[id]?.applyStats(deltas, 'scenario');
  }
  if (s.lighting) app.lighting.apply(s.lighting, lightingFade);
  for (const [id, [zone, wp]] of Object.entries(s.placements || {})) {
    const c = app.cast[id];
    if (c && c.id !== 'vox') { c.queue.clear(); c.queue.goto(zone, wp); }
    // hold the brain off the placement long enough for it to read as staging
    app.brains?.[id]?.engage(app.clock.totalMinutes + 20);
  }

  // Opening cutscene first, then the interactive payload — so a scenario can
  // both set its scene and start its event/game.
  if (s.openingCutscene) {
    if (cutsceneDelayMs) await new Promise((r) => setTimeout(r, cutsceneDelayMs));
    try { await app.cutscene.play(s.openingCutscene); }
    catch (err) { console.error('[scenario] cutscene failed', s.id, err); }
  }

  try {
    if (s.fireEvent) await app.eventRunner.fire(s.fireEvent);
    if (s.game === 'tod') app.gamesPanel.tod();
    else if (s.game?.startsWith('bed:')) app.gamesPanel.bed(s.game.slice(4));
    else if (s.game?.startsWith('mystery:')) app.gamesPanel.mystery(s.game.slice(8));
  } catch (err) {
    console.error('[scenario] payload failed', s.id, err);
  }
}
