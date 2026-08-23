// @ts-check
// Combat overlay: wave banner, hostile hp bars, the player's cover state,
// hit% on the nearest hostile, and the blast-shutter control. Visible only
// while a breach is live; refreshes on an internal rAF-lite interval.
import { on } from '../core/bus.js';

export class CombatHud {
  /** @param {import('../core/app.js').App} app */
  constructor(app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.id = 'combat-hud';
    this.el.style.display = 'none';
    document.getElementById('hud')?.appendChild(this.el);
    this._timer = 0;
    this._waveIncoming = 0;

    on('combat.started', () => this._show());
    on('combat.resolved', () => this._hide());
    on('combat.waveIncoming', ({ inSec }) => { this._waveIncoming = inSec; });
    on('combat.wave', () => { this._waveIncoming = 0; });
    on('combat.shutters', () => this._render());
    on('combat.hit', ({ crit, glancing }) => this._hitMark(crit, glancing));
  }

  _hitMark(crit, glancing) {
    let el = document.getElementById('hit-mark');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hit-mark';
      document.getElementById('hud')?.appendChild(el);
    }
    el.className = `visible ${crit ? 'crit' : glancing ? 'glance' : ''}`;
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => el.classList.remove('visible'), crit ? 220 : 120);
  }

  _show() {
    this.el.style.display = '';
    this._timer = window.setInterval(() => {
      if (this._waveIncoming > 0) this._waveIncoming = Math.max(0, this._waveIncoming - 0.25);
      this._render();
    }, 250);
    this._render();
  }

  _hide() {
    this.el.style.display = 'none';
    if (this._timer) { clearInterval(this._timer); this._timer = 0; }
    this._waveIncoming = 0;
  }

  _render() {
    const combat = this.app.combat;
    if (!combat.active) return;
    const run = this.app.run;
    const def = this.app.world.defences;
    const alive = combat.hostiles.filter((h) => h.hp > 0);
    const cover = combat.playerCover();
    const grid = run.systems.defence;

    const hostileBars = alive.map((h) => {
      const pct = Math.max(0, Math.round((h.hp / h.maxHp) * 100));
      const best = Math.round(combat.playerHitChance(h) * 100);
      return `<div class="ch-hostile">
        <span class="ch-hname">${h.actor.persona.name}</span>
        <span class="ch-bar"><i style="width:${pct}%"></i></span>
        <span class="ch-hit">${best}%</span>
      </div>`;
    }).join('');

    const shutterDown = !!def?.shutter.down;
    const canDrop = !shutterDown && run.resources.cells >= 2;
    const incoming = this._waveIncoming > 0
      ? `<div class="ch-incoming">REINFORCEMENTS IN ${Math.ceil(this._waveIncoming)}s</div>` : '';

    this.el.innerHTML = `
      <div class="ch-top">
        <span class="ch-wave">WAVE ${combat.wave}/${combat.totalWaves}</span>
        ${cover > 0 ? `<span class="ch-cover">IN COVER −${Math.round(cover * 100)}%</span>`
                    : '<span class="ch-cover exposed">EXPOSED</span>'}
        <span class="ch-turret ${grid.online && grid.hp > 5 ? '' : 'off'}">TURRET ${grid.online && grid.hp > 5 ? Math.round(grid.hp) + '%' : 'OFFLINE'}</span>
      </div>
      ${incoming}
      <div class="ch-hostiles">${hostileBars}</div>
      <button class="ch-shutter ${shutterDown ? 'down' : ''}" ${canDrop || shutterDown ? '' : 'disabled'}>
        ${shutterDown ? 'SHUTTERS SEALED' : 'DROP SHUTTERS — 2 CELLS'}
      </button>`;

    const btn = this.el.querySelector('.ch-shutter');
    if (btn && !shutterDown) btn.addEventListener('click', () => combat.dropShutters());
  }
}
