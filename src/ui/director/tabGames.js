// @ts-check
// Games tab: launch Kai's card game / mystery cases.
import { MYSTERY_CASES } from '../../../data/games/mysteryCases.js';

/** @param {HTMLElement} el @param {import('../../core/app.js').App} app */
export function tabGames(el, app) {
  el.innerHTML = `
    <div class="dir-section">
      <div class="dir-label">KAI'S CARD GAME — five tricks of high / low</div>
      <div class="dir-row"><button id="tg-cards">Deal</button></div>
    </div>
    <div class="dir-section">
      <div class="dir-label">MYSTERY CASES</div>
      <div class="dir-row" id="tg-mys">
        ${Object.values(MYSTERY_CASES).map((m) => `<button data-mys="${m.id}">${m.title}</button>`).join('')}
      </div>
    </div>`;

  el.querySelector('#tg-cards').addEventListener('click', () => {
    app.directorPanel.toggle(); app.gamesPanel.cards();
  });
  el.querySelector('#tg-mys').addEventListener('click', (e) => {
    const id = /** @type {HTMLElement} */ (e.target).dataset?.mys;
    if (id) { app.directorPanel.toggle(); app.gamesPanel.mystery(id); }
  });
}
