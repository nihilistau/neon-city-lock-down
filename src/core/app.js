// @ts-check
// Composition root. The only module allowed to import everything and wire it up.
import '../../data/poses/base.js';
import '../../data/dialogue/intents.js';
import '../../data/dialogue/lola/fallbacks.js';
import '../../data/dialogue/lola/core.js';
import * as THREE from 'three';
import { GameClock } from './clock.js';
import { Loop } from './loop.js';
import { Rng } from './rng.js';
import { settings } from './settings.js';
import { setDebugLogging, dbg, feed } from './log.js';
import { emit, on } from './bus.js';
import { Stage } from '../scene3d/stage.js';
import { PostFX } from '../scene3d/postfx.js';
import { BootScene } from '../scene3d/bootScene.js';
import { Lighting } from '../scene3d/lighting.js';
import { World3D } from '../scene3d/tower/zoneBuilder.js';
import { Picker } from '../scene3d/picking.js';
import { CameraRig } from '../camera/cameraRig.js';
import { Actor3D } from '../humanoid/actor3d.js';
import { ActorQueue } from '../sim/actors/actorQueue.js';
import { Character } from '../chars/character.js';
import { DialogueEngine } from '../dialogue/engine.js';
import { TtsRouter } from '../dialogue/ttsRouter.js';
import { LLMAdapter } from '../dialogue/llmAdapter.js';
import { showGate18 } from '../ui/gate18.js';
import { initHud } from '../ui/hud.js';
import { initStatBars } from '../ui/statBars.js';
import { ChatPanel } from '../ui/chatPanel.js';
import lola from '../../data/cast/lola.js';
import { ZONES } from '../../data/zones.js';

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
    /** @type {Record<string, Character>} */
    this.cast = {};
    globalThis.__ncldExplicitness = settings.explicitness;

    this.loop = new Loop({
      clock: this.clock,
      render: (dt) => this.render(dt),
      simStep: (step) => this.simStep(step),
      onMinute: (clock) => emit('world.minute', { clock }),
    });
    this.loop.pause('boot');

    if (this.debug) this._exposeDebug();
  }

  async start() {
    this.loop.start();
    await showGate18();
    emit('game.entered', {});
    this.startRun();
  }

  /** Build the world and begin a run (slice: straight into the penthouse). */
  startRun() {
    this.bootScene.dispose();
    this.bootScene = null;
    this.mode = 'run';

    this.world = new World3D(this.stage, this.rng.stream('world'));
    this.lighting = new Lighting(this.stage);
    this.lighting.apply('neon_night', 0.01);

    this.cameraRig = new CameraRig(this.stage, this.world);
    this.picker = new Picker(this.stage, this.cameraRig);
    initHud();
    initStatBars();

    // interactive props (audio hooks arrive in P1.5)
    for (const prop of this.world.props) {
      this.picker.register({
        ...prop,
        onInteract: () => {
          feed(`${settings.playerName} used ${prop.id}.`, 'info');
          emit('prop.used', { id: prop.id });
        },
      });
    }

    // spawn Lola in the lounge
    this.spawn(lola, 'lounge');
    this.cast.lola.actor.faceYaw(Math.PI); // face the lounge / player

    // player presence marker — a look target the cast tracks (follows camera)
    this.playerMarker = new THREE.Object3D();
    this.playerMarker.position.set(-2, 1.5, 2);
    this.stage.scene.add(this.playerMarker);
    this.player = { name: settings.playerName, dominance: 55 };

    // dialogue engine + chat UI
    this.tts = new TtsRouter();
    this.llm = new LLMAdapter();
    this.dialogue = new DialogueEngine({
      cast: this.cast,
      nowMinute: () => this.clock.totalMinutes,
      day: () => this.clock.day,
      rng: this.rng.stream('dialogue'),
      vocab: { chars: ['lola', 'aria', 'kai'], zones: Object.keys(ZONES), items: ['whiskey', 'gun', 'food', 'water'] },
      llm: this.llm,
      tts: this.tts,
      stageCtx: {
        world: this.world, lighting: this.lighting, audio: this.audioFacade(),
        cutscene: null, playerMarker: this.playerMarker,
        playerName: settings.playerName, playerDominance: this.player.dominance,
      },
    });
    this.chatPanel = new ChatPanel(this.dialogue, this.cast);

    this.cameraRig.focusTargets = Object.values(this.cast).map((c) => c.actor.root);
    this.loop.resume('boot');
    feed(`${settings.playerName} entered the tower. Lockdown continues.`, 'system');
    dbg('run started');
  }

  /** Placeholder audio facade for stage-direction sfx/vox — real audio in P1.5. */
  audioFacade() {
    return {
      sfx: (id) => dbg('sfx', id),
      vox: (id) => dbg('vox', id),
    };
  }

  /** @param {any} persona @param {string} zoneId */
  spawn(persona, zoneId) {
    const actor = new Actor3D(persona);
    const [x, z] = ZONES[zoneId]?.anchor ?? [0, 0];
    actor.root.position.set(x, 0, z);
    actor.setRim(0.35);
    this.stage.scene.add(actor.root);
    const queue = new ActorQueue(actor, this.world);
    const character = new Character(persona, actor, queue);
    this.cast[persona.id] = character;
    emit('char.registered', { character });
    return character;
  }

  /** @param {number} dt ms */
  render(dt) {
    const dtSec = dt * 0.001;
    if (this.mode === 'boot' && this.bootScene) this.bootScene.update(dt);
    if (this.mode === 'run') {
      this.cameraRig.update(dtSec);
      this.lighting.update(dtSec);
      // player marker tracks the camera (where the player "is" for gaze/look)
      if (this.playerMarker) {
        this.playerMarker.position.copy(this.stage.camera.position);
        this.playerMarker.position.y = Math.min(1.7, this.playerMarker.position.y);
      }
      this.world.update(performance.now() * 0.001);
      for (const c of Object.values(this.cast)) {
        c.queue.update(dtSec);
        c.actor.update(dtSec);
      }
      this.picker.update();
    }
    this.postfx.render(dt);
  }

  /** @param {number} step fixed 100ms sim step */
  simStep(step) {
    // world tick systems arrive in P1.7
  }

  _exposeDebug() {
    // @ts-ignore
    window.__ncld = {
      ready: true,
      app: this,
      debug: {
        fps: () => this.loop.fps(),
        snapshot: () => ({ mode: this.mode, clock: this.clock.serialize() }),
        advanceMinutes: (n) => this.clock.skip(n, (c) => emit('world.minute', { clock: c })),
        goto: (id, zone, wp) => this.cast[id]?.queue.goto(zone, wp),
        sit: (id, socket) => this.cast[id]?.queue.sit(socket),
        clip: (id, clip) => this.cast[id]?.queue.playClip(clip, 0.3),
        light: (preset) => this.lighting.apply(preset),
        setStat: (id, deltas) => this.cast[id]?.applyStats(deltas, 'debug'),
        stats: (id) => this.cast[id]?.stats,
        gate: (id, tier, action) => this.cast[id]?.gate(tier, action, this.clock.totalMinutes),
        say: (text, target) => this.dialogue?.playerSays(text, target),
      },
    };
  }
}
