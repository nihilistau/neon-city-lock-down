// @ts-check
// In-world HUD: interaction prompt, game clock, resource strip, camera hint,
// alerts, event-choice modal.
import { on } from '../core/bus.js';
import { settings } from '../core/settings.js';
import { escapeHtml } from './widgets.js';
import { loadHudIcons, iconUrl } from './icons.js';
import { FLOORS } from '../../data/zones.js';

let root = null;

const RES_KEYS = ['food', 'water', 'meds', 'ammo', 'cells', 'parts', 'luxury'];

export function initHud() {
  root = document.getElementById('hud');
  root.innerHTML = `
    <div id="hud-clock" class="hud-chip"></div>
    <div id="hud-floor" class="hud-chip">${FLOORS.penthouse.label}</div>
    <div id="hud-resources" class="hud-chip"></div>
    <div id="hud-threat" class="hud-chip" title="Threat — how close the city outside is to coming through the door">
      <img class="res-ico" alt="" src="">
      <span class="th-label">THREAT</span>
      <span class="th-track"><span class="th-fill"></span></span>
      <span class="th-val">0</span>
    </div>
    <div id="hud-hint" class="hud-chip hidden">Press ? for controls</div>
    <div id="hud-help" class="hidden"></div>
    <div id="hud-prompt"></div>
    <div id="hud-alert"></div>
    <div id="hud-choice"></div>`;

  const resEl = root.querySelector('#hud-resources');
  let playerHealth = 100;
  const renderRes = (resources) => {
    const hpLow = playerHealth <= 35;
    resEl.innerHTML =
      `<span class="res hp ${hpLow ? 'low' : ''}"><img class="res-ico" alt="" src="${iconUrl('hp')}">${Math.round(playerHealth)}</span>` +
      RES_KEYS.map((k) => {
        const v = resources[k] ?? 0;
        const low = (k === 'food' && v <= 6) || (k === 'water' && v <= 8) || v <= 1;
        return `<span class="res ${low ? 'low' : ''}"><img class="res-ico" alt="" src="${iconUrl(k)}">${Math.floor(v)}</span>`;
      }).join('');
  };
  let lastRes = {};
  on('resources.changed', (resources) => { lastRes = resources; renderRes(resources); });
  on('player.health', ({ health }) => { playerHealth = health; renderRes(lastRes); });
  loadHudIcons(() => {
    renderRes(lastRes);
    const thIco = root.querySelector('#hud-threat .res-ico');
    if (thIco) thIco.src = iconUrl('threat');
  });

  // Choice modals QUEUE rather than clobber. Previously a second `event.choice`
  // — the elevator floor picker is one — overwrote a pending event's buttons, so
  // its `pick` was never called and the event-script promise never settled. That
  // latches `run.activeEventId`, which silently blocks every future event *and*
  // the hourly autosave for the rest of the run.
  const choiceEl = root.querySelector('#hud-choice');
  /** @type {{prompt:string, options:string[], pick:(i:number)=>void}[]} */
  const choiceQueue = [];
  const renderChoice = () => {
    const c = choiceQueue[0];
    if (!c) { choiceEl.innerHTML = ''; return; }
    const faces = (c.portraits || []).map((id) =>
      `<img class="choice-face" alt="" src="/assets/chars/${escapeHtml(id)}/face.jpg">`).join('');
    choiceEl.innerHTML = `
      <div class="choice-box clickable">
        ${faces ? `<div class="choice-faces">${faces}</div>` : ''}
        <div class="choice-prompt">${escapeHtml(c.prompt)}</div>
        <div class="choice-opts">${c.options.map((o, i) =>
          `<button data-i="${i}">${escapeHtml(o)}</button>`).join('')}</div>
      </div>`;
    choiceEl.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        choiceQueue.shift();
        renderChoice();          // surface the next pending choice, if any
        c.pick(Number(btn.dataset.i));
      }, { once: true });
    });
  };
  on('event.choice', (c) => {
    choiceQueue.push(c);
    if (choiceQueue.length === 1) renderChoice();
  });

  // Threat drives event weights, the music conductor and ambience loudness — it
  // was the single most important world variable with no HUD element at all, so
  // the pressure the whole day-loop is built around was invisible.
  const threatEl = root.querySelector('#hud-threat');
  const threatFill = threatEl.querySelector('.th-fill');
  const threatVal = threatEl.querySelector('.th-val');
  on('threat.changed', ({ threat }) => {
    const t = Math.max(0, Math.min(100, threat));
    threatFill.style.width = `${t}%`;
    threatVal.textContent = String(Math.round(t));
    // band the bar rather than a continuous ramp, so a glance reads as a state
    threatEl.dataset.band = t >= 70 ? 'critical' : t >= 45 ? 'high' : t >= 22 ? 'raised' : 'calm';
  });

  const prompt = root.querySelector('#hud-prompt');
  on('pick.hover', (h) => {
    prompt.textContent = h ? `[E] ${h.prompt}` : '';
    prompt.classList.toggle('visible', !!h);
  });

  const clockEl = root.querySelector('#hud-clock');
  on('world.minute', ({ clock }) => { clockEl.textContent = clock.label; });
  const floorEl = root.querySelector('#hud-floor');
  on('floor.changed', ({ floor } = {}) => {
    floorEl.textContent = FLOORS[floor]?.label || FLOORS.penthouse.label;
  });

  const alertEl = root.querySelector('#hud-alert');
  let alertTimer = 0;
  on('hud.alert', ({ text, kind }) => {
    alertEl.textContent = text;
    alertEl.className = `visible ${kind || ''}`;
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => alertEl.classList.remove('visible'), 4200);
  });

  const helpEl = root.querySelector('#hud-help');
  const CAM_HELP = {
    auto: 'C camera · E/click interact',
    thirdPerson: 'C camera · WASD move · mouse aim · LMB fire · R reload · Ctrl cover · E interact',
    firstPerson: 'C camera · WASD move · mouselook · LMB fire · R reload · Ctrl cover · E interact',
    director: 'C camera · drag orbit · F focus cast · click interact',
  };
  const KEY_HELP = 'P plan · I inventory · K codex · ` director · G kit · L llm · V voice · Esc menu';
  let camMode = 'director';
  const renderHelp = () => {
    helpEl.innerHTML =
      `<div class="help-box"><div class="help-title">CONTROLS</div>` +
      `<div>${escapeHtml(CAM_HELP[camMode] || CAM_HELP.director)}</div>` +
      `<div>${escapeHtml(KEY_HELP)}</div>` +
      `<div class="help-foot">? to close</div></div>`;
  };
  on('camera.mode', ({ mode }) => { camMode = mode; if (!helpEl.classList.contains('hidden')) renderHelp(); });
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Slash' && e.key !== '?') return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    helpEl.classList.toggle('hidden');
    if (!helpEl.classList.contains('hidden')) renderHelp();
  });

  // subtitle scale from settings
  const applySubScale = () => {
    document.getElementById('subtitles').style.fontSize = `${(settings.subtitleScale || 1) * 17}px`;
  };
  applySubScale();
  on('settings.changed', applySubScale);
}
