// @ts-check
// CanvasTexture wall screens: the news ticker (scrolling headline band + threat
// meter + clock). Refreshes its canvas at ~10Hz; emissive so it blooms gently.
// Blackouts kill the screen (power.changed).
import * as THREE from 'three';
import { on } from '../core/bus.js';
import { NEWS_POOLS } from '../../data/news.js';

export class NewsTicker {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../core/rng.js').RngStream} rng
   * @param {{position:[number,number,number], rotationY?:number, width?:number}} opts
   */
  constructor(scene, rng, opts) {
    this.rng = rng;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 192;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;

    const w = opts.width ?? 3.4;
    const h = w * (192 / 1024);
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        map: this.tex, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 0.85,
        roughness: 0.4, color: 0x111111,
      })
    );
    this.mesh.position.set(...opts.position);
    if (opts.rotationY) this.mesh.rotation.y = opts.rotationY;
    // bezel
    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x0a0c12, roughness: 0.5 })
    );
    bezel.position.z = -0.03;
    this.mesh.add(bezel);
    scene.add(this.mesh);

    this.scrollX = 0;
    this.headline = this._pickHeadline(20);
    this.nextHeadline = null;
    this.threat = 20;
    this.clockLabel = '';
    this.powered = true;
    this._acc = 0;

    /** @type {string[]} urgent queue from events */
    this.urgent = [];
    on('news.push', ({ text }) => this.urgent.push(text));
    on('threat.changed', ({ threat }) => { this.threat = threat; });
    on('world.minute', ({ clock }) => { this.clockLabel = clock.label; });
    on('power.changed', ({ online }) => { this.powered = online; });
  }

  _pickHeadline(threat) {
    const pool = threat > 60 ? NEWS_POOLS.high : threat > 32 ? NEWS_POOLS.mid : NEWS_POOLS.low;
    return this.rng.pick(pool);
  }

  /** @param {number} dt seconds */
  update(dt) {
    this._acc += dt;
    if (this._acc < 0.1) return;   // ~10Hz redraw
    const step = this._acc;
    this._acc = 0;

    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;

    if (!this.powered) {
      ctx.fillStyle = '#020308';
      ctx.fillRect(0, 0, W, H);
      // faint scanline noise on dead screen
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `rgba(80,120,140,${Math.random() * 0.03})`;
        ctx.fillRect(Math.random() * W, Math.random() * H, Math.random() * 60, 1);
      }
      this.tex.needsUpdate = true;
      return;
    }

    // background
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, W, H);

    // header band
    ctx.fillStyle = '#0c1322';
    ctx.fillRect(0, 0, W, 56);
    ctx.font = '700 34px Consolas, monospace';
    ctx.fillStyle = '#39e6ff';
    ctx.fillText('NC-24 LIVE', 24, 40);
    ctx.font = '400 26px Consolas, monospace';
    ctx.fillStyle = '#7d93a3';
    ctx.fillText(this.clockLabel, W - 320, 40);
    // lockdown badge blink
    if (Math.floor(performance.now() / 700) % 2 === 0) {
      ctx.fillStyle = '#ff4757';
      ctx.fillRect(300, 14, 16, 16);
      ctx.font = '700 24px Consolas, monospace';
      ctx.fillText('LOCKDOWN', 326, 38);
    }

    // threat meter
    ctx.font = '400 22px Consolas, monospace';
    ctx.fillStyle = '#7d93a3';
    ctx.fillText('THREAT', 24, 84);
    ctx.fillStyle = '#131b2c';
    ctx.fillRect(120, 68, 300, 18);
    const tcol = this.threat > 60 ? '#ff4757' : this.threat > 32 ? '#ffb347' : '#3dff9a';
    ctx.fillStyle = tcol;
    ctx.fillRect(120, 68, 3 * this.threat, 18);
    ctx.fillStyle = tcol;
    ctx.fillText(String(Math.round(this.threat)), 436, 84);

    // ticker band
    ctx.fillStyle = '#0c1322';
    ctx.fillRect(0, H - 62, W, 62);
    ctx.font = '700 36px Consolas, monospace';
    ctx.fillStyle = this.urgentActive ? '#ff4757' : '#e8f4f8';
    const text = '  +++  ' + this.headline + '  +++  ';
    const tw = ctx.measureText(text).width;
    this.scrollX -= step * 110;
    if (this.scrollX < -tw) {
      this.scrollX = 0;
      this.urgentActive = false;
      this.headline = this.urgent.length
        ? (this.urgentActive = true, this.urgent.shift())
        : this._pickHeadline(this.threat);
    }
    ctx.fillText(text, this.scrollX, H - 18);
    ctx.fillText(text, this.scrollX + tw, H - 18);

    this.tex.needsUpdate = true;
  }
}
