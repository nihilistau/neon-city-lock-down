// @ts-check
// Cast tab: per-character outfit picker, stat nudges, mood readout, focus.
import { STAT_KEYS } from '../../chars/stats.js';

/** @param {HTMLElement} el @param {import('../../core/app.js').App} app */
export function tabCast(el, app) {
  const chars = Object.values(app.cast);
  el.innerHTML = chars.map((c) => `
    <div class="dir-section tc-char" data-char="${c.id}">
      <div class="dir-label" style="color:${c.persona.accent}">${c.name} — <span class="tc-mood">${c.mood?.id || ''}</span></div>
      ${c.wardrobe ? `<div class="dir-row">
        ${c.wardrobe.available().map((o) => `<button data-outfit="${o}" class="${c.wardrobe.current === o ? 'active' : ''}">${o.replace('_', ' ')}</button>`).join('')}
      </div>` : ''}
      <div class="dir-row tc-nudge">
        <button data-nudge="arousal:+10">+arousal</button>
        <button data-nudge="trust:+10">+trust</button>
        <button data-nudge="tension:+10">+tension</button>
        <button data-nudge="sobriety:-15">−sobriety</button>
        <button data-focus="1">focus cam</button>
      </div>
    </div>`).join('');

  el.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target);
    const wrap = btn.closest('.tc-char');
    if (!wrap) return;
    const c = app.cast[wrap.dataset.char];
    if (btn.dataset.outfit) {
      c.wardrobe.change(btn.dataset.outfit);
      wrap.querySelectorAll('[data-outfit]').forEach((b) => b.classList.toggle('active', b === btn));
    }
    if (btn.dataset.nudge) {
      const [stat, delta] = btn.dataset.nudge.split(':');
      c.applyStats({ [stat]: Number(delta) }, 'director');
      wrap.querySelector('.tc-mood').textContent = c.mood?.id || '';
    }
    if (btn.dataset.focus && c.actor.root) {
      const p = c.actor.root.position;
      app.cameraRig.setMode('director');
      app.cameraRig.orbit.target.set(p.x, 1.2, p.z);
      app.cameraRig.camera.position.set(p.x + 1.5, 1.8, p.z + 2.5);
    }
  });
}
