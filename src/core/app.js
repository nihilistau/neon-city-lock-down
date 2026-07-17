// @ts-check
// Composition root. The only module allowed to import everything and wire it up.
import '../../data/poses/base.js';
import '../../data/dialogue/intents.js';
import '../../data/dialogue/lola/fallbacks.js';
import '../../data/dialogue/lola/core.js';
import '../../data/dialogue/aria/core.js';
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
import { newRunState } from '../sim/world.js';
import { Combat } from '../sim/combat/combat.js';
import { WorldTick } from '../sim/tick.js';
import { Scheduler } from '../sim/scheduler.js';
import { EventRunner } from '../sim/eventRunner.js';
import { NewsTicker } from '../scene3d/monitors.js';
import { audio } from '../audio/engine.js';
import { Conductor } from '../audio/music/conductor.js';
import { Ambience } from '../audio/sfx/ambience.js';
import { VoxVoice } from '../audio/voxVoice.js';
import { Voice } from '../audio/voice.js';
import { Sidecar } from '../audio/sidecar.js';
import { playSfx } from '../audio/sfx/synthKit.js';
import { VOICE_CAST } from '../../data/voiceScript.js';
import { CutscenePlayer } from '../cutscene/player.js';
import { SaveMenu } from '../ui/saveMenu.js';
import { initDeathScreen } from '../ui/deathScreen.js';
import { endRun } from '../sim/death.js';
import { saveToSlot, readSlot, applySave } from './save.js';
import { SCENARIOS } from '../../data/scenarios.js';
import lola from '../../data/cast/lola.js';
import aria from '../../data/cast/aria.js';
import { Brain } from '../sim/ai/brain.js';
import { Wardrobe } from '../chars/wardrobe.js';
import { startPairedPose } from '../humanoid/pairedPoses.js';
import { ZONES } from '../../data/zones.js';
import { zoneAt } from '../sim/actors/nav.js';

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
    audio.unlock();                 // the gate click is our autoplay gesture
    emit('game.entered', {});
    await this.startRun();
  }

  /** Load the baked-voice manifest (missing = fine, router falls through). */
  async _loadVoiceManifest() {
    try {
      const res = await fetch('/assets/voice/manifest.json', { cache: 'no-store' });
      return res.ok ? await res.json() : {};
    } catch { return {}; }
  }

  /** Build the world and begin a run (slice: straight into the penthouse). */
  async startRun() {
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

    // run state + world simulation
    this.run = newRunState(this.rng.baseSeed);
    this.scheduler = new Scheduler(this.rng.stream('events'));
    this.eventRunner = new EventRunner({
      run: () => this.run,
      cast: () => this.cast,
      lighting: this.lighting,
      audioFacade: () => this.audioFacade(),
      nowMinute: () => this.clock.totalMinutes,
      combat: () => this.combat,
    });
    this.worldTick = new WorldTick({
      run: () => this.run,
      livingCast: () => Object.values(this.cast).filter((c) => c.alive),
      scheduler: this.scheduler,
      events: this.eventRunner,
      rng: this.rng.stream('world_tick'),
    });
    on('world.minute', ({ clock }) => { if (this.mode === 'run') this.worldTick.minute(clock); });
    // threat feeds music tension + ambience riot loudness (throttled)
    on('threat.changed', ({ threat }) => {
      this._threatT = (this._threatT || 0) + 1;
      if (this._threatT % 20 === 0) {
        this.conductor.setMood({ tension: Math.min(1, threat / 90) });
        this.ambience.setThreat(threat / 100);
      }
    });
    // blackout visuals
    on('power.changed', ({ online }) => {
      this.lighting.apply(online ? 'neon_night' : 'blackout_emergency', online ? 2.5 : 0.8);
    });

    // news ticker screen above the bar shelves
    this.newsTicker = new NewsTicker(this.stage.scene, this.rng.stream('news'), {
      position: [4.2, 2.55, -5.55], width: 3.6,
    });

    // audio systems
    this.conductor = new Conductor(audio, this.rng.stream('music'));
    this.ambience = new Ambience(audio);
    this.vox = new VoxVoice(audio);
    this.conductor.setMood({ tension: 0.25, warmth: 0.45, energy: 0.3 });
    this.conductor.start();
    this.ambience.play('apartment');
    this._ambienceZone = 'apartment';
    setTimeout(() => {
      this.vox.say('Good evening. Lockdown protocol remains in effect. The tower is sealed. Do enjoy your stay.');
      feed('VOX: Lockdown protocol remains in effect.', 'system');
    }, 3500);

    // interactive props
    for (const prop of this.world.props) {
      this.picker.register({
        ...prop,
        onInteract: () => {
          feed(`${settings.playerName} used ${prop.id}.`, 'info');
          playSfx(audio, prop.id === 'vinyl' ? 'ui_confirm' : 'ui_click');
          if (prop.id === 'vinyl') {
            this._vinylHot = !this._vinylHot;
            this.conductor.setMood(this._vinylHot
              ? { energy: 0.65, warmth: 0.6 }
              : { energy: 0.3, warmth: 0.45 });
          }
          emit('prop.used', { id: prop.id });
        },
      });
    }

    // spawn the cast
    this.spawn(lola, 'lounge');
    this.cast.lola.actor.faceYaw(Math.PI);
    this.spawn(aria, 'bar');
    this.cast.aria.actor.faceYaw(-Math.PI / 2);

    // wardrobes (outfit layers over the base body)
    this.cast.lola.wardrobe = new Wardrobe(this.cast.lola, 'evening_wear');
    this.cast.aria.wardrobe = new Wardrobe(this.cast.aria, 'casual_lounge');

    // autonomous brains
    /** @type {Record<string, Brain>} */
    this.brains = {};
    for (const c of Object.values(this.cast)) {
      this.brains[c.id] = new Brain(c, {
        rng: this.rng.stream(`brain_${c.id}`),
        others: (self) => Object.values(this.cast).filter((x) => x !== self && x.alive),
        threat: () => this.run.threat,
        sfx: (id) => playSfx(audio, id),
        combatActive: () => this.combat?.active ?? false,
      });
    }
    on('world.minute', ({ clock }) => {
      if (this.mode !== 'run') return;
      for (const b of Object.values(this.brains)) b.tick(clock.totalMinutes, 1);
    });
    // dialogue engagement suspends wandering
    on('chat.reply', ({ speaker }) => {
      this.brains[speaker]?.engage(this.clock.totalMinutes + 3);
    });
    // paired poses hold both participants' brains
    on('pose.paired', ({ a, b, holdMinutes }) => {
      this.brains[a]?.engage(this.clock.totalMinutes + holdMinutes);
      this.brains[b]?.engage(this.clock.totalMinutes + holdMinutes);
    });
    on('chat.player', () => {
      // addressing the room keeps everyone present a moment
      for (const b of Object.values(this.brains)) b.engage(this.clock.totalMinutes + 1);
    });

    // player presence marker — a look target the cast tracks (follows camera)
    this.playerMarker = new THREE.Object3D();
    this.playerMarker.position.set(-2, 1.5, 2);
    this.stage.scene.add(this.playerMarker);
    this.player = { name: settings.playerName, dominance: 55 };

    // combat controller (needs picker + playerMarker)
    this.combat = new Combat({
      stage: this.stage,
      run: () => this.run,
      cast: () => this.cast,
      playerMarker: this.playerMarker,
      rng: this.rng.stream('combat'),
      sfx: (id) => playSfx(audio, id),
      picker: this.picker,
      nowMinute: () => this.clock.totalMinutes,
    });

    // voice: baked manifest + optional live sidecar
    const manifest = await this._loadVoiceManifest();
    this.voiceBank = new Voice(manifest);
    this.sidecar = new Sidecar();
    this.sidecar.probe().then((up) => { if (up) dbg('TTS sidecar online'); });

    // dialogue engine + chat UI
    this.tts = new TtsRouter({
      voice: this.voiceBank, sidecar: this.sidecar, vox: this.vox, voiceCast: VOICE_CAST,
    });
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

    // cutscenes, saves, death
    this.cutscene = new CutscenePlayer({
      stage: this.stage, cameraRig: this.cameraRig, loop: this.loop,
      cast: this.cast, voiceBank: this.voiceBank, vox: this.vox, lighting: this.lighting,
    });
    this.saveMenu = new SaveMenu(this);
    initDeathScreen();
    on('player.health', ({ health }) => {
      if (health <= 0 && this.mode === 'run') {
        this.mode = 'dead';
        this.loop.pause('death');
        endRun(this, 'combat');
      }
    });
    // starvation/dehydration deaths ride the hourly survival tick
    on('world.minute', ({ clock }) => {
      if (this.mode === 'run' && this.run.player.health <= 0) {
        this.mode = 'dead';
        this.loop.pause('death');
        endRun(this, this.run.player.thirst > 74 ? 'dehydration' : 'starvation');
      }
      // hourly autosave (skip during combat/events/cutscenes)
      if (this.mode === 'run' && clock.minuteOfDay % 60 === 0
          && !this.combat.active && !this.run.activeEventId && !this.cutscene.playing) {
        saveToSlot(this, 'auto');
      }
    });

    this.loop.resume('boot');
    emit('resources.changed', this.run.resources);
    feed(`${settings.playerName} entered the tower. Lockdown continues.`, 'system');

    // scenario: mood shifts + opening cutscene (fresh runs only)
    const scenario = SCENARIOS.first_night;
    this.scenarioId = scenario.id;
    const resumed = this._tryResume();
    if (!resumed) {
      for (const [id, deltas] of Object.entries(scenario.castMoodShifts || {})) {
        this.cast[id]?.applyStats(deltas, 'scenario');
      }
      if (scenario.openingCutscene) {
        // slight delay so the first frame settles before the camera takes over
        setTimeout(() => this.cutscene.play(scenario.openingCutscene), 600);
      }
    }
    dbg('run started');
  }

  /** Offer/apply autosave resume. Returns true if a save was restored. */
  _tryResume() {
    const auto = readSlot('auto');
    if (!auto) return false;
    try {
      applySave(this, auto);
      feed(`Autosave restored — ${auto.meta.label}.`, 'system');
      return true;
    } catch (err) {
      dbg('resume failed', err);
      return false;
    }
  }

  /** Audio facade handed to stage-direction dispatch + event scripts. */
  audioFacade() {
    return {
      sfx: (id) => playSfx(audio, id),
      vox: (text) => this.vox?.say(text),
      // events: prefer a baked VOX take, fall back to the procedural voice
      voxLine: async (text, bakedId) => {
        const entry = bakedId && this.voiceBank?.manifest[bakedId];
        if (entry && audio.ctx) {
          try {
            const buf = await this.voiceBank._load(bakedId, entry.file);
            const src = audio.ctx.createBufferSource();
            src.buffer = buf;
            src.connect(audio.bus('voice'));
            audio.duckStart();
            src.start();
            src.onended = () => audio.duckEnd();
            return;
          } catch { /* fall through to synth */ }
        }
        this.vox?.say(text);
      },
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
        // ambience follows the player's zone (throttled)
        this._ambT = (this._ambT || 0) + dtSec;
        if (this._ambT > 0.5) {
          this._ambT = 0;
          const z = zoneAt(this.playerMarker.position.x, this.playerMarker.position.z);
          const amb = z === 'balcony' ? 'balcony' : 'apartment';
          if (amb !== this._ambienceZone) {
            this._ambienceZone = amb;
            this.ambience.play(amb);
          }
        }
      }
      this.world.update(performance.now() * 0.001);
      this.newsTicker.update(dtSec);
      this.combat.update(dtSec);
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
        forceEvent: (id) => this.eventRunner?.fire(id),
        run: () => this.run,
        threat: () => this.run?.threat,
        pair: (poseId, a, b) => startPairedPose(poseId, this.cast[a], this.cast[b]),
        outfit: (id, outfitId) => this.cast[id]?.wardrobe?.change(outfitId),
        needs: (id) => this.brains?.[id]?.needs,
        save: (slot) => saveToSlot(this, slot ?? 1),
        load: (slot) => { const d2 = readSlot(slot ?? 1); if (d2) applySave(this, d2); return !!d2; },
        kill: () => { this.run.player.health = 0; emit('player.health', { health: 0 }); },
        playCutscene: (steps) => this.cutscene.play(steps || SCENARIOS.first_night.openingCutscene),
      },
    };
  }
}
