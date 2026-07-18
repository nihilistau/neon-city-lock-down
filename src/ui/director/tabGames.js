// @ts-check
// Games tab: launch bed game / truth-or-dare / mystery cases.
import { MYSTERY_CASES } from '../../../data/games/mysteryCases.js';

/** @param {HTMLElement} el @param {import('../../core/app.js').App} app */
export function tabGames(el, app) {
  const partners = Object.values(app.cast).filter((c) => c.id !== 'vox');
  el.innerHTML = `
    <div class="dir-section">
      <div class="dir-label">BED GAME — 38 actions, 5 escalation tiers, consent-gated</div>
      <div class="dir-row" id="tg-bed">
        ${partners.map((c) => `<button data-bed="${c.id}">${c.name.split(' ')[0]}</button>`).join('')}
      </div>
    </div>
    <div class="dir-section">
      <div class="dir-label">TRUTH OR DARE — the whole room</div>
      <div class="dir-row"><button id="tg-tod">Start a round</button></div>
    </div>
    <div class="dir-section">
      <div class="dir-label">MYSTERY CASES</div>
      <div class="dir-row" id="tg-mys">
        ${Object.values(MYSTERY_CASES).map((m) => `<button data-mys="${m.id}">${m.title}</button>`).join('')}
      </div>
    </div>`;

  el.querySelector('#tg-bed').addEventListener('click', (e) => {
    const id = /** @type {HTMLElement} */ (e.target).dataset?.bed;
    if (id) { app.directorPanel.toggle(); app.gamesPanel.bed(id); }
  });
  el.querySelector('#tg-tod').addEventListener('click', () => {
    app.directorPanel.toggle(); app.gamesPanel.tod();
  });
  el.querySelector('#tg-mys').addEventListener('click', (e) => {
    const id = /** @type {HTMLElement} */ (e.target).dataset?.mys;
    if (id) { app.directorPanel.toggle(); app.gamesPanel.mystery(id); }
  });
}
