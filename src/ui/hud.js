// @ts-check
// In-world HUD: interaction prompt, game clock, camera-mode hint, alerts.
import { on } from '../core/bus.js';

let root = null;

export function initHud() {
  root = document.getElementById('hud');
  root.innerHTML = `
    <div id="hud-clock" class="hud-chip"></div>
    <div id="hud-hint" class="hud-chip">C — camera &nbsp;·&nbsp; WASD — move &nbsp;·&nbsp; E — interact &nbsp;·&nbsp; F — focus cast</div>
    <div id="hud-prompt"></div>
    <div id="hud-alert"></div>`;

  const prompt = root.querySelector('#hud-prompt');
  on('pick.hover', (h) => {
    prompt.textContent = h ? `[E] ${h.prompt}` : '';
    prompt.classList.toggle('visible', !!h);
  });

  const clockEl = root.querySelector('#hud-clock');
  on('world.minute', ({ clock }) => { clockEl.textContent = clock.label; });

  const alertEl = root.querySelector('#hud-alert');
  let alertTimer = 0;
  on('hud.alert', ({ text, kind }) => {
    alertEl.textContent = text;
    alertEl.className = `visible ${kind || ''}`;
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => alertEl.classList.remove('visible'), 4200);
  });

  const camHint = root.querySelector('#hud-hint');
  on('camera.mode', ({ mode }) => {
    camHint.textContent = mode === 'firstPerson'
      ? 'C — director cam · WASD — move · E — interact · click — mouselook'
      : 'C — first person · drag — orbit · F — focus cast · E/click — interact';
  });
}
