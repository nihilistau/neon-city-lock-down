// @ts-check
// Scene tab: lighting presets, time control, camera focus.
import { PRESETS } from '../../scene3d/lighting.js';
import { cfg } from '../../core/config.js';

/** @param {HTMLElement} el @param {import('../../core/app.js').App} app */
export function tabScene(el, app) {
  // read LIVE presets (config/lighting.yaml), not the static back-compat export —
  // lighting.apply() already resolves them that way, so a config-added preset
  // worked everywhere except the one UI that would let you click it
  const presets = cfg('lighting.presets', PRESETS);
  el.innerHTML = `
    <div class="dir-section">
      <div class="dir-label">LIGHTING</div>
      <div class="dir-row" id="ts-lights">
        ${Object.keys(presets).map((id) =>
          `<button class="${app.lighting.presetId === id ? 'active' : ''}" data-preset="${id}">${id.replace('_', ' ')}</button>`).join('')}
      </div>
    </div>
    <div class="dir-section">
      <div class="dir-label">TIME — <span id="ts-clock">${app.clock.label}</span></div>
      <div class="dir-row">
        <button data-speed="0">pause</button>
        <button data-speed="1" class="${app.clock.speed === 1 ? 'active' : ''}">1×</button>
        <button data-speed="8" class="${app.clock.speed === 8 ? 'active' : ''}">8×</button>
        <button data-skip="60">+1h</button>
        <button data-skip="360">+6h</button>
      </div>
    </div>
    <div class="dir-section">
      <div class="dir-label">CAMERA</div>
      <div class="dir-row">
        <button data-cam="director">director</button>
        <button data-cam="firstPerson">first person</button>
      </div>
    </div>`;

  el.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target);
    if (btn.dataset?.preset) {
      app.lighting.apply(btn.dataset.preset);
      el.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('active', b === btn));
    }
    if (btn.dataset?.speed != null) {
      const s = Number(btn.dataset.speed);
      if (s === 0) app.loop.paused ? app.loop.resume('director') : app.loop.pause('director');
      else { app.loop.resume('director'); app.clock.speed = s; }
      el.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', b === btn));
    }
    if (btn.dataset?.skip) {
      app.clock.skip(Number(btn.dataset.skip), (c) => app.worldTick.minute(c));
      el.querySelector('#ts-clock').textContent = app.clock.label;
    }
    if (btn.dataset?.cam) app.cameraRig.setMode(/** @type {any} */(btn.dataset.cam));
  });
}
