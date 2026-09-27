// @ts-check
// Dialog tab: whisper tool, give-line, and a read-only bond readout per character.
import { bondScore } from '../../chars/bond.js';

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
      <div class="dir-label">BOND — derived from trust + loyalty</div>
      ${chars.map((c) => `
        <div class="dir-row">
          <span class="td-name" style="color:${c.persona.accent}">${c.name.split(' ')[0]}</span>
          <span class="dir-hint">BOND: ${c.bond} (score ${Math.round(bondScore(c.stats))})</span>
        </div>`).join('')}
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
}
