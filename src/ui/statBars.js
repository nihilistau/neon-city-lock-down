// @ts-check
// Live per-character stat bars + gate pips (the Director rail, always visible).
import { on } from '../core/bus.js';
import { STAT_KEYS } from '../chars/stats.js';
import { GATE_LADDER } from '../chars/gates.js';

const STAT_COLOR = {
  arousal: '#ff5fa8', pleasure: '#ff8fc0', happiness: '#ffd23f', horniness: '#ff3f6a',
  openness: '#3dff9a', dominance: '#9d6bff', trust: '#39e6ff', tension: '#ff7043',
  energy: '#7fff5a', sobriety: '#8ec7ff', loyalty: '#c39bff', fear: '#ff4757',
};
const GATE_SHORT = { light_touch: 'T', kiss: 'K', touch: 'H', undress: 'U', intimate: 'I', explicit: 'X', depraved: 'D' };

let root = null;
/** @type {Map<string, HTMLElement>} */
const cards = new Map();

export function initStatBars() {
  root = document.getElementById('statbars');
  if (!root) {
    root = document.createElement('div');
    root.id = 'statbars';
    document.getElementById('ui').appendChild(root);
  }
  root.innerHTML = '';
  cards.clear();

  on('char.registered', ({ character }) => addCard(character));
  on('char.stat', ({ id, stats }) => updateBars(id, stats));
  on('char.mood', ({ id, mood }) => { const c = cards.get(id); if (c) c.querySelector('.mood').textContent = mood; });
  on('gate.changed', ({ id, gates }) => updateGates(id, gates));
}

function addCard(character) {
  const card = document.createElement('div');
  card.className = 'sb-card';
  card.dataset.id = character.id;
  card.style.setProperty('--accent', `#${character.persona.accent.toString(16).padStart(6, '0')}`);
  const bars = STAT_KEYS.map((k) =>
    `<div class="sb-row" data-stat="${k}">
       <span class="sb-label">${k.slice(0, 4)}</span>
       <span class="sb-track"><span class="sb-fill" style="background:${STAT_COLOR[k]}"></span></span>
       <span class="sb-val"></span>
     </div>`).join('');
  const pips = GATE_LADDER.map((t) =>
    `<span class="sb-pip" data-tier="${t}" title="${t}">${GATE_SHORT[t]}</span>`).join('');
  card.innerHTML = `
    <div class="sb-head clickable"><span class="sb-name">${character.name}</span><span class="mood">—</span></div>
    <div class="sb-body">
      <div class="sb-bars">${bars}</div>
      <div class="sb-gates">${pips}</div>
    </div>`;
  root.appendChild(card);
  cards.set(character.id, card);
  // click the header to collapse to name + mood + gates only
  card.querySelector('.sb-head').addEventListener('click', () => card.classList.toggle('collapsed'));
  if (character.id === 'vox') card.classList.add('collapsed');
  updateBars(character.id, character.stats);
  updateGates(character.id, character.gates);
}

function updateBars(id, stats) {
  const card = cards.get(id);
  if (!card) return;
  for (const k of STAT_KEYS) {
    const row = card.querySelector(`.sb-row[data-stat="${k}"]`);
    if (!row) continue;
    const v = Math.round(stats[k]);
    row.querySelector('.sb-fill').style.width = v + '%';
    row.querySelector('.sb-val').textContent = v;
  }
}

function updateGates(id, gates) {
  const card = cards.get(id);
  if (!card) return;
  for (const t of GATE_LADDER) {
    const pip = card.querySelector(`.sb-pip[data-tier="${t}"]`);
    if (pip) pip.className = `sb-pip ${gates[t]}`;
  }
}

/** collapse/expand the whole rail */
export function toggleStatBars(show) {
  if (root) root.classList.toggle('hidden', show === false);
}
