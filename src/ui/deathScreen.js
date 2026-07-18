// @ts-check
// Run-summary screen on perma-death. New run = fresh page load with a new seed.
import { on } from '../core/bus.js';
import { meta } from '../sim/meta.js';

const CAUSE_LINES = {
  combat: 'The rioters took the tower — and you with it.',
  starvation: 'The pantry emptied. Hunger is patient.',
  dehydration: 'The water ran dry three days before you did.',
  extracted: 'You rode the shuttle out over a burning skyline. You survived Neon-City. Few can say it.',
  unknown: 'The lockdown claimed another name.',
};

export function initDeathScreen() {
  on('run.death', (summary) => show(summary));
}

function show(summary) {
  const overlay = document.getElementById('overlay');
  const bonds = Object.entries(summary.bonds || {})
    .map(([id, v]) => `<div class="ds-row"><span>${id}</span><span>${v > 60 ? 'devoted' : v > 35 ? 'warm' : v > 15 ? 'wary' : 'cold'} (${v})</span></div>`)
    .join('');
  const won = summary.endedBy === 'extracted';
  const codexRows = meta.codex.slice(-6).map((c) => `<div class="ds-row"><span>◈ ${c.title}</span></div>`).join('');
  const screen = document.createElement('div');
  screen.className = 'screen';
  screen.innerHTML = `
    <div class="panel" style="max-width:480px">
      <h1 class="neon-title" style="color:var(--${won ? 'green' : 'red'});text-shadow:0 0 8px ${won ? 'rgba(61,255,154,.8)' : 'rgba(255,71,87,.8)'}">${won ? 'EXTRACTED' : 'RUN OVER'}</h1>
      <h2>${CAUSE_LINES[summary.endedBy] || CAUSE_LINES.unknown}</h2>
      <div class="ds-grid">
        <div class="ds-row"><span>Days survived</span><span>${summary.days}</span></div>
        <div class="ds-row"><span>Hostiles down</span><span>${summary.kills}</span></div>
        <div class="ds-row"><span>Events weathered</span><span>${summary.eventsSurvived}</span></div>
        <div class="ds-row"><span>Choices made</span><span>${summary.choices}</span></div>
      </div>
      <h2 style="margin-top:18px">Bonds</h2>
      <div class="ds-grid">${bonds}</div>
      ${codexRows ? `<h2 style="margin-top:14px">Codex — discovered</h2><div class="ds-grid">${codexRows}</div>` : ''}
      <p style="margin-top:14px;font-size:12px">Runs completed: ${meta.runs.length} · Codex entries: ${meta.codex.length}</p>
      <div class="actions">
        <button id="ds-again">Begin a new run</button>
      </div>
    </div>`;
  overlay.appendChild(screen);
  screen.querySelector('#ds-again').addEventListener('click', () => location.reload());
}
