// @ts-check
// Composition root. The only module allowed to import everything and wire it up.
import '../../data/poses/base.js';
import '../../data/poses/combat.js';
import '../../data/dialogue/intents.js';
import '../../data/dialogue/lola/fallbacks.js';
import '../../data/dialogue/lola/core.js';
import '../../data/dialogue/lola/depth.js';
import '../../data/dialogue/aria/core.js';
import '../../data/dialogue/aria/depth.js';
import '../../data/dialogue/kai/core.js';
import '../../data/dialogue/kai/depth.js';
import '../../data/dialogue/vox/core.js';
import '../../data/dialogue/vox/depth.js';
import '../../data/dialogue/games.js';
import '../../data/dialogue/bed.js';
import * as THREE from 'three';
import { GameClock } from './clock.js';
import { Loop } from './loop.js';
import { Rng } from './rng.js';
import { settings } from './settings.js';
import { setDebugLogging, dbg, feed } from './log.js';
import { emit, on } from './bus.js';
import { Stage } from '../scene3d/stage.js';
import { createAssets } from '../assets/assets.js';
import { browserLoaders } from '../assets/loaders.js';
import { CombatFx } from '../scene3d/combatFx.js';
import { PostFX } from '../scene3d/postfx.js';
import { BootScene } from '../scene3d/bootScene.js';
import { Lighting } from '../scene3d/lighting.js';
import { World3D } from '../scene3d/tower/zoneBuilder.js';
import { Picker } from '../scene3d/picking.js';
import { rimPool } from '../scene3d/rimPool.js';
import { CameraRig } from '../camera/cameraRig.js';
import { Actor3D } from '../humanoid/actor3d.js';
import { buildPlayerPersona } from '../../data/cast/player.js';
import { buildWeapon } from '../humanoid/weaponModel.js';
import { ActorQueue } from '../sim/actors/actorQueue.js';
import { Character } from '../chars/character.js';
import { DialogueEngine } from '../dialogue/engine.js';
import { TtsRouter } from '../dialogue/ttsRouter.js';
import { LLMAdapter } from '../dialogue/llmAdapter.js';
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
import { Gambits } from '../games/gambits.js';
import { Mystery } from '../games/mystery.js';
import { Cards } from '../games/cards.js';
import { SaveMenu } from '../ui/saveMenu.js';
import { initDeathScreen } from '../ui/deathScreen.js';
import { endRun } from '../sim/death.js';
import { saveToSlot, readSlot, applySave, deleteAutosave } from './save.js';
import { SCENARIOS } from '../../data/scenarios.js';
import lola from '../../data/cast/lola.js';
import aria from '../../data/cast/aria.js';
import kai from '../../data/cast/kai.js';
import vox from '../../data/cast/vox.js';
import { Brain } from '../sim/ai/brain.js';
import { BedScene, bedPrompt } from '../sim/bedScene.js';
import { narrationFor } from '../../data/dialogue/bed.js';
import { Relationships } from '../sim/ai/relationships.js';
import { VoxActorStub, VoxQueueStub } from '../chars/voxPresence.js';
import { Wardrobe } from '../chars/wardrobe.js';
import { ZONES, FLOORS } from '../../data/zones.js';
import { MYSTERY_CASES } from '../../data/games/mysteryCases.js';
import { zoneAt, waypointPos, elevatorPos } from '../sim/actors/nav.js';
import { ElevatorUI } from '../ui/elevator.js';
import { Codex } from '../ui/codex.js';
import { Inventory } from '../sim/inventory.js';
import { InventoryUI } from '../ui/inventory.js';
import { Reticle } from '../ui/reticle.js';
import { PlanPanel } from '../ui/planPanel.js';
import { CombatHud } from '../ui/combatHud.js';
import { CharacterAgent } from '../dialogue/llm/agent.js';
import { Conversation } from '../dialogue/llm/conversation.js';
import { LLMPanel } from '../ui/llmPanel.js';
import { VoicePanel } from '../ui/voicePanel.js';
import { KitPanel } from '../ui/kitPanel.js';
import { LOADOUTS } from '../../data/items.js';
import { buildRefugee } from '../../data/cast/refugee.js';
import { registerRefugeeTopics } from '../../data/dialogue/refugee.js';
import { showMainMenu } from '../ui/mainMenu.js';
import { initModalStack } from '../ui/modalStack.js';
import { addCodex } from '../sim/meta.js';
import { applyScenario } from '../sim/scenario.js';
import { jobDest, interruptChance } from '../sim/jobs.js';
import { canAct, performAction, spendAp } from '../sim/dayPlan.js';
import { cfg } from './config.js';
import { shouldDinner, markDinner, shouldSleep, markSleep, DINNER_MINUTE, SLEEP_MINUTE } from '../sim/livingBeats.js';

/** run fn after N game-minutes (survives speed changes; dies with the page) */
function setTimeoutGameSafe(app, minutes, fn) {
  const target = app.clock.totalMinutes + minutes;
  const off = on('world.minute', () => {
    if (app.clock.totalMinutes >= target) { off(); fn(); }
  });
}

/** VOX's idle terminal chatter. Hoisted: it was rebuilt on every interaction. */
const VOX_TERMINAL_LINES = [
  'Diagnostics: hull integrity acceptable. Morale integrity: declining.',
  'I have counted the rioters. You do not want the number.',
  'My cameras miss nothing. Except floor thirteen. There is no floor thirteen.',
  'Query logged. Curiosity noted. Approval pending.',
];

export class App {
  constructor() {
    const params = new URLSearchParams(location.search);
    this.debug = params.get('debug') === '1' || settings.debug;
    setDebugLogging(this.debug);

    this.clock = new GameClock();
    this.rng = new Rng(Date.now());
    this.stage = new Stage(/** @type {HTMLCanvasElement} */(document.getElementById('gl')));

    // The asset facade. `?noassets=1` forces every loader to its procedural
    // fallback without a single request — the switch the e2e suite uses to
    // prove the game boots with no asset pipeline at all. A loader set that
    // fails to import degrades the same way: warned once, then null.
    const noAssets = params.get('noassets') === '1';
    this.assets = createAssets({
      enabled: !noAssets,
      loaders: noAssets ? null : browserLoaders(this.stage.renderer).catch((err) => {
        console.warn('[assets] loaders unavailable — procedural fallbacks only', err);
        return null;
      }),
    });
    /** settles (never rejects) once the manifest is read */
    this.assetsReady = this.assets.init();
    this.assets.setAnisotropy(Math.min(8, this.stage.renderer.capabilities.getMaxAnisotropy()));

    this.postfx = new PostFX(this.stage);
    this.bootScene = new BootScene(this.stage, this.rng.stream('boot'));

    /** @type {'boot'|'run'} */
    this.mode = 'boot';
    /** @type {Record<string, Character>} */
    this.cast = {};

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
    initModalStack();   // one panel at a time; Escape is a universal "back"
    const unlock = () => audio.unlock();
    document.addEventListener('pointerdown', unlock, { once: true });
    const choice = await showMainMenu(this);   // boot scene renders behind the menu
    audio.unlock();
    emit('game.entered', {});
    await this.startRun(choice);
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
    // False from the moment a run starts until the opening beat (scenario
    // placement + its cutscene, or a resumed save) has fully settled. Tests
    // and any other code that must not act until the opening beat is done
    // should wait on this rather than inferring it from cutscene state.
    this.scenarioSettled = false;

    // Settle the asset facade before building the world. NOTE: this.mode is
    // NOT yet 'run' here — render() dereferences this.cameraRig/this.lighting
    // /this.combatFx when mode==='run', and none of those exist until further
    // down this method. Flipping mode here (as this line historically did)
    // makes render() throw every frame during this await, invisible under
    // ?noassets=1 (resolves as a microtask) but real on a normal boot with an
    // async loader import. this.mode flips to 'run' right after this.cameraRig
    // is constructed below; render() also guards on `this.cameraRig` existing.
    await this.assetsReady;

    // beta.2 moves the resolution into the quality preset (render.quality → hdri)
    const hdri = /** @type {'off'|'1k'|'2k'} */ ('2k');
    const hdriId = cfg('render.hdri.id', 'shanghai_bund');
    this.world = await World3D.create(this.stage, this.rng.stream('world'), this.assets, {
      equirect: hdri === 'off' ? null : `${hdriId}_${hdri}`,
    });
    // combat FX (tracers/flashes/impacts) + back the previously-undefined
    // world.particles(kind, pos) hook used by stage directions.
    this.combatFx = new CombatFx(this.stage.scene);
    this.world.particles = (kind, pos) => this.combatFx.impact(pos, kind);
    this.lighting = new Lighting(this.stage, this.assets, { hdri, hdriId });
    await this.lighting.ready;   // the env is rebuilt from the HDRI before shaders compile
    rimPool.init(this.stage.scene);   // fixed light count for the whole run
    // Pay for every floor's shader variants now, behind the loading screen,
    // rather than as a stall each time an elevator door opens.
    //
    // AFTER the light kit and the rim pool, not before. precompile() exists
    // precisely because a forward renderer bakes the scene's LIGHT COUNT into
    // every material's program — so running it while the scene still had none
    // compiled ~77 programs keyed to the wrong count, all of which the first
    // real frame threw away. The stall it was written to prevent still happened,
    // and boot paid for seven extra scene compiles on top of it.
    this.world.precompile(this.stage.renderer, this.stage.camera);
    this.lighting.clock = this.clock;
    this.lighting.apply('neon_night', 0.01);

    this.cameraRig = new CameraRig(this.stage, this.world);
    this.mode = 'run';   // see the note above assetsReady — must land after cameraRig exists
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
      spawnRefugee: () => this.spawnRefugee(),
      rideFloor: (id) => this.elevatorUI?.ride(id),
    });
    this.worldTick = new WorldTick({
      run: () => this.run,
      // `present` matters as much as `alive`: survival.js counts these as the
      // mouths at the table, and someone who has left the tower is not eating
      // your food. Without this, sending a refugee back out changed nothing.
      livingCast: () => Object.values(this.cast).filter((c) => c.alive && c.present !== false),
      scheduler: this.scheduler,
      events: this.eventRunner,
      combat: () => this.combat,
      rng: this.rng.stream('world_tick'),
    });
    on('world.minute', ({ clock }) => { if (this.mode === 'run') this.worldTick.minute(clock); });
    // threat feeds music tension + ambience riot loudness (throttled)
    on('threat.changed', ({ threat }) => {
      this._threatT = (this._threatT || 0) + 1;
      if (this._threatT % 20 === 0 && !this.combat.active && !this.bedScene?.busy) {
        this.conductor.setMood({ tension: Math.min(1, threat / 90) });
        this.ambience.setThreat(threat / 100);
      }
    });
    // music matrix: combat and the stay-the-night fade override the baseline mood
    on('combat.started', () => { this.conductor.setMood({ tension: 1, energy: 0.85, closeness: 0, warmth: 0.1 }); if (this.cameraRig?.fp) this.cameraRig.fp.aiming = true; });
    on('combat.resolved', () => { this.conductor.setMood({ tension: Math.min(1, this.run.threat / 90), energy: 0.35, warmth: 0.45 }); if (this.cameraRig?.fp) this.cameraRig.fp.aiming = false; });
    // ── minigames, reachable from inside a run ────────────────────────────
    // Emitted by a topic's `effects.game` (src/dialogue/effects.js) and by
    // scenario payloads, so there is ONE place that opens a game rather than
    // one per entry point.
    on('game.requested', ({ game }) => {
      if (!this.gamesPanel || !game) return;
      if (game === 'cards') this.gamesPanel.cards();
      else if (game.startsWith('mystery:')) this.gamesPanel.mystery(game.slice(8));
    });

    // ── arrivals ──────────────────────────────────────────────────────────
    // ActorQueue has emitted `zone.entered` every time an actor crosses a zone
    // boundary since the day it was written, and NOTHING has ever subscribed —
    // not even the debug feed. So the cast moved around a tower you could not
    // perceive them moving around: they were simply elsewhere, then here.
    //
    // Two consequences, both from data that already exists. The room reports who
    // just walked in, and whoever walked in looks at you — which is the whole
    // difference between a character pathing past and a character arriving.
    on('zone.entered', ({ id, zone, from }) => {
      const c = this.cast[id];
      if (!c || !c.alive || c.persona?.corporeal === false) return;
      const here = zoneAt(this.playerMarker.position.x, this.playerMarker.position.z);
      if (!zone || zone === from) return;
      if (zone === here) {
        feed(`${c.name} comes in from the ${ZONES[from]?.name?.toLowerCase() || 'hall'}.`, 'info');
        c.actor.lookAt(this.playerMarker);
        // drop the glance after a beat — a held stare reads as a bug, not interest
        clearTimeout(this._glanceT?.[id]);
        (this._glanceT ||= {})[id] = setTimeout(() => c.actor.lookAt(null), 4000);
      } else if (from === here) {
        feed(`${c.name} heads for the ${ZONES[zone]?.name?.toLowerCase() || 'hall'}.`, 'info');
      }
    });

    // keep the hand weapon model in sync with the equipped weapon
    on('inventory.equipped', () => this._setWeaponModel());
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
          if (!this._beatPlayable()) return;   // penthouse-authored; see _beatPlayable
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
    on('run.extraction', ({ outcome } = {}) => {
      if (this.mode !== 'run') return;
      this.mode = 'dead';
      this.loop.pause('death');
      endRun(this, outcome || 'extracted');
    });
    // a named companion falling is a scene, not a feed line
    const playFallen = (name) => {
      import('../../data/cutscenes/fallen.js').then(({ fallenCutscene }) => {
        if (!this._beatPlayable()) { feed(`Word reaches you: ${name} is gone.`, 'combat'); return; }
        this.cutscene.play(fallenCutscene(name));
      });
    };
    on('char.died', ({ id, name } = {}) => {
      if (['lola', 'aria', 'kai'].includes(id) && this.run) this.run.flags.lostCast = true;
      if (!['lola', 'aria', 'kai'].includes(id) || this.mode !== 'run') return;
      if (this.combat.active || this.cutscene.playing) { this._fallenPending = name; return; }
      playFallen(name);
    });
    on('combat.resolved', () => {
      const name = this._fallenPending;
      this._fallenPending = null;
      if (name) playFallen(name);
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
      const target = { ...prop, onInteract: () => this._useProp(prop) };
      if (prop.id === 'bed') this._bedTarget = target;   // its prompt follows the bed state
      this.picker.register(target);
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
    // Kai had 10 outfit states authored in data/outfits.js and no Wardrobe, and
    // every call site is `wardrobe?.change(...)` — so each [[outfit:X]] on him
    // was a silent no-op rather than an error.
    this.cast.kai.wardrobe = new Wardrobe(this.cast.kai, 'casual_lounge');

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
        bedFree: () => this._bedFree(),
      });
    }
    this.relationships = new Relationships({
      cast: () => this.cast, brains: this.brains,
      rng: this.rng.stream('relationships'), nowMinute: () => this.clock.totalMinutes,
      speak: (c, text) => { try { this.dialogue?.forceSay(c.id, text); } catch { feed(`${c.name}: ${text}`, 'dialogue'); } },
    });
    on('world.minute', ({ clock }) => {
      if (this.mode !== 'run') return;
      for (const [id, b] of Object.entries(this.brains)) {
        if (this.cast[id]?.present) b.tick(clock.totalMinutes, 1);
      }
      this.relationships.tick();
      const m = clock.minuteOfDay;
      if (m === 8 * 60) this._castOutfitHour('casual_lounge');
      else if (m === 18 * 60 + 30) this._castOutfitHour('evening_wear');
      else if (m === 60) this._castOutfitHour('sleepwear');
    });
    // dialogue engagement suspends wandering
    on('chat.reply', ({ speaker }) => {
      this.brains[speaker]?.engage(this.clock.totalMinutes + 3);
      // and light them, because they are the one talking. rimPool holds two
      // fixed lights and evicts the weakest claim, so a combat rim (0.8) still
      // outranks a speaker (0.35) and the count never changes.
      const c = this.cast[speaker];
      if (c?.actor?.setRim) {
        c.actor.setRim(0.35);
        clearTimeout(this._rimT?.[speaker]);
        (this._rimT ||= {})[speaker] = setTimeout(() => c.actor.setRim(0), 6000);
      }
    });
    on('vox.talked', ({ topicId } = {}) => {
      if (!this.run || !topicId) return;
      const seen = this.run.flags.voxTopics || [];
      if (seen.includes(topicId)) return;
      seen.push(topicId);
      this.run.flags.voxTopics = seen;
      this.run.flags.voxTalks = seen.length;
    });
    on('chat.player', () => {
      // addressing the room keeps everyone present a moment
      for (const b of Object.values(this.brains)) b.engage(this.clock.totalMinutes + 1);
    });

    // player presence marker — a look target the cast track (follows the body)
    this.playerMarker = new THREE.Object3D();
    this.playerMarker.position.set(-2, 1.5, 2);
    this.stage.scene.add(this.playerMarker);
    this.player = { name: settings.playerName, dominance: 55 };

    // visible player avatar (third-person + first-person combat)
    this.playerActor = new Actor3D(buildPlayerPersona(settings.playerName, settings.playerPronouns, settings.appearance || {}));
    this.playerActor.root.position.set(-2, 0, 2);
    this.playerActor.root.visible = false;   // shown by the rig per camera mode
    this.stage.scene.add(this.playerActor.root);
    this.playerWardrobe = new Wardrobe({
      id: 'player',
      name: settings.playerName,
      persona: this.playerActor.persona,
      actor: this.playerActor,
    }, 'street_armor');
    this.cameraRig.fp.attachBody(this.playerActor);
    this.cameraRig.fp.onFire = () => { if (this.combat.active) this.combat.fireRay(this.stage.camera); };
    this.cameraRig.fp.onReload = () => { if (this.combat.active) this.combat.reload(); };
    // FP eye ↔ body: seed the fp position at the avatar
    this.cameraRig.fp.pos.set(-2, 1.62, 2);

    // player inventory + items UI
    this.inventory = new Inventory(this);
    this.inventoryUI = new InventoryUI(this);
    this.llmPanel = new LLMPanel(this);
    this.voicePanel = new VoicePanel(this);
    this.kitPanel = new KitPanel(this);
    this.reticle = new Reticle();
    this.planPanel = new PlanPanel(this);

    /**
     * Spend a day-plan action by riding to its floor, then applying the effect.
     * @param {string} id
     */
    this.startJob = async (id) => {
      if (!canAct(this.run, id)) return { ok: false, msg: 'Can\'t do that right now.' };
      const dest = jobDest(id);
      if (dest && dest.floor !== this.world.activeFloor) {
        emit('hud.alert', { text: `Heading to ${dest.label}…`, kind: 'info' });
        await this.elevatorUI.ride(dest.floor);
        // ride() returns silently when the car is locked, offline, or already in
        // motion. Without this check the job ran anyway — you "foraged the
        // rooftop garden" and "ran the range" from the penthouse, and the
        // interrupt roll (themed as being exposed on the roof) fired too.
        if (this.world.activeFloor !== dest.floor) {
          const msg = `You can't reach ${dest.label} right now.`;
          emit('hud.alert', { text: msg, kind: 'warn' });
          return { ok: false, msg };
        }
      }
      const rng = this.rng.stream('dayplan');
      if (interruptChance(this.run, id, rng)) {
        // Only take the AP if the interrupting event can actually run.
        // fire() is async, so its early-return when a script is already running
        // (including one stalled on waitMinutes) is invisible to the caller — the
        // AP was spent regardless and the player got no event, no choice, no food.
        if (this.eventRunner.canFire('forage_scare')) {
          spendAp(this.run, id);
          this.eventRunner.fire('forage_scare');
          const msg = 'Shots on the roof. You drop the harvest and get down.';
          emit('hud.alert', { text: msg, kind: 'warn' });
          return { ok: false, msg };
        }
        // couldn't interrupt — fall through and let the job resolve normally
      }
      const r = performAction(this.run, id, rng);
      if (r.ok) {
        // DAY_ACTIONS are pure over `run` and cannot touch the cast, so
        // refugee_release raises a flag and the actual person leaves here.
        // Decrementing the counter alone removed no mouth (survival.js counts
        // BODIES), left them standing in reception, and made the next arrival
        // collide with them and silently no-op.
        if (this.run.flags.releaseRefugee) {
          this.run.flags.releaseRefugee = false;
          const gone = Object.values(this.cast)
            .filter((c) => c.present !== false && /^refugee/.test(c.id))
            .pop();
          if (gone) this.despawnCharacter(gone.id);
        }
        emit('hud.alert', { text: r.msg, kind: 'info' });
        emit('resources.changed', this.run.resources);
        emit('systems.changed', this.run.systems);
        emit('threat.changed', { threat: this.run.threat });
        emit('player.health', { health: this.run.player.health });
      }
      return r;
    };

    this._castOutfitHour = (outfitId) => {
      for (const c of Object.values(this.cast)) {
        if (!c.alive || c.id === 'vox') continue;
        c.wardrobe?.change(outfitId);
      }
    };

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
      colliders: () => this.world.colliders,
      defences: () => this.world.defences,
      walkable: (x, z) => {
        const rects = this.world.walkRects?.[this.world.activeFloor];
        if (!rects?.length) return true;
        return rects.some((r) => x >= r.x[0] + 0.3 && x <= r.x[1] - 0.3 &&
                                 z >= r.z[0] + 0.3 && z <= r.z[1] - 0.3);
      },
      giveItem: (id, qty) => this.inventory.add(id, qty),
      fx: this.combatFx,
      playerSkill: () => this.run.player.skill ?? 70,
      floorOffset: () => this.world.floorGroups[this.world.activeFloor]?.position.x ?? 0,
      playerCrouch: () => !!this.cameraRig?.fp?.crouching,
      muzzle: () => {
        if (!this._weaponMesh) return null;
        const v = new THREE.Vector3();
        this._weaponMesh.getWorldPosition(v);
        return v;
      },
    });
    this.combatHud = new CombatHud(this);
    // combat camera magnetism: soft continuous pull toward whichever hostile the aim is near
    this.cameraRig.fp.aimTarget = () => this._hostileAimPoints();

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
    this.agent = new CharacterAgent();
    this.convo = new Conversation();
    // apply any saved model choices to the engine
    if (settings.llm?.chatModel || settings.llm?.functionModel) {
      this.agent.engine.setConfig({
        chatModel: settings.llm.chatModel || undefined,
        functionModel: settings.llm.functionModel || undefined,
      });
    }
    this.dialogue = new DialogueEngine({
      cast: this.cast,
      nowMinute: () => this.clock.totalMinutes,
      day: () => this.clock.day,
      rng: this.rng.stream('dialogue'),
      vocab: { chars: ['lola', 'aria', 'kai'], zones: Object.keys(ZONES), items: ['whiskey', 'gun', 'food', 'water'] },
      llm: this.llm,
      agent: this.agent,
      convo: this.convo,
      tts: this.tts,
      stageCtx: {
        world: this.world, lighting: this.lighting, audio: this.audioFacade(),
        playerMarker: this.playerMarker,
        cameraDirector: () => this.cameraRig.director,
        playerName: settings.playerName,
        // live accessors for the LLM agent's scene prompt.
        // playerDominance was a *value* snapshotted at construction (and
        // this.player.dominance was undefined), freezing every NPC's compliance
        // clash term at the 55 fallback forever.
        playerDominance: () => this.run.player.dominance ?? 55,
        lightingName: () => this.lighting.presetId,
        timeOfDay: () => this.clock.phase,
        threat: () => this.run.threat,
        combat: () => this.combat,
      },
    });
    this.chatPanel = new ChatPanel(this.dialogue, this.cast);

    // games
    // live accessor: a hard-coded 65 meant training never improved social play
    this.gambits = new Gambits({
      rng: this.rng.stream('gambits'),
      playerSkill: () => this.run.player.skill ?? 60,
    });
    this.mystery = new Mystery({ cast: () => this.cast, run: () => this.run });
    this.cards = new Cards({
      rng: this.rng.stream('cards'),
      kaiDominance: () => this.cast.kai?.stats.dominance ?? 50,
    });
    this.gamesPanel = new GamesPanel(this);

    // the bed: sit / lie / invite / stay the night (src/sim/bedScene.js)
    this.bedScene = new BedScene({
      placePlayer: (pose) => this._placeOnBed(pose),
      releasePlayer: () => this._leaveBed(),
      skip: (m) => this.clock.skip(m),
      scheduler: this.scheduler,
      fade: (on) => this._fade(on),
      narrate: (text) => this._narrate(text),
      narration: (id) => narrationFor(id, this.rng.stream('bed')),
      player: () => this.run.player,
      brain: (id) => this.brains[id],
      others: () => Object.values(this.cast),
    });
    // On the bed, E drives the bed wherever you are looking — lying down points
    // the eye at the ceiling, where the picker has nothing to hover.
    const pickInteract = this.cameraRig.fp.onInteract;
    this.cameraRig.fp.onInteract = (e) => {
      const onBed = this.bedScene.playerState !== 'none';
      // a held E auto-repeats: without this it cycles sit → lie → up → sit…
      if (e?.repeat && (onBed || this.picker.hovered === this._bedTarget)) return;
      if (onBed) this.bedScene.use();
      else pickInteract?.();
    };
    on('bedscene.state', ({ player }) => {
      if (this._bedTarget) this._bedTarget.prompt = bedPrompt(player);
      // the picker only emits on a hover CHANGE, so re-announce the prompt here
      const h = player !== 'none' ? this._bedTarget : this.picker.hovered;
      emit('pick.hover', h ? { id: h.id, prompt: h.prompt } : null);
    });
    // a seated guest's brain is held until they are dismissed (non-persistent)
    on('bedscene.guest', ({ id, seated }) => {
      const b = this.brains[id];
      if (seated) b?.hold(); else b?.release();
    });
    const bedHint = (text) => emit('hud.alert', { text, kind: 'info' });
    /** @param {{ok:boolean, reason?:string}} r */
    const bedRefused = (r) => {
      if (r.reason === 'player') bedHint('Sit on the bed first.');
      else if (r.reason === 'full') bedHint('There is only room for one more.');
    };
    on('bed.requested', ({ action, charId }) => {
      const c = this.cast[charId];
      if (!c) return;
      if (action === 'dismiss') { this.bedScene.dismiss(c); return; }
      // a fight, an event or a cutscene outranks the bed — nothing moves
      if (this.combat?.active) { bedHint('Not in the middle of a fight.'); return; }
      if (this.run.activeEventId || this.cutscene?.playing) { bedHint('Not now — something is happening.'); return; }
      if (action === 'invite') bedRefused(this.bedScene.invite(c));
      else if (action === 'stay') {
        this.bedScene.stayNight(c).then(bedRefused)
          .catch((e) => console.error('[bed] stay the night failed', e));
      }
    });
    // switching the camera out of first person (C) gets you off the bed
    // (a cutscene gets you up itself before it takes the camera — onStart)
    on('camera.mode', ({ mode }) => {
      if (mode !== 'firstPerson' && mode !== 'cinematic' && this.bedScene.playerState !== 'none') this.bedScene.getUp();
    });
    on('bedscene.started', () => this.conductor.setMood({ closeness: 0.5, warmth: 0.7, energy: 0.2, tension: 0.05 }));
    on('bedscene.ended', () => this.conductor.setMood({ closeness: 0, warmth: 0.45, energy: 0.3, tension: Math.min(1, this.run.threat / 90) }));

    this.directorPanel = new DirectorPanel(this);

    this.cameraRig.focusTargets = Object.values(this.cast).map((c) => c.actor.root);

    // situational auto-camera: frames combat / dialogue / events. Attached now
    // that cast, combat, and the player marker all exist.
    this.cameraRig.attachDirector({
      stage: this.stage,
      cast: () => this.cast,
      combat: () => this.combat,
      playerMarker: this.playerMarker,
    });

    // cutscenes, saves, death
    this.cutscene = new CutscenePlayer({
      stage: this.stage, cameraRig: this.cameraRig, loop: this.loop,
      cast: this.cast, voiceBank: this.voiceBank, vox: this.vox, lighting: this.lighting,
      // a seated player gets up before the scene takes the camera, so the
      // scene hands back a normal camera, not a first-person seat lock
      onStart: () => this.bedScene?.getUp(),
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
      if (this.mode === 'run' && clock.minuteOfDay === DINNER_MINUTE && shouldDinner(this.run, clock)) {
        markDinner(this.run, clock);
        if (this._beatPlayable('dinner')) {
          import('../../data/cutscenes/dinner.js').then(({ dinnerCutscene }) => {
            if (!this._beatPlayable()) return;
            this.cutscene.play(dinnerCutscene(clock.day));
          });
        }
      }
      if (this.mode === 'run' && clock.minuteOfDay === SLEEP_MINUTE && shouldSleep(this.run, clock)) {
        markSleep(this.run, clock);
        this._castOutfitHour('sleepwear');
        if (this._beatPlayable('sleep')) {
          import('../../data/cutscenes/sleep.js').then(({ sleepCutscene }) => {
            if (!this._beatPlayable()) return;
            this.cutscene.play(sleepCutscene(clock.day));
          });
        }
      }
    });

    this.loop.resume('boot');
    emit('resources.changed', this.run.resources);
    // seed the HUD: threat.changed only fires on the world tick, so the meter
    // would read 0 until the first game-minute (and through the intro cutscene)
    emit('threat.changed', { threat: this.run.threat });
    feed(`${settings.playerName} entered the tower. Lockdown continues.`, 'system');

    // scenario + loadout (fresh runs only); resume restores everything from autosave
    const scenario = SCENARIOS[this._startOpts.scenarioId] || SCENARIOS.first_night;
    this.scenarioId = scenario.id;
    const resumed = this._startOpts.resume !== false && this._tryResume();
    if (!resumed) {
      deleteAutosave();     // fresh run supersedes any old autosave
      const loadout = this._startOpts.loadout || 'fixer';
      this.inventory.applyLoadout(loadout);
      const ld = LOADOUTS[loadout];
      if (ld?.resources) for (const [k, v] of Object.entries(ld.resources)) {
        this.run.resources[k] = Math.max(0, (this.run.resources[k] || 0) + v);
      }
      emit('resources.changed', this.run.resources);
      // One shared applier with the Director + Creation Kit. The old inline copy
      // here dropped `fireEvent` and `game`, so 7 of 16 scenarios were inert from
      // the main menu (both mysteries, Blackout Confessions, The Refugee
      // Question, Lola's Debt Collection Call…).
      applyScenario(this, scenario, { lightingFade: 0.5, cutsceneDelayMs: 600 })
        .catch((err) => console.error('[boot] scenario failed', scenario.id, err))
        .finally(() => { this.scenarioSettled = true; });
    } else {
      // resume-from-save path never calls applyScenario, so it settles immediately
      this.scenarioSettled = true;
    }
    this._setWeaponModel();   // resume path emits inventory.changed, not .equipped
    dbg('run started', scenario.id);
  }

  /** Torso-height aim points of all living hostiles during combat, else null.
   *  Feeds the camera's continuous aim magnetism, which picks whichever is
   *  nearest the current aim direction. */
  _hostileAimPoints() {
    if (!this.combat?.active) return null;
    const out = [];
    for (const h of this.combat.hostiles || []) {
      if (h.hp <= 0) continue;
      const p = h.actor.root.position;
      out.push({ x: p.x, y: p.y + 1.2, z: p.z });
    }
    return out.length ? out : null;
  }

  /** Attach the procedural weapon mesh for the equipped weapon to the player's right hand. */
  _setWeaponModel() {
    const hand = this.playerActor?.rig?.byName?.handR;
    if (!hand) return;
    if (this._weaponMesh) { hand.remove(this._weaponMesh); this._weaponMesh = null; }
    const id = this.inventory?.equipped;
    const key = (id && id !== 'fists') ? this.inventory.equippedWeapon().key : 'fists';
    const w = buildWeapon(key);
    // hand-local placement: grip in the fist, barrel clearing the fingers forward
    w.position.set(0.03, 0.0, 0.06);
    w.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    hand.add(w);
    this._weaponMesh = w;
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
      case prop.id === 'bed':
        this.bedScene.use();
        break;
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
        // Re-entrancy guard: a second look inside the 4s window used to capture
        // prevFov = 16, so the restore restored the zoom and the camera stayed
        // locked at 16° for the rest of the run.
        if (this._telescopeFov != null) break;
        this._telescopeFov = cam.fov;
        const prevFov = this._telescopeFov;
        cam.fov = 16; cam.updateProjectionMatrix();
        emit('hud.alert', { text: 'Through the lens: barricades, smoke, a city eating itself.', kind: 'warn' });
        addCodex('telescope_view', 'Through the Telescope', 'From the 45th floor you can watch the barricade lines move like a slow tide.');
        setTimeout(() => {
          cam.fov = prevFov; cam.updateProjectionMatrix();
          this._telescopeFov = null;
        }, 4000);
        break;
      }
      case prop.id === 'vox_terminal': {
        // ONE menu: repairs and open case files together.
        //
        // Repairs used to be a separate early-return, so as long as any system
        // was damaged and you held a part — which is most of a run — the branch
        // below was unreachable. That matters because it is the case board:
        // three mystery cases shipped openable ONLY by picking a scenario at the
        // new-run screen or through the debug Director panel, so a player who
        // started any other scenario could never open one, and the clue props
        // scattered across six floors had nothing to feed. VOX keeping files on
        // things that do not resolve is also just what VOX would do.
        const damaged = this.run.resources.parts >= 1
          ? Object.entries(this.run.systems).filter(([, sys]) => sys.hp < 70 || !sys.online)
          : [];
        const openCases = Object.values(MYSTERY_CASES)
          .filter((c) => !this.run.flags.solvedCases?.includes(c.id));
        addCodex('vox_terminal', 'The VOX Terminal', 'The tower AI answers direct queries. Some answers feel like warnings.');

        if (!damaged.length && !openCases.length) {
          this.vox.say(this.rng.stream('vox_lines').pick(VOX_TERMINAL_LINES));
          break;
        }
        const prompt = damaged.length
          ? `VOX diagnostics. Repairs cost 1 part + 45 minutes each. Parts: ${Math.floor(this.run.resources.parts)}.`
          : 'VOX: "I keep files on things that do not resolve. I would like someone to read one."';
        emit('event.choice', {
          prompt,
          options: [
            ...damaged.map(([name, sys]) => `Repair ${name} (${Math.round(sys.hp)}%)`),
            ...openCases.map((c) => `Case file: ${c.title}`),
            'Just diagnostics',
          ],
          pick: (idx) => {
            if (idx < damaged.length) {
              const [name, sys] = damaged[idx];
              this.run.resources.parts -= 1;
              this.clock.skip(45);   // clock.skip emits world.minute; worldTick subscribes
              sys.hp = Math.min(100, sys.hp + 60);
              sys.online = true;
              if (name === 'power') emit('power.changed', { online: true });
              emit('systems.changed', this.run.systems);
              emit('resources.changed', this.run.resources);
              this.vox.say(`${name} restored. The tower thanks you. I thank you. We are the same thing, but the sentiment doubles.`);
              feed(`Repaired ${name}.`, 'system');
              return;
            }
            const caseIdx = idx - damaged.length;
            if (caseIdx < openCases.length) {
              emit('game.requested', { game: `mystery:${openCases[caseIdx].id}` });
              return;
            }
            this.vox.say(this.rng.stream('vox_lines').pick(VOX_TERMINAL_LINES));
          },
        });
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
        // gainRes owns the looted flag; setting it here first made gainRes
        // early-return, so the first loot granted 0 meds and warned "Already emptied".
        if (looted[prop.id]) { emit('hud.alert', { text: 'Already emptied.', kind: 'warn' }); break; }
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
  /**
   * Make `floorId` the live floor. THE one place that does it.
   *
   * A floor change is not one call, it is six: swap the visible group, shift the
   * light kit to that floor's world offset, apply its fog bias, re-key the
   * ambience bed, move the player body AND the marker (combat spawn checks, cast
   * gaze and the director camera all read the marker, not the camera), and
   * announce it so the HUD chip and anything else listening can follow.
   *
   * The elevator and the save loader each open-coded the whole sequence, and a
   * former bed-scene entry point open-coded ONE step of it — `setActiveFloor('penthouse')`
   * on its own — which left the lighting rig, the fog, `world.activeFloor` and the
   * HUD all still pointing at the floor the player had just left, up to 1200
   * world units away. Three copies of a ritual is how a step goes missing.
   *
   * @param {string} floorId
   * @param {{movePlayer?: boolean, from?: string, fromBed?: boolean}} [opts]
   *   movePlayer: place the player at that floor's elevator (default true).
   *   Pass false when the caller positions the player itself.
   */
  setFloor(floorId, opts = {}) {
    const floor = FLOORS[floorId];
    if (!floor || !this.world?.floorGroups?.[floorId]) return false;
    // a forced move (elevator, event, debug) gets a seated player up first —
    // except the bed's own move to the penthouse when you sit down
    if (!opts.fromBed && this.bedScene && this.bedScene.playerState !== 'none') this.bedScene.getUp();
    const from = opts.from ?? this.world.activeFloor;
    this.world.setActiveFloor(floorId);
    this.lighting.setFloorOffset(floor.offsetX);
    this.lighting.setFloorLook(floorId);
    if (opts.movePlayer !== false) {
      const [ex, ez] = elevatorPos(floorId);
      this.playerActor?.root.position.set(ex, 0, ez + 0.6);
      this.playerMarker?.position.set(ex, 1.1, ez + 0.6);
      this.cameraRig?.fp.pos.set(ex, 1.62, ez + 0.6);
    }
    this.setAmbienceForFloor(floorId);
    emit('floor.changed', { floor: floorId, from });
    return true;
  }

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
    const zone = ZONES[zoneId];
    const [x, z] = zone ? waypointPos(zoneId) : [0, 0];
    actor.root.position.set(x, 0, z);
    // NO rim at spawn. The pool holds two lights and this claimed one per cast
    // member at construction, so Lola and Aria took both slots permanently, Kai
    // and every refugee never got one at all, and after the first fight evicted
    // them nothing ever re-claimed — the effect simply stopped existing. It is a
    // FOCUS light: it belongs on whoever is speaking right now.
    this.stage.scene.add(actor.root);
    const queue = new ActorQueue(actor, this.world);
    const character = new Character(persona, actor, queue);
    this.cast[persona.id] = character;
    emit('char.registered', { character });
    return character;
  }

  /**
   * Put the player on the bed in first person. Mirrors the old bed staging:
   * the WHOLE move goes through setFloor, and the body is snapped along with the
   * eye so proximity checks and gaze resolve to where the player actually is.
   * @param {'sitting'|'lying'} pose
   */
  _placeOnBed(pose) {
    if (this.world.activeFloor !== 'penthouse') this.setFloor('penthouse', { movePlayer: false, fromBed: true });
    const ref = pose === 'lying' ? 'bed.lie_center' : 'bed.seat0';
    const sock = this.world.getSocket(ref);
    const p = sock ? sock.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(-12.1, 0, 3.6);
    if (!this._bedReturn) this._bedReturn = { camMode: this.cameraRig.mode };
    this.cameraRig.setMode('firstPerson');
    const fp = this.cameraRig.fp;
    // sitting: face out into the alcove; lying: look up and across the room
    const yaw = pose === 'lying' ? 0 : Math.PI;
    fp.placeAt(p.x, p.z, yaw, pose === 'lying' ? 0.35 : -0.05);
    fp.pos.y = pose === 'lying' ? 0.75 : 1.05;   // eye height on the mattress
    fp.camera.position.copy(fp.pos);
    fp.seated = true;
    fp.onStandUp = () => this.bedScene.getUp();
    this.playerMarker.position.set(p.x, 1.4, p.z);
    this.playerActor?.snapTo(p.x, p.z, yaw);
  }

  /** Back on your feet at the bedside, in whatever camera mode you were using. */
  _leaveBed() {
    const fp = this.cameraRig.fp;
    fp.seated = false;
    fp.onStandUp = null;
    const [sx, sz] = waypointPos('bed_alcove', 'bedside');
    fp.placeAt(sx, sz, fp.yaw);
    this.playerMarker.position.set(sx, 1.4, sz);
    this.playerActor?.snapTo(sx, sz, fp.yaw);
    const back = this._bedReturn?.camMode;
    this.cameraRig.setMode(back && back !== 'cinematic' ? back : 'auto');
    this._bedReturn = null;
  }

  /** Nobody — player, guest, or an NPC on or heading to it — is using the bed (AI sleep). */
  _bedFree() {
    return this.bedScene?.isFree() ?? false;
  }

  /**
   * Full-screen fade used by the bed scene. Resolves when the transition ends.
   * @param {boolean} on
   * @returns {Promise<void>}
   */
  _fade(on) {
    let el = document.getElementById('fade');
    if (!el) {
      el = document.createElement('div'); el.id = 'fade'; document.getElementById('ui').appendChild(el);
      void el.offsetWidth;   // commit opacity 0 first, or the very first fade snaps to black
    }
    el.classList.toggle('on', on);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return new Promise((r) => setTimeout(r, reduced ? 50 : 1200));
  }

  /**
   * One line of narration in the subtitle strip, held long enough to read.
   * Nothing in src/ui renders subtitles from a bus event — the cutscene player
   * writes #subtitles directly — so this does the same (as text, not HTML).
   * Appended, then removed: whatever the strip already held is left alone.
   * @param {string} text
   * @returns {Promise<void>}
   */
  _narrate(text) {
    const strip = document.getElementById('subtitles');
    const line = document.createElement('div');
    line.className = 'line narration';
    line.textContent = text;
    strip?.appendChild(line);
    feed(text, 'info');
    return new Promise((r) => setTimeout(() => { line.remove(); r(); }, Math.min(6000, 1800 + text.length * 45)));
  }

  /** A named guest at reception. Counted as a corporeal mouth via the cast. */
  /**
   * Can a scripted daily beat play right now?
   *
   * The dinner/sleep/stay/fallen cutscenes are authored in PENTHOUSE-local
   * coordinates, and only one floor group is ever visible
   * (World3D.setActiveFloor). Firing one while the player is on the rooftop or
   * in the basement flew the camera into a hidden group and teleported the cast
   * to bar stools nobody could see. Being elsewhere is now a narrative outcome
   * instead of a broken scene.
   *
   * @param {string} [announce] beat id — feeds a line when the player misses it
   */
  _beatPlayable(announce) {
    if (this.mode !== 'run' || this.combat.active || this.cutscene.playing || this.run.activeEventId) return false;
    if (this.bedScene?.busy) return false;   // the stay-the-night skip: nothing plays unseen under the fade
    if (this.world?.activeFloor !== 'penthouse') {
      if (announce === 'dinner') feed('Somewhere above you, the others sit down to eat without you.', 'system');
      if (announce === 'sleep') feed('The tower goes quiet upstairs. You are still out here.', 'system');
      return false;
    }
    return true;
  }

  /**
   * @param {number} [forceIdx] explicit template index — used by save restore,
   *   which must reproduce a specific refugee rather than the "next" one.
   */
  spawnRefugee(forceIdx) {
    const idx = forceIdx != null ? forceIdx : Math.max(0, (this.run.refugees || 1) - 1);
    const persona = buildRefugee(idx);
    if (this.cast[persona.id]) return this.cast[persona.id];
    registerRefugeeTopics(persona.id);
    const c = this.spawn(persona, 'reception');
    c.wardrobe = new Wardrobe({
      id: 'refugee',
      name: c.name,
      persona: c.persona,
      actor: c.actor,
    }, 'street_armor');
    this.brains[c.id] = new Brain(c, {
      rng: this.rng.stream(`brain_${c.id}`),
      others: (self) => Object.values(this.cast).filter((x) => x !== self && x.alive && x.id !== 'vox'),
      threat: () => this.run.threat,
      sfx: (id) => playSfx(audio, id),
      combatActive: () => this.combat?.active ?? false,
      bedFree: () => this._bedFree(),
    });
    if (this.dialogue?.vocab?.chars && !this.dialogue.vocab.chars.includes(persona.id)) {
      this.dialogue.vocab.chars.push(persona.id);
    }
    feed(`${c.name} is in reception — another mouth, another story.`, 'system');
    emit('hud.alert', { text: `${c.name} made it inside`, kind: 'info' });
    return c;
  }

  /**
   * Respawn a specific refugee by persona id — save restore only. Refugees are
   * created at runtime, so a loaded save had entries in `characters` with no
   * `cast[id]` to restore into and they were silently dropped.
   * @param {string} id
   */
  spawnRefugeeById(id) {
    for (let i = 0; i < 8; i++) {
      if (buildRefugee(i).id === id) return this.spawnRefugee(i);
    }
    return null;
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
      const zoneId = c.queue.zone;
      const [x, z] = ZONES[zoneId] ? waypointPos(zoneId) : [0, 0];
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
    // Guarded on this.cameraRig too: mode flips to 'run' partway through the
    // (now async) startRun(), before cameraRig/lighting/combatFx exist.
    if (this.mode === 'run' && this.cameraRig) {
      this.cameraRig.update(dtSec);
      this.lighting.update(dtSec);
      this.combatFx.update(dtSec, this.stage.camera);
      // The body moves itself in FP/TPS (fp.update) and stands where it is in
      // auto/director/cinematic. The cast + combat track the body, not the camera.
      if (this.playerMarker && this.playerActor) {
        const b = this.playerActor.root.position;
        this.playerMarker.position.set(b.x, 1.45, b.z);
        // FirstPersonControls.update() already calls body.update() for us, and
        // cameraRig runs it in auto as well as fp/tps — so 'auto', the DEFAULT
        // mode, was ticking the player's walk cycle, breath and hair spring
        // twice per frame.
        const fpDriving = this.cameraRig.mode !== 'director';
        if (!fpDriving) this.playerActor.update(dtSec);
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
      rimPool.update();   // rims live on the scene root; they follow their claimant
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
        advanceMinutes: (n) => this.clock.skip(n),
        goto: (id, zone, wp) => this.cast[id]?.queue.goto(zone, wp),
        sit: (id, socket) => this.cast[id]?.queue.sit(socket),
        clip: (id, clip) => this.cast[id]?.queue.playClip(clip, 0.3),
        light: (preset) => this.lighting.apply(preset),
        setStat: (id, deltas) => this.cast[id]?.applyStats(deltas, 'debug'),
        stats: (id) => this.cast[id]?.stats,
        bond: (id) => this.cast[id]?.bond,
        say: (text, target) => this.dialogue?.playerSays(text, target),
        forceEvent: (id) => this.eventRunner?.fire(id),
        run: () => this.run,
        threat: () => this.run?.threat,
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
