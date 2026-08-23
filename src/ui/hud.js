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

/**
 * Keep the left column from colliding with itself.
 *
 * `#hud-floor`, `#statbars` and `#chat` all live on the left edge, and the rail
 * and the chat log BOTH take pointer events — so any overlap makes clicks land
 * ambiguously. This has now regressed twice from hard-coded constants: a flat
 * `56vh`, then `calc(62vh - 150px)` which was calibrated against wrap-row reply
 * chips before v0.4 restacked them vertically (measured: 108px of overlap).
 *
 * So stop guessing. Measure what the neighbours actually occupy and publish the
 * result as CSS custom properties, recomputed on resize and whenever the chat
 * or the floor chip changes size.
 */
function layoutLeftColumn() {
  const floorEl = document.getElementById('hud-floor');
  const railEl = document.getElementById('statbars');
  const chatEl = document.getElementById('chat');

  const apply = () => {
    if (!railEl) return;
    const gap = 8;
    const floorBottom = floorEl ? floorEl.getBoundingClientRect().bottom : 46;
    const railTop = Math.round(floorBottom + gap);
    // chat may not exist yet (it mounts with the run) — fall back to a sane share
    const chatTop = chatEl && chatEl.offsetParent !== null
      ? chatEl.getBoundingClientRect().top
      : window.innerHeight * 0.62;
    const railMax = Math.max(120, Math.round(chatTop - railTop - gap));
    railEl.style.setProperty('--rail-top', `${railTop}px`);
    railEl.style.setProperty('--rail-max', `${railMax}px`);
  };

  apply();
  window.addEventListener('resize', apply);
  // the chat grows as chips stack and the log fills; the floor chip wraps on
  // long labels. Re-measure whenever either actually changes size.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(apply);
    if (chatEl) ro.observe(chatEl);
    if (floorEl) ro.observe(floorEl);
  }
  // chat mounts after the HUD, so re-measure once the run is up
  on('game.entered', () => setTimeout(apply, 0));
  on('chat.reply', () => apply());
}

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
    <div id="hud-hint" class="hud-chip">Press <b>?</b> for controls</div>
    <div id="hud-help" class="hidden"></div>
    <div id="hud-prompt"></div>
    <div id="hud-alert"></div>
    <div id="hud-choice"></div>`;

  layoutLeftColumn();

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
    auto: 'WASD move · C camera · E/click interact  (auto-camera is framing the shot)',
    thirdPerson: 'C camera · WASD move · Shift run · Ctrl crouch · mouse aim · LMB fire · R reload · E interact',
    firstPerson: 'C camera · WASD move · Shift run · Ctrl crouch · mouselook · LMB fire · R reload · E interact',
    director: 'C camera · drag orbit · F focus cast · click interact',
  };
  // Shift (run) and Ctrl (crouch/cover) were missing entirely, and so was `?`
  // itself — which mattered because the on-screen hint pointing at this overlay
  // was shipped hidden, making the whole control surface undiscoverable.
  const KEY_HELP = 'P plan · I inventory · K codex · ` director · G kit · L llm · V voice · Esc menu · Space skip/act · ? this help';
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
    // `?` only — e.code === 'Slash' is also true for an unshifted `/`, which
    // meant a bare slash anywhere opened the overlay.
    if (e.key !== '?') return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      || e.target instanceof HTMLSelectElement) return;
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
