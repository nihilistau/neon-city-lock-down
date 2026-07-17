// @ts-check
// Composition root. The only module allowed to import everything and wire it up.
import { GameClock } from './clock.js';
import { Loop } from './loop.js';
import { Rng } from './rng.js';
import { settings } from './settings.js';
import { setDebugLogging, dbg, feed } from './log.js';
import { emit } from './bus.js';
import { Stage } from '../scene3d/stage.js';
import { PostFX } from '../scene3d/postfx.js';
import { BootScene } from '../scene3d/bootScene.js';
import { showGate18 } from '../ui/gate18.js';

export class App {
  constructor() {
    const params = new URLSearchParams(location.search);
    this.debug = params.get('debug') === '1' || settings.debug;
    setDebugLogging(this.debug);

    this.clock = new GameClock();
    this.rng = new Rng(Date.now());
    this.stage = new Stage(/** @type {HTMLCanvasElement} */(document.getElementById('gl')));
    this.postfx = new PostFX(this.stage);
    this.bootScene = new BootScene(this.stage, this.rng.stream('boot'));

    /** @type {'boot'|'run'} */
    this.mode = 'boot';

    this.loop = new Loop({
      clock: this.clock,
      render: (dt) => this.render(dt),
      simStep: (step) => this.simStep(step),
      onMinute: (clock) => emit('world.minute', { clock }),
    });
    this.loop.pause('boot'); // sim halted until a run starts; render continues

    if (this.debug) this._exposeDebug();
  }

  async start() {
    this.loop.start();
    await showGate18();          // resolves on the enter click (audio unlock point)
    emit('game.entered', {});
    feed(`${settings.playerName} entered the tower.`, 'system');
    dbg('gate passed; boot scene active (Phase 0 scaffold)');
  }

  /** @param {number} dt */
  render(dt) {
    if (this.mode === 'boot' && this.bootScene) this.bootScene.update(dt);
    this.postfx.render(dt);
  }

  /** @param {number} step fixed 100ms sim step (paused during boot) */
  simStep(step) {
    // ActorQueues, combat, movement — wired in Phase 1.
  }

  _exposeDebug() {
    // Smoke-test/debug API — the contract used by headless tests.
    // @ts-ignore
    window.__ncld = {
      ready: true,
      app: this,
      debug: {
        fps: () => this.loop.fps(),
        snapshot: () => ({ mode: this.mode, clock: this.clock.serialize() }),
        advanceMinutes: (n) => this.clock.skip(n, (c) => emit('world.minute', { clock: c })),
      },
    };
  }
}
