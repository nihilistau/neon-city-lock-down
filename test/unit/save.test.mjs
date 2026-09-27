// @ts-check
// src/core/save.js — the versioned save envelope. A full round trip (build,
// wreck the live state, restore, compare), plus the two things that were
// recently broken by omission: activeFloor and runtime-spawned refugees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  buildSave, applySave, migrate, parseSaveEnvelope, importSave,
  saveToSlot, readSlot, listSlots, deleteAutosave, AUTOSAVE_KEY,
} from '../../src/core/save.js';
import { GameClock } from '../../src/core/clock.js';
import { Rng } from '../../src/core/rng.js';
import { newRunState } from '../../src/sim/world.js';
import { Character } from '../../src/chars/character.js';
import { Scheduler } from '../../src/sim/scheduler.js';
import { FLOORS } from '../../data/zones.js';
import lola from '../../data/cast/lola.js';
import aria from '../../data/cast/aria.js';

function stubActor() {
  return {
    root: { position: new THREE.Vector3() },
    downed: false, clips: [],
    setDowned(v) { this.downed = v; },
    playClip(id) { this.clips.push(id); },
    setTempo() {},
    face: { setExpression() {} },
  };
}
function stubQueue() {
  return { hooks: {}, zone: null, cleared: 0, clear() { this.cleared++; }, goto() {} };
}
function makeChar(persona) {
  return new Character(persona, /** @type {any} */ (stubActor()), /** @type {any} */ (stubQueue()));
}

/** app stand-in with the real clock/rng/run and duck-typed subsystems */
function makeApp() {
  const cast = { lola: makeChar(lola), aria: makeChar(aria) };
  const app = {
    clock: new GameClock(),
    rng: new Rng(1234),
    run: newRunState(1234),
    player: { name: 'Nyx' },
    scheduler: { nextAt: 90, serialize() { return { nextAt: this.nextAt }; }, deserialize(d) { this.nextAt = d.nextAt; } },
    inventory: { items: { medkit: 2 }, serialize() { return { items: { ...this.items } }; }, deserialize(d) { this.items = { ...d.items }; } },
    lighting: { presetId: 'neon_night', apply(id) { this.presetId = id; } },
    cast,
    brains: {
      lola: { engaged: 0, serialize() { return { engaged: this.engaged }; }, deserialize(d) { this.engaged = d.engaged; } },
      aria: { engaged: 0, serialize() { return { engaged: this.engaged }; }, deserialize(d) { this.engaged = d.engaged; } },
    },
    world: {
      activeFloor: 'penthouse',
      floorGroups: Object.fromEntries(Object.keys(FLOORS).map((id) => [id, {}])),
    },
    setFloorCalls: [],
    setFloor(id, opts) { this.setFloorCalls.push([id, opts]); this.world.activeFloor = id; },
    spawned: [],
    spawnRefugeeById(id) {
      this.spawned.push(id);
      const c = makeChar({ ...aria, id, name: 'Guest' });
      cast[id] = c;
      app.brains[id] = { engaged: 0, serialize() { return { engaged: this.engaged }; }, deserialize(d) { this.engaged = d.engaged; } };
      return c;
    },
  };
  return app;
}

/** a localStorage stand-in, since these tests run in Node */
function installStorage() {
  const map = new Map();
  /** @type {any} */ (globalThis).localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
  return map;
}

test('a save round-trips the whole run: clock, rng, run state, cast, subsystems', () => {
  const app = makeApp();
  // ── a run with some history on it
  app.clock.day = 4; app.clock.minuteOfDay = 19 * 60 + 30;
  app.rng.stream('events').next(); app.rng.stream('events').next();
  app.run.resources.food = 7.5;
  app.run.resources.ammo = 12;
  app.run.threat = 63;
  app.run.player.health = 44;
  app.run.player.skill = 88;
  app.run.flags.saw_breach = true;
  app.run.flags.extractedWith = ['lola'];
  app.run.eventsFired.push('water_sickness');
  app.run.eventQueue.push({ atMinute: 5000, eventId: 'vox_dream' });
  app.run.systems.power.hp = 22;
  app.run.systems.elevator.locked = true;
  app.run.history.choices.push({ prompt: 'p', chose: 'c' });
  app.run.lastEventEndMinute = 1170;
  app.cast.lola.applyStats({ trust: 20 }, 'test');
  // lift Lola into a non-default bond so the round-trip is not trivially 'stranger'
  app.cast.lola.stats.trust = 60; app.cast.lola.stats.loyalty = 60; app.cast.lola._refreshBond();
  app.cast.lola.memory.setFlag('lola_job');
  app.cast.aria.alive = false;
  app.cast.aria.health = 0;
  app.cast.aria.injuries = [{ part: 'leg', severity: 'wound' }];
  app.cast.aria.actor.root.position.set(3, 0, -4);
  app.cast.aria.queue.zone = 'clinic';
  app.scheduler.nextAt = 777;
  app.inventory.items = { medkit: 1, stim: 3 };
  app.lighting.presetId = 'candlelit';
  app.world.activeFloor = 'rooftop';

  const snapshot = {
    clock: app.clock.serialize(),
    run: structuredClone(app.run),
    lolaStats: { ...app.cast.lola.stats },
    lolaBond: app.cast.lola.bond,
    ariaPos: app.cast.aria.actor.root.position.toArray(),
  };

  const save = buildSave(app, '');
  assert.equal(save.version, 1);
  assert.equal(save.meta.day, 4);
  assert.equal(save.meta.playerName, 'Nyx');
  assert.match(save.meta.label, /Day 4/);
  assert.equal(save.activeFloor, 'rooftop', 'the envelope must carry the floor you were standing on');
  assert.deepEqual(Object.keys(save.characters).sort(), ['aria', 'lola']);
  // the rng position is captured per named stream (NB: applySave does not
  // currently push it back into app.rng — the envelope side is what is tested)
  assert.equal(save.rng.streams.events.draws, 2, 'stream draw counts must be captured');
  assert.equal(save.rng.baseSeed, 1234);

  // envelope must survive JSON — it is stored as a string
  const wire = JSON.parse(JSON.stringify(save));

  // ── wreck absolutely everything
  app.clock.day = 99; app.clock.minuteOfDay = 3;
  app.rng.stream('events').next();
  app.run.resources.food = 0;
  app.run.threat = 0;
  app.run.player.health = 100;
  app.run.flags = {};
  app.run.eventsFired.length = 0;
  app.run.systems.power.hp = 100;
  app.cast.lola.applyStats({ trust: -50 }, 'wreck');
  app.cast.lola.stats.loyalty = 0; app.cast.lola._refreshBond();
  app.cast.aria.alive = true;
  app.cast.aria.injuries = [];
  app.cast.aria.actor.root.position.set(0, 0, 0);
  app.scheduler.nextAt = 0;
  app.inventory.items = {};
  app.lighting.presetId = 'dawn_grey';
  app.world.activeFloor = 'basement';

  applySave(/** @type {any} */ (app), wire);

  assert.deepEqual(app.clock.serialize(), snapshot.clock, 'clock restored exactly');
  assert.deepEqual(app.run, snapshot.run, 'run state restored exactly');
  assert.deepEqual(app.cast.lola.stats, snapshot.lolaStats, 'stats restored');
  assert.equal(snapshot.lolaBond, 'trusted');
  assert.equal(app.cast.lola.bond, snapshot.lolaBond, 'bond restored');
  assert.equal(app.cast.lola.memory.hasFlag('lola_job'), true, 'memory flags restored');
  assert.equal(app.cast.aria.alive, false, 'the dead must come back dead');
  assert.equal(app.cast.aria.actor.downed, true, 'and downed in the 3D layer');
  assert.equal(app.cast.aria.injuries.length, 1);
  assert.deepEqual(app.cast.aria.actor.root.position.toArray(), snapshot.ariaPos, 'position restored');
  assert.equal(app.cast.aria.queue.zone, 'clinic', 'zone restored');
  assert.ok(app.cast.aria.queue.cleared > 0, 'the standing queue is cleared before restore');
  assert.equal(app.scheduler.nextAt, 777, 'scheduler restored');
  assert.deepEqual(app.inventory.items, { medkit: 1, stim: 3 }, 'inventory restored');
  assert.equal(app.lighting.presetId, 'candlelit', 'lighting restored');
});

test('a never-fired run survives JSON: -Infinity degrades to null, which the scheduler reads as -Infinity', () => {
  // newRunState seeds lastEventEndMinute = -Infinity, and JSON has no way to
  // spell that. The loader therefore hands the scheduler `null`, so the scheduler
  // MUST keep coalescing it — otherwise the first load of a fresh run either
  // suppresses every random event forever or fires one immediately.
  const app = makeApp();
  assert.equal(app.run.lastEventEndMinute, -Infinity);
  const wire = JSON.parse(JSON.stringify(buildSave(app)));
  assert.equal(wire.run.lastEventEndMinute, null, 'JSON cannot carry -Infinity');
  applySave(/** @type {any} */ (app), wire);
  assert.equal(app.run.lastEventEndMinute, null);

  const clock = { day: 2, minuteOfDay: 600, phase: 'day', totalMinutes: 2040 };
  const spyRng = () => { const r = { rolls: 0, chance() { r.rolls++; return false; }, weighted: () => null }; return r; };

  // coalesced to -Infinity → the min-gap is satisfied and the scheduler rolls
  const afterLoad = spyRng();
  const s1 = new Scheduler(/** @type {any} */ (afterLoad));
  for (let i = 0; i < 60; i++) s1.tick(app.run, clock);
  assert.ok(afterLoad.rolls > 0, 'a loaded run that has never fired an event must be allowed to roll one');

  // and a run that fired something ten minutes ago is still held off
  const recent = spyRng();
  const s2 = new Scheduler(/** @type {any} */ (recent));
  app.run.lastEventEndMinute = clock.totalMinutes - 10;
  for (let i = 0; i < 60; i++) s2.tick(app.run, clock);
  assert.equal(recent.rolls, 0, 'the min-gap must still hold after a load');
});

test('activeFloor comes back — an autosave on the roof must not resume in the penthouse', () => {
  const app = makeApp();
  app.world.activeFloor = 'rooftop';
  const save = JSON.parse(JSON.stringify(buildSave(app)));

  app.world.activeFloor = 'penthouse';
  applySave(/** @type {any} */ (app), save);
  assert.equal(app.world.activeFloor, 'rooftop');
  assert.deepEqual(app.setFloorCalls, [['rooftop', { from: 'rooftop' }]],
    'the floor must be restored through setFloor, so lighting/ambience/colliders follow');

  // already on the right floor → no redundant transition
  app.setFloorCalls.length = 0;
  applySave(/** @type {any} */ (app), save);
  assert.deepEqual(app.setFloorCalls, []);

  // a floor that no longer exists is ignored rather than crashing the load
  app.setFloorCalls.length = 0;
  applySave(/** @type {any} */ (app), { ...save, activeFloor: 'floor_that_never_was' });
  assert.deepEqual(app.setFloorCalls, []);
});

test('refugees spawned at runtime are respawned and restored, not silently dropped', () => {
  const app = makeApp();
  app.run.refugees = 1;
  const guest = app.spawnRefugeeById('refugee1');
  guest.applyStats({ trust: 30, fear: -10 }, 'test');
  guest.queue.zone = 'reception';
  guest.actor.root.position.set(9, 0, 2);
  const guestTrust = guest.stats.trust;
  app.spawned.length = 0;

  const save = JSON.parse(JSON.stringify(buildSave(app)));
  assert.ok(save.characters.refugee1, 'a refugee must be in the envelope');

  // a fresh app: the refugee is NOT in the cast, because refugees are runtime spawns
  const fresh = makeApp();
  fresh.run.refugees = 0;
  applySave(/** @type {any} */ (fresh), save);

  assert.deepEqual(fresh.spawned, ['refugee1'], 'the refugee must be respawned into the cast');
  assert.ok(fresh.cast.refugee1, 'and present in the tower');
  assert.equal(fresh.cast.refugee1.stats.trust, guestTrust, 'with their state restored');
  assert.equal(fresh.cast.refugee1.queue.zone, 'reception');
  assert.deepEqual(fresh.cast.refugee1.actor.root.position.toArray(), [9, 0, 2]);
  assert.equal(fresh.run.refugees, 1,
    'run.refugees must agree with the bodies in the tower (it gates the refugee event)');

  // a refugee already in the cast is restored in place, not spawned twice
  fresh.spawned.length = 0;
  applySave(/** @type {any} */ (fresh), save);
  assert.deepEqual(fresh.spawned, [], 'no double-spawn on a second load');
});

test('a save from another version is refused, loudly and quietly', () => {
  const app = makeApp();
  const save = buildSave(app);

  assert.throws(() => applySave(/** @type {any} */ (app), { ...save, version: 2 }),
    /save version 2 unsupported/, 'applySave must refuse a future save');
  assert.throws(() => applySave(/** @type {any} */ (app), { ...save, version: 0 }), /unsupported/);

  assert.deepEqual(parseSaveEnvelope({ ...save, version: 2 }), { ok: false, reason: 'version' });
  assert.equal(parseSaveEnvelope({ ...save, run: undefined }).reason, 'shape');
  assert.equal(parseSaveEnvelope({ ...save, clock: undefined }).reason, 'shape');
  assert.equal(parseSaveEnvelope({ ...save, characters: undefined }).reason, 'shape');
  assert.equal(parseSaveEnvelope(undefined).reason, 'not_object');
  assert.equal(parseSaveEnvelope(JSON.stringify(save)).reason, 'not_object', 'a string is not an envelope');
  assert.equal(parseSaveEnvelope(save).ok, true);

  // migrate is the forward path; today it is identity, and must stay total
  assert.equal(migrate(save), save);

  // importSave turns all of that into a result rather than a throw
  assert.deepEqual(importSave(/** @type {any} */ (app), '{not json'), { ok: false, reason: 'json' });
  assert.equal(importSave(/** @type {any} */ (app), { ...save, version: 9 }).reason, 'version');
  assert.equal(importSave(/** @type {any} */ (app), JSON.stringify(save)).ok, true,
    'a JSON string of a valid save must import');
});

test('slots, the autosave, and perma-death deletion', () => {
  const store = installStorage();
  const app = makeApp();
  app.clock.day = 3;

  const meta = saveToSlot(app, 2, 'before the breach');
  assert.equal(meta.label, 'before the breach');
  assert.equal(readSlot(2).meta.label, 'before the breach');
  assert.equal(readSlot(1), null, 'an empty slot reads as null');

  saveToSlot(app, 'auto');
  assert.ok(store.has(AUTOSAVE_KEY), 'the autosave has its own key');
  assert.ok(readSlot('auto'), 'and reads back');

  const slots = listSlots();
  assert.deepEqual(slots.map((s) => s.slot), [1, 2, 3, 'auto']);
  assert.equal(slots[0].meta, null);
  assert.equal(slots[1].meta.label, 'before the breach');
  assert.ok(slots[3].savedAt > 0);

  deleteAutosave();
  assert.equal(readSlot('auto'), null, 'perma-death must really delete the autosave');
  assert.deepEqual(listSlots().map((s) => s.slot), [1, 2, 3], 'and it drops out of the menu');
  assert.equal(readSlot(2).meta.label, 'before the breach', 'manual slots survive');

  // corrupt storage must not throw the menu over
  /** @type {any} */ (globalThis).localStorage.setItem('ncld.slot.3', '{ truncated');
  assert.equal(readSlot(3), null);
  assert.equal(listSlots().length, 3);
});

test('seeded determinism survives a load — rng state was captured but never restored', () => {
  // buildSave() has always written `rng: app.rng.serialize()` and applySave()
  // never read it back; Rng.deserialize had zero call sites in src/. So a run
  // stopped being reproducible the moment you loaded it, silently.
  const rng = new Rng('lockdown-seed');
  const events = rng.stream('events');
  const cards = rng.stream('cards');
  for (let i = 0; i < 17; i++) { events.next(); cards.next(); }

  const snapshot = JSON.parse(JSON.stringify(rng.serialize()));
  const expected = [events.next(), events.next(), cards.next()];

  // diverge hard, the way continuing to play would
  for (let i = 0; i < 40; i++) { events.next(); cards.next(); }

  rng.restore(snapshot);
  const afterLoad = [events.next(), events.next(), cards.next()];

  assert.deepEqual(afterLoad, expected, 'the same draws must come back after a restore');
  // and it must restore IN PLACE: every system captures rng.stream(name) once at
  // construction, so a replaced instance would leave them all holding the old one
  assert.equal(rng.stream('events'), events, 'captured stream references must stay valid');
});

test('rng restore reaches streams the loading session has not created yet', () => {
  const source = new Rng('lockdown-seed');
  const s = source.stream('events');
  for (let i = 0; i < 9; i++) s.next();
  const expected = s.next();

  const fresh = new Rng('a-completely-different-seed');
  fresh.restore(JSON.parse(JSON.stringify(
    (() => { const r = new Rng('lockdown-seed'); const e = r.stream('events');
      for (let i = 0; i < 9; i++) e.next(); return r.serialize(); })())));
  assert.equal(fresh.stream('events').next(), expected);
});
