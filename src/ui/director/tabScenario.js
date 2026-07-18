// @ts-check
// Scenario tab: preview + launch scenarios (mood shifts, opening cutscene).
import { SCENARIOS } from '../../../data/scenarios.js';

/** @param {HTMLElement} el @param {import('../../core/app.js').App} app */
export function tabScenario(el, app) {
  const list = Object.values(SCENARIOS);
  el.innerHTML = `
    <div class="dir-section">
      <div class="dir-label">SCENARIOS — ${list.length} available (more unlock as you play)</div>
      ${list.map((s) => `
        <div class="ts-scen" data-scen="${s.id}">
          <div class="ts-title">${s.title}</div>
          <div class="ts-blurb">${s.blurb}</div>
          <div class="dir-row">
            ${s.openingCutscene ? `<button data-play="cut">▶ cutscene</button>` : ''}
            <button data-play="launch">apply mood shifts</button>
          </div>
        </div>`).join('')}
    </div>`;

  el.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target);
    const wrap = btn.closest('.ts-scen');
    if (!wrap || !btn.dataset.play) return;
    const s = SCENARIOS[wrap.dataset.scen];
    if (btn.dataset.play === 'cut' && s.openingCutscene) {
      app.directorPanel.toggle();
      app.cutscene.play(s.openingCutscene);
      return;
    }
    launchScenario(app, s);
  });
}

/** Stage a scenario: moods, lighting, placements, then event/game/cutscene. */
export function launchScenario(app, s) {
  app.scenarioId = s.id;
  for (const [id, deltas] of Object.entries(s.castMoodShifts || {})) {
    app.cast[id]?.applyStats(deltas, 'scenario');
  }
  if (s.lighting) app.lighting.apply(s.lighting, 2);
  for (const [id, [zone, wp]] of Object.entries(s.placements || {})) {
    const c = app.cast[id];
    if (c && c.id !== 'vox') { c.queue.clear(); c.queue.goto(zone, wp); }
    app.brains?.[id]?.engage(app.clock.totalMinutes + 20);
  }
  app.directorPanel.toggle();
  if (s.fireEvent) app.eventRunner.fire(s.fireEvent);
  if (s.game === 'tod') app.gamesPanel.tod();
  else if (s.game?.startsWith('bed:')) app.gamesPanel.bed(s.game.slice(4));
  else if (s.game?.startsWith('mystery:')) app.gamesPanel.mystery(s.game.slice(8));
  else if (s.openingCutscene) app.cutscene.play(s.openingCutscene);
}
