// @ts-check
// Live per-character stat bars + bond chip (the Director rail, always visible).
import { on } from '../core/bus.js';
import { STAT_KEYS } from '../chars/stats.js';

const STAT_COLOR = {
  arousal: '#ff5fa8', pleasure: '#ff8fc0', happiness: '#ffd23f', horniness: '#ff3f6a',
  openness: '#3dff9a', dominance: '#9d6bff', trust: '#39e6ff', tension: '#ff7043',
  energy: '#7fff5a', sobriety: '#8ec7ff', loyalty: '#c39bff', fear: '#ff4757',
};
const HERO = ['trust', 'tension', 'openness', 'arousal'];
const STAT_LABEL = {
  arousal: 'arousal', pleasure: 'pleasure', happiness: 'happy', horniness: 'heat',
  openness: 'open', dominance: 'dom', trust: 'trust', tension: 'tension',
  energy: 'energy', sobriety: 'sober', loyalty: 'loyal', fear: 'fear',
};

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

  on('combat.started', () => root?.classList.add('hidden'));
  on('combat.resolved', () => root?.classList.remove('hidden'));
  on('bedscene.started', () => root?.classList.add('hidden'));
  on('bedscene.ended', () => root?.classList.remove('hidden'));
  on('char.registered', ({ character }) => { if (!cards.has(character.id)) addCard(character); });
  on('char.removed', ({ id }) => { const c = cards.get(id); if (c) { c.remove(); cards.delete(id); } });
  on('char.stat', ({ id, stats, bond }) => { updateBars(id, stats); if (bond) setBondChip(id, bond); });
  on('char.mood', ({ id, mood }) => { const c = cards.get(id); if (c) c.querySelector('.mood').textContent = mood; });
  on('bond.changed', ({ id, to }) => setBondChip(id, to));
}

/** @param {string} id @param {string} tier */
function setBondChip(id, tier) {
  const chip = /** @type {HTMLElement|null|undefined} */ (cards.get(id)?.querySelector('.sb-bond'));
  if (chip && chip.dataset.tier !== tier) { chip.textContent = tier; chip.dataset.tier = tier; }
}

function addCard(character) {
  const card = document.createElement('div');
  card.className = 'sb-card';
  card.dataset.id = character.id;
  // personas store accent as a CSS string ('#ff3fa4'), not a number. The old
  // `.toString(16).padStart(6,'0')` produced '##ff3fa4' — legal enough that
  // var(--accent, …) did NOT fall back, so every card silently lost its colour.
  card.style.setProperty('--accent', character.persona.accent);
  const bars = STAT_KEYS.map((k) =>
    `<div class="sb-row${HERO.includes(k) ? ' hero' : ''}" data-stat="${k}">
       <span class="sb-label">${STAT_LABEL[k] || k}</span>
       <span class="sb-track"><span class="sb-fill" style="background:${STAT_COLOR[k]}"></span></span>
       <span class="sb-val"></span>
     </div>`).join('');
  card.innerHTML = `
    <div class="sb-head clickable"><span class="sb-name">${character.name}</span><span class="mood">—</span><span class="sb-bond" data-tier="${character.bond}">${character.bond}</span></div>
    <div class="sb-body">
      <div class="sb-bars">${bars}</div>
    </div>`;
  root.appendChild(card);
  cards.set(character.id, card);
  // click the header to collapse to name + mood + bond only
  card.querySelector('.sb-head').addEventListener('click', () => card.classList.toggle('collapsed'));
  card.classList.add('collapsed');
  updateBars(character.id, character.stats);
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

/** collapse/expand the whole rail */
export function toggleStatBars(show) {
  if (root) root.classList.toggle('hidden', show === false);
}
