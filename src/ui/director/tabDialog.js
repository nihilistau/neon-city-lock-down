// @ts-check
// Dialog tab: whisper tool, give-line, consent controls per character.
import { GATE_LADDER } from '../../chars/gates.js';

/** @param {HTMLElement} el @param {import('../../core/app.js').App} app */
export function tabDialog(el, app) {
  const chars = Object.values(app.cast);
  el.innerHTML = `
    <div class="dir-section">
      <div class="dir-label">WHISPER — private words, no bystanders</div>
      <div class="dir-row">
        <select id="td-char">${chars.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
        <input id="td-whisper" type="text" placeholder="whisper something…" style="flex:1">
        <button id="td-whisper-send">▸</button>
      </div>
    </div>
    <div class="dir-section">
      <div class="dir-label">GIVE LINE — the character says it verbatim (stage tags allowed)</div>
      <div class="dir-row">
        <input id="td-line" type="text" placeholder="[[face:smirk]] Say this…" style="flex:1">
        <button id="td-line-send">▸</button>
      </div>
    </div>
    <div class="dir-section">
      <div class="dir-label">CONSENT / GATES</div>
      <div id="td-gates">${chars.map((c) => `
        <div class="td-gaterow" data-char="${c.id}">
          <span class="td-name" style="color:${c.persona.accent}">${c.name.split(' ')[0]}</span>
          <select class="td-tier">${GATE_LADDER.map((t) => `<option>${t}</option>`).join('')}</select>
          <button data-act="offer">offer</button>
          <button data-act="grant">grant</button>
          <button data-act="revoke">revoke</button>
          <button data-act="withdraw" class="danger">withdraw all</button>
        </div>`).join('')}
      </div>
    </div>`;

  const charSel = /** @type {HTMLSelectElement} */ (el.querySelector('#td-char'));
  const whisper = /** @type {HTMLInputElement} */ (el.querySelector('#td-whisper'));
  const sendWhisper = () => {
    const text = whisper.value.trim();
    if (!text) return;
    whisper.value = '';
    app.dialogue.playerSays(text, charSel.value, { whisper: true });
  };
  el.querySelector('#td-whisper-send').addEventListener('click', sendWhisper);
  whisper.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') sendWhisper(); });

  const line = /** @type {HTMLInputElement} */ (el.querySelector('#td-line'));
  const sendLine = () => {
    const text = line.value.trim();
    if (!text) return;
    line.value = '';
    try { app.dialogue.forceSay(charSel.value, text); }
    catch (err) { console.warn('[give-line]', err.message); }
  };
  el.querySelector('#td-line-send').addEventListener('click', sendLine);
  line.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') sendLine(); });

  el.querySelector('#td-gates').addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target);
    const act = btn.dataset?.act;
    if (!act) return;
    const row = btn.closest('.td-gaterow');
    const charId = row.dataset.char;
    const tier = /** @type {HTMLSelectElement} */ (row.querySelector('.td-tier')).value;
    if (act === 'withdraw') app.cast[charId].gate(tier, 'withdraw', app.clock.totalMinutes);
    else app.cast[charId].gate(tier, /** @type {any} */(act), app.clock.totalMinutes);
  });
}
