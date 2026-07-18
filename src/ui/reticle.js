// @ts-check
// FPS/TPS crosshair + magazine readout. The crosshair shows in first/third
// person; the ammo readout shows during combat (mag / reserve, with a reload
// hint when empty). Both are pure DOM driven by the bus.
import { on } from '../core/bus.js';

export class Reticle {
  constructor() {
    const hud = document.getElementById('hud');
    this.cross = document.createElement('div');
    this.cross.id = 'reticle';
    this.cross.className = 'hidden';
    this.cross.innerHTML = '<span></span><span></span><span></span><span></span><i></i>';
    hud?.appendChild(this.cross);

    this.ammo = document.createElement('div');
    this.ammo.id = 'ammo-readout';
    this.ammo.className = 'hidden';
    hud?.appendChild(this.ammo);

    this._aim = false;
    this._combat = false;

    on('camera.mode', ({ mode }) => {
      this._aim = mode === 'firstPerson' || mode === 'thirdPerson';
      this._sync();
    });
    on('combat.started', () => { this._combat = true; this._sync(); });
    on('combat.resolved', () => { this._combat = false; this._sync(); });
    on('combat.mag', ({ mag, magSize, reserve }) => {
      this.ammo.innerHTML = mag < 1
        ? `<b class="empty">RELOAD</b> <span>${reserve}</span>`
        : `<b>${mag}</b><small>/${magSize}</small> <span>· ${reserve}</span>`;
    });
    on('combat.hit', () => this._flashHit());
  }

  _sync() {
    this.cross.className = this._aim ? '' : 'hidden';
    this.ammo.className = (this._aim && this._combat) ? '' : 'hidden';
  }

  _flashHit() {
    this.cross.classList.add('hit');
    clearTimeout(this._hitT);
    this._hitT = window.setTimeout(() => this.cross.classList.remove('hit'), 120);
  }
}
