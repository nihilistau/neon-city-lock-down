// @ts-check
// Cast tab: full 9-stat readout per character, live-editable via sliders,
// outfit picker, mood readout, camera focus, and presence (send away / bring
// back). Refreshes on char.stat / char.mood while open.
import { STAT_KEYS } from '../../chars/stats.js';
import { on } from '../../core/bus.js';

const STAT_COLOR = {
  happiness: '#ffd23f',
  openness: '#3dff9a', dominance: '#9d6bff', trust: '#39e6ff', tension: '#ff7043',
  energy: '#7fff5a', sobriety: '#8ec7ff', loyalty: '#c39bff', fear: '#ff4757',
};

/** @param {HTMLElement} el @param {import('../../core/app.js').App} app */
export function tabCast(el, app) {
  const render = () => {
    const chars = Object.values(app.cast);
    el.innerHTML = chars.map((c) => {
      const away = c.present === false;
      const stats = STAT_KEYS.map((k) => `
        <div class="tc-stat" data-char="${c.id}" data-stat="${k}">
          <span class="tc-sk">${k.slice(0, 4)}</span>
          <input type="range" min="0" max="100" step="1" value="${Math.round(c.stats[k])}"
                 data-char="${c.id}" data-stat="${k}" style="accent-color:${STAT_COLOR[k]}">
          <span class="tc-sv">${Math.round(c.stats[k])}</span>
        </div>`).join('');
      return `
        <div class="dir-section tc-char ${away ? 'away' : ''}" data-char="${c.id}">
          <div class="dir-label" style="color:${c.persona.accent}">
            ${c.name} — <span class="tc-mood">${c.mood?.id || ''}</span>
            ${c.id !== 'vox' ? `<button class="tc-presence" data-char="${c.id}">${away ? 'bring back' : 'send away'}</button>` : ''}
          </div>
          ${away ? '<div class="tc-awaymsg">— away from the tower —</div>' : `
            ${c.wardrobe ? `<div class="dir-row">
              ${c.wardrobe.available().map((o) => `<button data-outfit="${o}" data-char="${c.id}" class="${c.wardrobe.current === o ? 'active' : ''}">${o.replace('_', ' ')}</button>`).join('')}
            </div>` : ''}
            <div class="tc-stats">${stats}</div>
            <div class="dir-row"><button data-focus="1" data-char="${c.id}">focus camera</button></div>
          `}
        </div>`;
    }).join('');
  };
  render();

  // live-update values while the panel is open (throttled by the DOM being cheap)
  const offStat = on('char.stat', ({ id, stats }) => {
    for (const k of STAT_KEYS) {
      const row = el.querySelector(`.tc-stat[data-char="${id}"][data-stat="${k}"]`);
      if (!row) continue;
      const v = Math.round(stats[k]);
      const slider = row.querySelector('input');
      if (document.activeElement !== slider) slider.value = String(v);
      row.querySelector('.tc-sv').textContent = String(v);
    }
  });
  const offMood = on('char.mood', ({ id, mood }) => {
    const m = el.querySelector(`.tc-char[data-char="${id}"] .tc-mood`);
    if (m) m.textContent = mood;
  });
  // detach listeners when the tab is torn down (body innerHTML cleared on tab switch)
  const observer = new MutationObserver(() => {
    if (!document.body.contains(el.querySelector('.tc-char'))) { offStat(); offMood(); observer.disconnect(); }
  });
  observer.observe(el.parentElement || el, { childList: true });

  el.addEventListener('input', (e) => {
    const inp = /** @type {HTMLInputElement} */ (e.target);
    if (inp.tagName !== 'INPUT' || !inp.dataset.stat) return;
    const c = app.cast[inp.dataset.char];
    const delta = Number(inp.value) - c.stats[inp.dataset.stat];
    if (delta) c.applyStats({ [inp.dataset.stat]: delta }, 'director');
    inp.parentElement.querySelector('.tc-sv').textContent = String(Math.round(c.stats[inp.dataset.stat]));
  });

  el.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target);
    const id = btn.dataset?.char;
    if (!id) return;
    const c = app.cast[id];
    if (btn.dataset.outfit) {
      c.wardrobe.change(btn.dataset.outfit);
      btn.parentElement.querySelectorAll('[data-outfit]').forEach((b) => b.classList.toggle('active', b === btn));
    }
    if (btn.dataset.focus && c.actor.root && c.present !== false) {
      const p = c.actor.root.position;
      app.cameraRig.setMode('director');
      app.cameraRig.orbit.target.set(p.x, 1.2, p.z);
      app.cameraRig.camera.position.set(p.x + 1.5, 1.8, p.z + 2.5);
    }
    if (btn.classList.contains('tc-presence')) {
      if (c.present === false) app.respawnCharacter(id); else app.despawnCharacter(id);
      render();
    }
  });
}
