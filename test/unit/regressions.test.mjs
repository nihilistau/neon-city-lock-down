// @ts-check
// Regression guards for bugs fixed in the v0.3.0 correctness pass. Each test
// fails against the pre-fix code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newRunState } from '../../src/sim/world.js';
import { hourlyTick } from '../../src/sim/survival.js';
import { Gambits } from '../../src/games/gambits.js';
import { BedGame } from '../../src/games/bedGame.js';
import { TruthOrDare } from '../../src/games/truthOrDare.js';
import { Character } from '../../src/chars/character.js';
import { ActorQueue, seatRootY, seatClip } from '../../src/sim/actors/actorQueue.js';
import { GATE_LADDER, tierIndex } from '../../src/chars/gates.js';
import { vox } from '../../data/cast/vox.js';
import { lola } from '../../data/cast/lola.js';
import { BED_ACTIONS, BED_TIERS } from '../../data/games/bedActions.js';
import { MYSTERY_CASES } from '../../data/games/mysteryCases.js';
import { Mystery } from '../../src/games/mystery.js';
import { CONFIG_DEFAULTS } from '../../data/configDefaults.js';

/** minimal Character stand-in for survival's cast loop */
function fakeChar(persona) {
  return {
    persona,
    stats: { happiness: 50, tension: 20 },
    applied: [],
    applyStats(d, src) { this.applied.push([d, src]); },
    ticked: 0,
    tickMinutes(m) { this.ticked += m; },
  };
}

test('survival does not count bodiless characters as mouths to feed', () => {
  const withVox = newRunState(1);
  const withoutVox = newRunState(1);
  const corporeal = [fakeChar(lola), fakeChar(lola), fakeChar(lola)];

  hourlyTick(withVox, [...corporeal, fakeChar(vox)]);
  hourlyTick(withoutVox, corporeal);

  // VOX is the tower itself; adding it must not increase consumption at all
  assert.equal(withVox.resources.food, withoutVox.resources.food);
  assert.equal(withVox.resources.water, withoutVox.resources.water);
});

test('a bodiless character still decays hourly but takes no ration penalty', () => {
  const run = newRunState(1);
  run.resources.food = 0;              // maximum shortage
  run.resources.water = 0;
  const voxChar = fakeChar(vox);
  const lolaChar = fakeChar(lola);

  hourlyTick(run, [lolaChar, voxChar]);

  assert.equal(voxChar.ticked, 60, 'VOX still ages');
  assert.equal(voxChar.applied.length, 0, 'VOX does not starve');
  assert.ok(lolaChar.applied.length > 0, 'corporeal cast do feel the shortage');
});

test('corporeal defaults to true, so ordinary cast still eat', () => {
  const a = newRunState(1);
  const b = newRunState(1);
  hourlyTick(a, [fakeChar(lola)]);
  hourlyTick(b, []);
  assert.ok(a.resources.food < b.resources.food, 'an extra mouth consumes more');
});

test('Gambits reads playerSkill live, so training improves social play', () => {
  let skill = 40;
  const g = new Gambits({ rng: { dice: () => 10 }, playerSkill: () => skill });
  assert.equal(g.playerSkill, 40);
  skill = 92;
  assert.equal(g.playerSkill, 92, 'was snapshotted at construction');
});

test('Gambits still accepts a plain number', () => {
  const g = new Gambits({ rng: { dice: () => 10 }, playerSkill: 65 });
  assert.equal(g.playerSkill, 65);
});

test('a fresh run has a live player dominance for the compliance clash term', () => {
  const run = newRunState(1);
  assert.equal(typeof run.player.dominance, 'number');
  assert.ok(run.player.dominance > 0 && run.player.dominance <= 100);
});

// ── v0.3.0 correctness pass ────────────────────────────────────────────────

test('seated characters consume the socket height instead of sinking to the floor', () => {
  // couch seat0 (0.46) is the height sit_relaxed was authored against
  assert.equal(seatRootY(0.46), 0);
  // bar stool (0.76), medbay gurney (0.85), bed (0.5) all used to sit at 0
  assert.ok(seatRootY(0.76) > 0.29 && seatRootY(0.76) < 0.31, 'bar stool lifts the body');
  assert.ok(seatRootY(0.5) > 0.03 && seatRootY(0.5) < 0.05, 'bed lifts the body');
  // never below the floor, whatever the socket
  assert.equal(seatRootY(0), 0);
  assert.equal(seatRootY(-1), 0);
});

test('lie_* sockets recline instead of sitting bolt upright', () => {
  assert.equal(seatClip('gurney0.lie_center'), 'lounge');
  assert.equal(seatClip('couch.seat0'), 'sit_relaxed');
  assert.equal(seatClip('stool2.seat0'), 'sit_relaxed');
});

test('the bed panel tier ladder includes undress and depraved', () => {
  // tier rows open on the LOWEST rung any of their actions needs
  const rowGate = (tier) => BED_TIERS.find((t) => t.tier === tier).actions
    .map((a) => a.gate).reduce((lo, g) => (tierIndex(g) < tierIndex(lo) ? g : lo));
  assert.equal(rowGate(4), 'undress', 'row 4 used to claim `intimate`, skipping undress');
  assert.equal(rowGate(5), 'explicit');
  // every rung the actions reference is a real ladder tier
  for (const a of BED_ACTIONS) assert.ok(GATE_LADDER.includes(a.gate), `${a.id}: ${a.gate}`);
  // and both formerly-skipped rungs are actually used by content
  const used = new Set(BED_ACTIONS.map((a) => a.gate));
  assert.ok(used.has('undress') && used.has('depraved'));
});

test('the explicitness cap comes from config, not three inlined copies', () => {
  const caps = CONFIG_DEFAULTS.chars.gates.explicitnessCap;
  const bed = new BedGame({
    cast: () => ({}), explicitness: () => 'suggestive', nowMinute: () => 0,
    rng: { pick: (a) => a[0] }, sfx: () => {},
  });
  assert.equal(bed._capTier(), caps.suggestive);
  const tod = new TruthOrDare({
    players: () => [], explicitness: () => 'mature', nowMinute: () => 0,
    playerName: 'P', rng: { pick: (a) => a[0], chance: () => false },
  });
  assert.equal(tod._capTier(), caps.mature);
  // and the cap really gates prompts through the ladder
  assert.equal(tod._withinCap({ tier: 5, gate: 'depraved' }), false);
  assert.equal(tod._withinCap({ tier: 4, gate: 'touch' }), true);
  assert.equal(tod._withinCap({ tier: 1 }), true, 'ungated prompts always draw');
});

test('every mystery clue prop is a registered interactable', () => {
  // `ledger` lived on vanity_table, which was never in PROP_PROMPTS — so the clue
  // was unobtainable and ask_kai never unlocked
  const src = readFileSync(new URL('../../src/scene3d/tower/zoneBuilder.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const PROP_PROMPTS'), src.indexOf('if (PROP_PROMPTS['));
  for (const c of Object.values(MYSTERY_CASES)) {
    for (const clue of c.clues) {
      assert.ok(clue.prop, `${c.id}/${clue.id} has no prop`);
      assert.ok(block.includes(`${clue.prop}:`), `${clue.prop} is not in PROP_PROMPTS`);
    }
  }
});

test('every mystery interrogation is reachable from obtainable clues', () => {
  for (const c of Object.values(MYSTERY_CASES)) {
    const clueIds = new Set(c.clues.map((cl) => cl.id));
    for (const iq of c.interrogations) {
      for (const need of iq.needsClues) assert.ok(clueIds.has(need), `${iq.id} needs ${need}`);
    }
  }
});

// ── the cast is mortal now ─────────────────────────────────────────────────

/** minimal Actor3D/ActorQueue stubs — enough for Character's constructor */
function stubActor() {
  return {
    downed: false,
    clip: 'idle_stand',
    root: { position: { toArray: () => [0, 0, 0], fromArray() {} } },
    face: { _talkAmp: 0, setExpression() {} },
    setTempo() {}, setRim() {}, lookAt() {},
    playClip(id) { if (!this.downed) this.clip = id; },
    setDowned(v) { this.downed = false; if (v) this.playClip('lounge'); this.downed = !!v; },
  };
}
function stubQueue() {
  return { hooks: {}, frozen: false, zone: 'lounge', cleared: 0, clear() { this.cleared++; } };
}
function makeChar() {
  return new Character(lola, stubActor(), stubQueue());
}

test('a cast member can actually die — `alive` was never cleared anywhere', () => {
  const c = makeChar();
  assert.equal(c.alive, true);
  assert.equal(c.hurt(40, 'wounds'), false, 'survives a flesh wound');
  assert.equal(c.alive, true);
  assert.equal(c.hurt(200, 'wounds'), true, 'the killing blow reports itself');
  assert.equal(c.alive, false);
  assert.equal(c.health, 0);
});

test('death stops the corpse being animated or queued', () => {
  const c = makeChar();
  c.die('wounds');
  assert.equal(c.queue.frozen, true, 'the queue accepts no more commands');
  assert.ok(c.queue.cleared > 0, 'pending commands are dropped');
  assert.equal(c.actor.downed, true);
  c.actor.playClip('dance_sway');
  assert.equal(c.actor.clip, 'lounge', 'a later idle/dance clip cannot revive the body');
});

test('the dead take no further stat deltas and die only once', () => {
  const c = makeChar();
  c.die('wounds');
  const before = { ...c.stats };
  c.applyStats({ happiness: 50, trust: 50 }, 'victory');
  assert.deepEqual(c.stats, before);
  assert.equal(c.die('wounds'), false);
  assert.equal(c.hurt(10), false);
});

test('a real ActorQueue refuses commands once frozen', () => {
  const q = new ActorQueue(stubActor(), { getSocket: () => null });
  assert.equal(q.push({ type: 'wait', args: [1] }), true);
  q.clear();
  q.frozen = true;
  assert.equal(q.push({ type: 'wait', args: [1] }), false);
  assert.equal(q.busy, false);
});

test('sustained ration shortfall starves a character to death', () => {
  const c = makeChar();
  let hours = 0;
  while (c.alive && hours < 500) {
    c.applyStats({ happiness: -1.5, tension: 2 }, 'rations');  // survival.js's tag
    c.tickMinutes(60);
    hours++;
  }
  assert.equal(c.alive, false, 'never starved');
  assert.ok(hours > 8 && hours < 100, `took ${hours} game-hours — should be days, not minutes`);
});

test('fed hours heal a character back up instead of starving them', () => {
  const c = makeChar();
  c.hurt(50, 'wounds');
  const wounded = c.health;
  for (let i = 0; i < 100; i++) c.tickMinutes(60);
  assert.ok(c.health > wounded, 'no recovery at all');
  assert.equal(c.alive, true);
});

test('save/load round-trips the dead state', () => {
  const dead = makeChar();
  dead.die('starvation');
  const blob = JSON.parse(JSON.stringify(dead.serialize()));
  assert.equal(blob.alive, false);

  const loaded = makeChar();
  loaded.restore(blob);
  assert.equal(loaded.alive, false);
  assert.equal(loaded.queue.frozen, true);
  assert.equal(loaded.actor.downed, true);
  // applySave replays an idle clip right after restore(); it must not stick
  loaded.actor.playClip('idle_stand');
  assert.equal(loaded.actor.clip, 'lounge');
});

test('a living save still loads alive (and old saves without health default sane)', () => {
  const c = makeChar();
  const blob = JSON.parse(JSON.stringify(c.serialize()));
  delete blob.health;                    // pre-fix save envelope
  const loaded = makeChar();
  loaded.restore(blob);
  assert.equal(loaded.alive, true);
  assert.equal(loaded.health, 100);
  assert.equal(loaded.queue.frozen, false);
});

test('a clue that names a prop is only found on that prop', () => {
  const m = new Mystery({ cast: () => ({}) });
  m.start('dead_drop');
  // standing in `security` and poking a different prop must not award the
  // security desk's clue (it used to match on zone alone)
  m.onProp('monitor_wall', 'security');
  assert.equal(m.found.size, 0);
  m.onProp('security_desk', 'security');
  assert.deepEqual([...m.found], ['timestamp']);
});

test('every dead_drop interrogation becomes reachable once its clues are found', () => {
  const m = new Mystery({ cast: () => ({}) });
  m.start('dead_drop');
  for (const cl of MYSTERY_CASES.dead_drop.clues) m.onProp(cl.prop, cl.zone);
  assert.equal(m.found.size, 4);
  const ids = m.availableInterrogations().map((iq) => iq.id);
  // ask_kai needs `ledger`, which lived on the unregistered vanity_table
  assert.ok(ids.includes('ask_kai'), 'ask_kai still unreachable');
  assert.equal(ids.length, MYSTERY_CASES.dead_drop.interrogations.length);
});
