// @ts-check
// World tab: world-tick controls, event forcing, floor jump, resource editing.
import { EVENTS } from '../../../data/events.js';
import { FLOORS } from '../../../data/zones.js';

/** @param {HTMLElement} el @param {import('../../core/app.js').App} app */
export function tabWorld(el, app) {
  el.innerHTML = `
    <div class="dir-section">
      <div class="dir-label">THREAT — <span id="tw-threat">${Math.round(app.run.threat)}</span></div>
      <div class="dir-row">
        <button data-threat="-15">−</button><button data-threat="15">+</button>
      </div>
    </div>
    <div class="dir-section">
      <div class="dir-label">FORCE EVENT</div>
      <div class="dir-row" id="tw-events">
        ${Object.keys(EVENTS).map((id) => `<button data-event="${id}">${id.replace('_', ' ')}</button>`).join('')}
      </div>
    </div>
    <div class="dir-section">
      <div class="dir-label">JUMP TO FLOOR</div>
      <div class="dir-row" id="tw-floors">
        ${Object.values(FLOORS).map((f) => `<button data-floor="${f.id}">${f.label.split('—')[0].trim()}</button>`).join('')}
      </div>
    </div>
    <div class="dir-section">
      <div class="dir-label">RESOURCES</div>
      <div class="dir-row" id="tw-res">
        <button data-res="food:10">+food</button>
        <button data-res="ammo:20">+ammo</button>
        <button data-res="meds:3">+meds</button>
        <button data-res="cells:5">+cells</button>
        <button data-res="luxury:5">+luxury</button>
      </div>
    </div>
    <div class="dir-section">
      <div class="dir-label">RATIONING</div>
      <div class="dir-row">food:
        ${['normal', 'half', 'none'].map((r) => `<button data-ration="food:${r}" class="${app.run.rationPolicy.food === r ? 'active' : ''}">${r}</button>`).join('')}
      </div>
      <div class="dir-row">water:
        ${['normal', 'half', 'none'].map((r) => `<button data-ration="water:${r}" class="${app.run.rationPolicy.water === r ? 'active' : ''}">${r}</button>`).join('')}
      </div>
    </div>
    <div class="dir-section">
      <div class="dir-label">SYSTEMS — <span id="tw-sys">${Object.entries(app.run.systems).map(([k, s]) => `${k}:${Math.round(s.hp)}%${s.online ? '' : '⚠'}`).join(' · ')}</span></div>
      <div class="dir-row">
        <button data-power="off">kill power</button>
        <button data-power="on">restore power</button>
      </div>
    </div>`;

  el.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target);
    if (btn.dataset.threat) {
      app.run.threat = Math.max(0, Math.min(100, app.run.threat + Number(btn.dataset.threat)));
      el.querySelector('#tw-threat').textContent = String(Math.round(app.run.threat));
    }
    if (btn.dataset.event) { app.directorPanel.toggle(); app.eventRunner.fire(btn.dataset.event); }
    if (btn.dataset.floor) { app.directorPanel.toggle(); app.elevatorUI.ride(btn.dataset.floor); }
    if (btn.dataset.res) {
      const [key, n] = btn.dataset.res.split(':');
      app.run.resources[key] = (app.run.resources[key] || 0) + Number(n);
      app.bus?.emit?.('resources.changed', app.run.resources);
      import('../../core/bus.js').then((m) => m.emit('resources.changed', app.run.resources));
    }
    if (btn.dataset.ration) {
      const [key, val] = btn.dataset.ration.split(':');
      app.run.rationPolicy[key] = val;
      btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    }
    if (btn.dataset.power) {
      import('../../core/bus.js').then((m) => m.emit('power.changed', { online: btn.dataset.power === 'on' }));
      app.run.systems.power.online = btn.dataset.power === 'on';
    }
  });
}
