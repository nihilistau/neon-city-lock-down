// @ts-check
// Composition root. The only module allowed to import everything and wire it up.
import '../../data/poses/base.js';
import '../../data/dialogue/intents.js';
import '../../data/dialogue/lola/fallbacks.js';
import '../../data/dialogue/lola/core.js';
import '../../data/dialogue/lola/depth.js';
import '../../data/dialogue/aria/core.js';
import '../../data/dialogue/aria/depth.js';
import '../../data/dialogue/kai/core.js';
import '../../data/dialogue/vox/core.js';
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
import { DirectorPanel } from '../ui/director/panel.js';
import { GamesPanel } from '../ui/gamesPanel.js';
import { BedGame } from '../games/bedGame.js';
import { TruthOrDare } from '../games/truthOrDare.js';
import { Gambits } from '../games/gambits.js';
import { Mystery } from '../games/mystery.js';
import { SaveMenu } from '../ui/saveMenu.js';
import { initDeathScreen } from '../ui/deathScreen.js';
import { endRun } from '../sim/death.js';
import { saveToSlot, readSlot, applySave } from './save.js';
import { SCENARIOS } from '../../data/scenarios.js';
import lola from '../../data/cast/lola.js';
import aria from '../../data/cast/aria.js';
import kai from '../../data/cast/kai.js';
import vox from '../../data/cast/vox.js';
import { Brain } from '../sim/ai/brain.js';
import { Relationships } from '../sim/ai/relationships.js';
import { VoxActorStub, VoxQueueStub } from '../chars/voxPresence.js';
import { Wardrobe } from '../chars/wardrobe.js';
import { startPairedPose } from '../humanoid/pairedPoses.js';
import { ZONES, FLOORS } from '../../data/zones.js';
import { zoneAt } from '../sim/actors/nav.js';
import { ElevatorUI } from '../ui/elevator.js';
import { Codex } from '../ui/codex.js';
import { Inventory } from '../sim/inventory.js';
import { InventoryUI } from '../ui/inventory.js';
import { addCodex } from '../sim/meta.js';

/** run fn after N game-minutes (survives speed changes; dies with the page) */
function setTimeoutGameSafe(app, minutes, fn) {
  const target = app.clock.totalMinutes + minutes;
  const off = on('world.minute', () => {
    if (app.clock.totalMinutes >= target) { off(); fn(); }
  });
}

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

  /**
   * Build the world and begin a run.
   * @param {{scenarioId?:string, loadout?:string, resume?:boolean}} [opts]
   */
  async startRun(opts = {}) {
    this._startOpts = opts;
    this.bootScene.dispose();
    this.bootScene = null;
    this.mode = 'run';

    this.world = new World3D(this.stage, this.rng.stream('world'));
    this.lighting = new Lighting(this.stage);
    this.lighting.clock = this.clock;
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
      cutscene: () => this.cutscene,
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
      if (this._threatT % 20 === 0 && !this.combat.active && !this.bedGame?.active) {
        this.conductor.setMood({ tension: Math.min(1, threat / 90) });
        this.ambience.setThreat(threat / 100);
      }
    });
    // music matrix: combat and intimacy override the baseline mood
    on('combat.started', () => this.conductor.setMood({ tension: 1, energy: 0.85, intimacy: 0, warmth: 0.1 }));
    on('combat.resolved', () => this.conductor.setMood({ tension: Math.min(1, this.run.threat / 90), energy: 0.35, warmth: 0.45 }));
    on('bedgame.started', () => this.conductor.setMood({ intimacy: 0.8, warmth: 0.7, energy: 0.28, tension: 0.05 }));
    on('bedgame.ended', () => this.conductor.setMood({ intimacy: 0, warmth: 0.45, energy: 0.3, tension: Math.min(1, this.run.threat / 90) }));
    // blackout visuals + consequences
    on('power.changed', ({ online }) => {
      this.lighting.apply(online ? 'neon_night' : 'blackout_emergency', online ? 2.5 : 0.8);
      if (!online) this.run.flags.powerDownSince = this.clock.totalMinutes;
      else this.run.flags.powerDownSince = null;
    });
    // the fish don't survive long blackouts (their pump dies)
    on('world.minute', () => {
      if (this.run.flags.powerDownSince != null && !this.run.flags.fishDead
          && this.clock.totalMinutes - this.run.flags.powerDownSince > 90) {
        this.run.flags.fishDead = true;
        for (const o of this.world.animated) if (o.name.startsWith('fish_')) o.userData.dead = true;
        feed('The fish tank pump has been silent too long.', 'system');
      }
    });
    // day-3 balcony beat at dusk
    on('day.started', ({ day }) => {
      if (day === 3 && !this.run.flags.day3Queued) {
        this.run.flags.day3Queued = true;
        const minutesToDusk = Math.max(5, 18.5 * 60 - this.clock.minuteOfDay);
        setTimeoutGameSafe(this, minutesToDusk, async () => {
          if (this.mode !== 'run' || this.combat.active || this.cutscene.playing) return;
          const { DAY3_CUTSCENE } = await import('../../data/cutscenes/day3.js');
          this.cutscene.play(DAY3_CUTSCENE);
        });
      }
    });
    // the endgame: extraction offer lands on day 7 at dusk
    on('day.started', ({ day }) => {
      if (day >= 7 && !this.run.flags.extractionQueued) {
        this.run.flags.extractionQueued = true;
        this.run.eventQueue.push({
          atMinute: this.clock.totalMinutes + (19 * 60 - this.clock.minuteOfDay),
          eventId: 'extraction_offer',
        });
        feed('Something is changing in the city\'s rhythm. The end of the lockdown is close.', 'system');
      }
    });
    // taking the shuttle ends the run — victorious
    on('run.extraction', () => {
      if (this.mode !== 'run') return;
      this.mode = 'dead';
      this.loop.pause('death');
      endRun(this, 'extracted');
    });

    // news ticker screen above the bar shelves (penthouse group so it hides with the floor)
    this.newsTicker = new NewsTicker(this.world.floorGroups.penthouse, this.rng.stream('news'), {
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

    // interactive props + easter eggs
    this.elevatorUI = new ElevatorUI(this);
    for (const prop of this.world.props) {
      this.picker.register({
        ...prop,
        onInteract: () => this._useProp(prop),
      });
    }

    // spawn the cast
    this.spawn(lola, 'lounge');
    this.cast.lola.actor.faceYaw(Math.PI);
    this.spawn(aria, 'bar');
    this.cast.aria.actor.faceYaw(-Math.PI / 2);
    this.spawn(kai, 'fireplace');
    this.cast.kai.actor.faceYaw(0.5);
    this.spawnVox();

    // wardrobes (outfit layers over the base body)
    this.cast.lola.wardrobe = new Wardrobe(this.cast.lola, 'evening_wear');
    this.cast.aria.wardrobe = new Wardrobe(this.cast.aria, 'casual_lounge');

    // autonomous brains (bodied cast only — VOX is omnipresent, no wandering)
    /** @type {Record<string, Brain>} */
    this.brains = {};
    for (const c of Object.values(this.cast)) {
      if (c.id === 'vox') continue;
      this.brains[c.id] = new Brain(c, {
        rng: this.rng.stream(`brain_${c.id}`),
        others: (self) => Object.values(this.cast).filter((x) => x !== self && x.alive && x.id !== 'vox'),
        threat: () => this.run.threat,
        sfx: (id) => playSfx(audio, id),
        combatActive: () => this.combat?.active ?? false,
      });
    }
    this.relationships = new Relationships({
      cast: () => this.cast, brains: this.brains,
      rng: this.rng.stream('relationships'), nowMinute: () => this.clock.totalMinutes,
    });
    on('world.minute', ({ clock }) => {
      if (this.mode !== 'run') return;
      for (const [id, b] of Object.entries(this.brains)) {
        if (this.cast[id]?.present) b.tick(clock.totalMinutes, 1);
      }
      this.relationships.tick();
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

    // player inventory + items UI
    this.inventory = new Inventory(this);
    this.inventoryUI = new InventoryUI(this);

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
      equipped: () => this.inventory.equippedWeapon(),
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

    // games
    this.bedGame = new BedGame({
      cast: () => this.cast, explicitness: () => settings.explicitness,
      nowMinute: () => this.clock.totalMinutes, rng: this.rng.stream('bedgame'),
      sfx: (id) => playSfx(audio, id),
    });
    this.truthOrDare = new TruthOrDare({
      players: () => Object.values(this.cast).filter((c) => c.id !== 'vox' && c.alive),
      explicitness: () => settings.explicitness, nowMinute: () => this.clock.totalMinutes,
      playerName: settings.playerName, rng: this.rng.stream('tod'),
    });
    this.gambits = new Gambits({ rng: this.rng.stream('gambits'), playerSkill: 65 });
    this.mystery = new Mystery({ cast: () => this.cast });
    this.gamesPanel = new GamesPanel(this);

    this.directorPanel = new DirectorPanel(this);

    this.cameraRig.focusTargets = Object.values(this.cast).map((c) => c.actor.root);

    // cutscenes, saves, death
    this.cutscene = new CutscenePlayer({
      stage: this.stage, cameraRig: this.cameraRig, loop: this.loop,
      cast: this.cast, voiceBank: this.voiceBank, vox: this.vox, lighting: this.lighting,
    });
    this.saveMenu = new SaveMenu(this);
    this.codex = new Codex(this);
    initDeathScreen();
    this._initKonami();
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

    // scenario + loadout (fresh runs only); resume restores everything from autosave
    const scenario = SCENARIOS[this._startOpts.scenarioId] || SCENARIOS.first_night;
    this.scenarioId = scenario.id;
    const resumed = this._startOpts.resume !== false && this._tryResume();
    if (!resumed) {
      this.inventory.applyLoadout(this._startOpts.loadout || 'fixer');
      if (scenario.lighting) this.lighting.apply(scenario.lighting, 0.5);
      for (const [id, deltas] of Object.entries(scenario.castMoodShifts || {})) {
        this.cast[id]?.applyStats(deltas, 'scenario');
      }
      for (const [id, [zone, wp]] of Object.entries(scenario.placements || {})) {
        const c = this.cast[id];
        if (c && c.id !== 'vox') { c.queue.clear(); c.queue.goto(zone, wp); }
      }
      if (scenario.openingCutscene) {
        setTimeout(() => this.cutscene.play(scenario.openingCutscene), 600);
      }
    }
    dbg('run started', scenario.id);
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

  /** transient toast for game feedback */
  toast(text) {
    emit('hud.alert', { text, kind: 'info' });
  }

  /** director activity suggestions */
  directorAction(act) {
    if (act === 'drink') {
      playSfx(audio, 'pour_drink');
      for (const c of Object.values(this.cast)) if (c.id !== 'vox') c.applyStats({ sobriety: -8, openness: 3, tension: -3 }, 'drinks');
      feed('Drinks all around. The room loosens.', 'info');
    } else if (act === 'dance') {
      this._vinylHot = true;
      this.conductor.setMood({ energy: 0.7, warmth: 0.55 });
      feed('Music fills the penthouse.', 'info');
    } else if (act === 'gather') {
      for (const id of ['aria', 'kai']) this.cast[id]?.queue.goto('lounge', 'center');
      feed('You call everyone to the lounge.', 'info');
    }
  }

  /** Prop interactions + easter eggs. One-shot loot is tracked per run. */
  _useProp(prop) {
    emit('prop.used', { id: prop.id });
    // feed mystery clue discovery (propId + current player zone)
    const pz = zoneAt(this.playerMarker.position.x, this.playerMarker.position.z);
    this.mystery?.onProp(prop.id, pz);
    const looted = (this.run.flags.looted ||= {});
    const gainRes = (key, n, msg) => {
      if (looted[prop.id]) { emit('hud.alert', { text: 'Already emptied.', kind: 'warn' }); return; }
      looted[prop.id] = true;
      this.run.resources[key] = (this.run.resources[key] || 0) + n;
      emit('resources.changed', this.run.resources);
      emit('hud.alert', { text: msg, kind: 'info' });
      feed(msg, 'info');
      playSfx(audio, 'ui_confirm');
    };

    switch (true) {
      case prop.id.startsWith('elevator_'):
        this.elevatorUI.openPicker();
        break;
      case prop.id === 'vinyl':
        this._vinylHot = !this._vinylHot;
        playSfx(audio, 'ui_confirm');
        this.conductor.setMood(this._vinylHot
          ? { energy: 0.65, warmth: 0.6 } : { energy: 0.3, warmth: 0.45 });
        feed(this._vinylHot ? 'The vinyl deck spins up.' : 'The music settles down.', 'info');
        break;
      case prop.id === 'synth': {
        // pentatonic riff — each press advances the phrase
        const scaleNotes = [220, 261.6, 293.7, 329.6, 392, 440, 523.2];
        this._synthStep = ((this._synthStep ?? -1) + 1) % scaleNotes.length;
        const ctx = audio.ctx;
        if (ctx) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'square'; o.frequency.value = scaleNotes[this._synthStep];
          g.gain.setValueAtTime(0.08, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
          o.connect(g); g.connect(audio.bus('ui'));
          o.start(); o.stop(ctx.currentTime + 0.55);
        }
        if (this._synthStep === scaleNotes.length - 1) {
          addCodex('synth_riff', 'The Penthouse Synth', 'Someone left a synth loaded with a seven-note riff.');
          this.cast.aria?.applyStats({ happiness: 3 }, 'music');
        }
        break;
      }
      case prop.id === 'fish_tank': {
        feed('The fish drift in their neon water, oblivious to the apocalypse.', 'info');
        emit('hud.alert', { text: this.run.flags.fishDead ? 'The fish float belly-up. Grim.' : 'The fish are okay. Something is okay.', kind: 'info' });
        if (!this.run.flags.fishDead) this.run.player.morale = Math.min(100, this.run.player.morale + 2);
        break;
      }
      case prop.id === 'fireplace':
        playSfx(audio, 'ui_confirm');
        this.lighting.apply(this.lighting.presetId === 'fireplace_warm' ? 'neon_night' : 'fireplace_warm', 2);
        feed('The fire settles into a slow burn.', 'info');
        break;
      case prop.id.startsWith('curtain_'): {
        const which = prop.id.slice(8);
        const nowOpen = this.world.curtains.toggle(which);
        playSfx(audio, 'door_servo');
        this.run.flags.curtainsClosed = this.world.curtains.anyClosed;
        feed(nowOpen ? `You draw the ${which} curtains open — the burning city floods back in.`
                     : `You draw the ${which} curtains shut. The velvet swallows the sirens.`, 'info');
        if (!nowOpen) {
          // curtains closed: cozier, calmer, and safer from curfew sweeps
          this.ambience.setThreat(Math.max(0, (this.run.threat - 25) / 100));
          for (const c of Object.values(this.cast)) if (c.id !== 'vox') c.applyStats({ tension: -3, fear: -2, happiness: 2 }, 'curtains');
        } else {
          this.ambience.setThreat(this.run.threat / 100);
        }
        break;
      }
      case prop.id === 'telescope': {
        const cam = this.stage.camera;
        const prevFov = cam.fov;
        cam.fov = 16; cam.updateProjectionMatrix();
        emit('hud.alert', { text: 'Through the lens: barricades, smoke, a city eating itself.', kind: 'warn' });
        addCodex('telescope_view', 'Through the Telescope', 'From the 45th floor you can watch the barricade lines move like a slow tide.');
        setTimeout(() => { cam.fov = prevFov; cam.updateProjectionMatrix(); }, 4000);
        break;
      }
      case prop.id === 'vox_terminal': {
        // repairs first: any damaged systems can be fixed here (parts + time)
        const damaged = Object.entries(this.run.systems)
          .filter(([, s]) => s.hp < 70 || !s.online);
        if (damaged.length && this.run.resources.parts >= 1) {
          emit('event.choice', {
            prompt: `VOX diagnostics list damaged systems. Repairs cost 1 part + 45 minutes each. Parts: ${Math.floor(this.run.resources.parts)}.`,
            options: [...damaged.map(([name, s]) => `Repair ${name} (${Math.round(s.hp)}%)`), 'Not now'],
            pick: (idx) => {
              if (idx >= damaged.length) return;
              const [name, sys] = damaged[idx];
              this.run.resources.parts -= 1;
              this.clock.skip(45, (c) => this.worldTick.minute(c));
              sys.hp = Math.min(100, sys.hp + 60);
              sys.online = true;
              if (name === 'power') emit('power.changed', { online: true });
              emit('systems.changed', this.run.systems);
              emit('resources.changed', this.run.resources);
              this.vox.say(`${name} restored. The tower thanks you. I thank you. We are the same thing, but the sentiment doubles.`);
              feed(`Repaired ${name}.`, 'system');
            },
          });
          break;
        }
        const lines = [
          'Diagnostics: hull integrity acceptable. Morale integrity: declining.',
          'I have counted the rioters. You do not want the number.',
          'My cameras miss nothing. Except floor thirteen. There is no floor thirteen.',
          'Query logged. Curiosity noted. Approval pending.',
        ];
        this.vox.say(this.rng.stream('vox_lines').pick(lines));
        addCodex('vox_terminal', 'The VOX Terminal', 'The tower AI answers direct queries. Some answers feel like warnings.');
        break;
      }
      case prop.id === 'gurney0' || prop.id === 'gurney1': {
        const injured = Object.values(this.cast).filter((c) => c.injuries?.length);
        const playerHurt = this.run.player.health < 90;
        if (!injured.length && !playerHurt) {
          emit('hud.alert', { text: 'No one needs treatment right now.', kind: 'info' });
          break;
        }
        if (this.run.resources.meds < 1) {
          emit('hud.alert', { text: 'No meds left to treat with.', kind: 'danger' });
          break;
        }
        this.run.resources.meds -= 1;
        for (const c of injured) {
          c.injuries = [];
          c.applyStats({ energy: 15, fear: -5, trust: 3 }, 'treated');
        }
        this.run.player.health = Math.min(100, this.run.player.health + 30);
        emit('player.health', { health: this.run.player.health });
        emit('resources.changed', this.run.resources);
        playSfx(audio, 'ui_confirm');
        feed('Wounds cleaned, dressed, and quietly appreciated. (-1 med)', 'system');
        break;
      }
      case prop.id === 'vox_monolith': {
        for (const o of this.world.animated) {
          if (o.name.startsWith('vox_ring_')) { o.userData.excite = 1.6; setTimeout(() => o.userData.excite = 0, 3000); }
        }
        this.vox.say('Physical contact registered. That is... unusual. Thank you.');
        this.cast.vox; // (VOX joins the cast in Phase 3)
        break;
      }
      case prop.id === 'med_cabinet':
        if (looted[prop.id]) { emit('hud.alert', { text: 'Already emptied.', kind: 'warn' }); break; }
        looted[prop.id] = true;
        gainRes('meds', 3, 'You find 3 med units and a field kit.');
        this.inventory.add('medkit', 1);
        break;
      case prop.id === 'weapon_rack':
        if (looted[prop.id]) { emit('hud.alert', { text: 'The racks are stripped.', kind: 'warn' }); break; }
        looted[prop.id] = true;
        this.run.resources.ammo += 24;
        emit('resources.changed', this.run.resources);
        this.inventory.add('smg', 1);
        this.inventory.add('sidearm', 1);
        emit('hud.alert', { text: 'You arm up: an SMG, a sidearm, and 24 rounds.', kind: 'info' });
        playSfx(audio, 'ui_confirm');
        break;
      case prop.id === 'ammo_crate': gainRes('ammo', 18, 'The crate holds 18 rounds.'); break;
      case prop.id === 'supply_crate':
        if (looted[prop.id]) { emit('hud.alert', { text: 'Already emptied.', kind: 'warn' }); break; }
        looted[prop.id] = true;
        this.run.resources.parts += 3; emit('resources.changed', this.run.resources);
        this.inventory.add('stim', 2);
        emit('hud.alert', { text: 'Salvage: 3 parts and 2 combat stims.', kind: 'info' });
        break;
      case prop.id === 'roof_crate':
        if (looted[prop.id]) { emit('hud.alert', { text: 'Already emptied.', kind: 'warn' }); break; }
        looted[prop.id] = true;
        this.run.resources.food += 5; emit('resources.changed', this.run.resources);
        this.inventory.add('ration', 3);
        emit('hud.alert', { text: 'A survival cache — 5 meals and 3 ration bars.', kind: 'info' });
        break;
      case prop.id === 'stash_crate':
        if (looted[prop.id]) { emit('hud.alert', { text: 'The stash is empty now.', kind: 'warn' }); break; }
        looted[prop.id] = true;
        this.run.resources.luxury += 4; emit('resources.changed', this.run.resources);
        this.inventory.add('jammer', 1);
        this.inventory.add('jewels', 3);
        emit('hud.alert', { text: 'A smuggler stash — whiskey, a signal jammer, loose stones.', kind: 'info' });
        addCodex('stash', 'The Basement Stash', 'Someone was smuggling contraband through the carpark. They never came back for it.');
        break;
      default:
        feed(`${settings.playerName} used ${prop.id}.`, 'info');
        playSfx(audio, 'ui_click');
    }
  }

  /** Konami code on the keyboard → maintenance-shaft lore stash easter egg. */
  _initKonami() {
    const seq = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
    let idx = 0;
    document.addEventListener('keydown', (e) => {
      if (this.mode !== 'run') return;
      idx = e.code === seq[idx] ? idx + 1 : (e.code === seq[0] ? 1 : 0);
      if (idx === seq.length) {
        idx = 0;
        if (this.run.flags.konami) { emit('hud.alert', { text: 'The shaft is already open.', kind: 'info' }); return; }
        this.run.flags.konami = true;
        this.run.resources.luxury += 6;
        this.run.resources.parts += 3;
        emit('resources.changed', this.run.resources);
        emit('hud.alert', { text: 'A maintenance panel clicks open — a previous tenant\'s stash.', kind: 'info' });
        this.vox.say('Oh. THAT panel. I wondered who\'d remember the old service code. Well done, ghost.');
        addCodex('konami_shaft', 'The Maintenance Shaft', 'An old service code opens a panel the building forgot it had — someone lived in the walls once, and left supplies behind.');
      }
    });
  }

  /** floor → ambience bed */
  setAmbienceForFloor(floorId) {
    const map = {
      penthouse: 'apartment', rooftop: 'balcony', fl40: 'server', fl27: 'server',
      fl12: 'medical', ground: 'lobby', basement: 'carpark',
    };
    this.ambience.play(map[floorId] || 'apartment');
    this._ambienceZone = map[floorId] || 'apartment';
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

  /** Send an NPC away (they leave the room/tower). Reversible. VOX can't leave. */
  despawnCharacter(id) {
    const c = this.cast[id];
    if (!c || id === 'vox' || !c.present) return false;
    c.present = false;
    c.queue.clear();
    if (c.actor.root) c.actor.root.visible = false;
    emit('char.removed', { id });
    feed(`${c.name} has left.`, 'system');
    return true;
  }

  /** Bring an NPC back into the game. */
  respawnCharacter(id) {
    const c = this.cast[id];
    if (!c || c.present) return false;
    c.present = true;
    if (c.actor.root) {
      c.actor.root.visible = true;
      const [x, z] = ZONES[c.queue.zone]?.anchor ?? [0, 0];
      c.actor.snapTo?.(x, z);
    }
    emit('char.registered', { character: c });
    feed(`${c.name} returns.`, 'system');
    return true;
  }

  /** VOX is bodiless — the tower itself. Uses duck-typed actor/queue stubs. */
  spawnVox() {
    const actor = new VoxActorStub(vox);
    const queue = new VoxQueueStub();
    const character = new Character(vox, actor, queue);
    this.cast.vox = character;
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
        // penthouse only: swap apartment/balcony beds as the player crosses the glass
        this._ambT = (this._ambT || 0) + dtSec;
        if (this._ambT > 0.5 && this.world.activeFloor === 'penthouse') {
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
        floor: (id) => this.elevatorUI.ride(id),
      },
    };
  }
}
