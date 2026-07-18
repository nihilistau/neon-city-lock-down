// @ts-check
// Actions tab: dice rolls, conversational gambits (opposed rolls, dice shown),
// and quick activity suggestions.
import { GAMBITS } from '../../games/gambits.js';
import { on } from '../../core/bus.js';

/** @param {HTMLElement} el @param {import('../../core/app.js').App} app */
export function tabActions(el, app) {
  const targets = Object.values(app.cast).filter((c) => c.id !== 'vox');
  el.innerHTML = `
    <div class="dir-section">
      <div class="dir-label">GAMBIT — a mind-game move (opposed roll)</div>
      <div class="dir-row">
        <select id="ta-target">${targets.map((c) => `<option value="${c.id}">${c.name.split(' ')[0]}</option>`).join('')}</select>
      </div>
      <div class="dir-row" id="ta-gambits">
        ${Object.values(GAMBITS).map((g) => `<button data-gambit="${g.id}" title="${g.desc}">${g.label}</button>`).join('')}
      </div>
      <div id="ta-dice" class="ta-dice"></div>
    </div>
    <div class="dir-section">
      <div class="dir-label">DICE</div>
      <div class="dir-row">
        <button data-roll="1d20">d20</button>
        <button data-roll="2d6">2d6</button>
        <button data-roll="1d100">d100</button>
      </div>
    </div>
    <div class="dir-section">
      <div class="dir-label">ACTIVITY SUGGESTIONS</div>
      <div class="dir-row" id="ta-acts">
        <button data-act="drink">pour drinks</button>
        <button data-act="dance">put on music</button>
        <button data-act="gather">gather everyone</button>
      </div>
    </div>`;

  const targetSel = /** @type {HTMLSelectElement} */ (el.querySelector('#ta-target'));
  const dice = el.querySelector('#ta-dice');

  el.querySelector('#ta-gambits').addEventListener('click', (e) => {
    const id = /** @type {HTMLElement} */ (e.target).dataset?.gambit;
    if (!id) return;
    const r = app.gambits.play(id, app.cast[targetSel.value]);
    if (r) dice.innerHTML = `<span class="${r.win ? 'win' : 'fail'}">⚄ ${r.dice.pTotal} vs ${r.dice.tTotal} — ${r.win ? 'WIN' : 'FAIL'}</span><br><span class="ta-line">${r.line}</span>`;
  });

  el.querySelector('[data-roll]').parentElement.addEventListener('click', (e) => {
    const n = /** @type {HTMLElement} */ (e.target).dataset?.roll;
    if (!n) return;
    const r = app.rng.stream('director_dice').roll(n);
    dice.innerHTML = `<span>🎲 ${n} → <b>${r.total}</b> [${r.rolls.join(', ')}]</span>`;
  });

  el.querySelector('#ta-acts').addEventListener('click', (e) => {
    const act = /** @type {HTMLElement} */ (e.target).dataset?.act;
    if (act) app.directorAction?.(act);
  });
}
