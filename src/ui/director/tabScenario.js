// @ts-check
// Scenario tab: preview + launch scenarios (mood shifts, opening cutscene).
import { SCENARIOS } from '../../../data/scenarios.js';
import { applyScenario } from '../../sim/scenario.js';

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
    app.directorPanel.close();
    if (btn.dataset.play === 'cut' && s.openingCutscene) {
      app.cutscene.play(s.openingCutscene).catch((err) => console.error('[scenario] cutscene', err));
      return;
    }
    launchScenario(app, s);
  });
}

/**
 * Stage a scenario. Thin wrapper over the shared applier — deliberately does NOT
 * touch the Director drawer, because the Creation Kit's Play/Test calls this too
 * and `toggle()` used to *open* the drawer from there.
 */
export function launchScenario(app, s) {
  applyScenario(app, s).catch((err) => console.error('[scenario] launch failed', s?.id, err));
}
