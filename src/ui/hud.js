// @ts-check
// In-world HUD: interaction prompt, game clock, resource strip, camera hint,
// alerts, event-choice modal.
import { on } from '../core/bus.js';

let root = null;

const RES_ICONS = { food: '🍜', water: '💧', meds: '💊', ammo: '▮', cells: '⚡', parts: '⚙', luxury: '🥃' };

export function initHud() {
  root = document.getElementById('hud');
  root.innerHTML = `
    <div id="hud-clock" class="hud-chip"></div>
    <div id="hud-resources" class="hud-chip"></div>
    <div id="hud-hint" class="hud-chip">C — camera &nbsp;·&nbsp; WASD — move &nbsp;·&nbsp; E — interact &nbsp;·&nbsp; F — focus cast</div>
    <div id="hud-prompt"></div>
    <div id="hud-alert"></div>
    <div id="hud-choice"></div>`;

  const resEl = root.querySelector('#hud-resources');
  on('resources.changed', (resources) => {
    resEl.innerHTML = Object.entries(RES_ICONS).map(([k, icon]) => {
      const v = resources[k] ?? 0;
      const low = (k === 'food' && v <= 6) || (k === 'water' && v <= 8) || v <= 1;
      return `<span class="res ${low ? 'low' : ''}">${icon}${Math.floor(v)}</span>`;
    }).join('');
  });

  const choiceEl = root.querySelector('#hud-choice');
  on('event.choice', ({ prompt, options, pick }) => {
    choiceEl.innerHTML = `
      <div class="choice-box clickable">
        <div class="choice-prompt">${prompt}</div>
        <div class="choice-opts">${options.map((o, i) =>
          `<button data-i="${i}">${o}</button>`).join('')}</div>
      </div>`;
    choiceEl.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        choiceEl.innerHTML = '';
        pick(Number(btn.dataset.i));
      });
    });
  });

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
