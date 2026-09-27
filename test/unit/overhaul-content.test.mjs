// @ts-check
// The v0.4 content overhaul, tested through the engines that consume it.
// These used to be data-literal identity checks (`SCENARIOS.x.game === 'cards'`,
// `OUTFITS.player` is truthy) which passed against a completely broken bed game,
// card game and wardrobe. Every test here now calls the real code path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SCENARIOS } from '../../data/scenarios.js';
import { parseSaveEnvelope } from '../../src/core/save.js';
import { Cards } from '../../src/games/cards.js';
import { TALK_PROFILES, syllables, sayTalk } from '../../src/audio/talkSynth.js';
import { applyScenario } from '../../src/sim/scenario.js';
import { Character } from '../../src/chars/character.js';
import { EventRunner } from '../../src/sim/eventRunner.js';
import { Mystery } from '../../src/games/mystery.js';
import { updateObjectives } from '../../src/sim/objectives.js';
import { newRunState } from '../../src/sim/world.js';
import { MYSTERY_CASES } from '../../data/games/mysteryCases.js';
import { on } from '../../src/core/bus.js';
import lola from '../../data/cast/lola.js';
import aria from '../../data/cast/aria.js';
import kai from '../../data/cast/kai.js';

/** the 3D half of a Character, reduced to the calls the sim actually makes */
function stubActor() {
  return {
    root: { position: new THREE.Vector3() },
    clips: [], tempo: 1,
    setTempo(t) { this.tempo = t; },
    playClip(id) { this.clips.push(id); },
    setDowned() {},
    face: { setExpression() {}, setTalk() {} },
  };
}
function stubQueue() {
  return { hooks: {}, zone: null, gotos: [], cleared: 0, clear() { this.cleared++; }, goto(z, wp) { this.zone = z; this.gotos.push([z, wp]); } };
}
function makeCast() {
  const cast = {};
  for (const persona of [lola, aria, kai]) {
    cast[persona.id] = new Character(persona, /** @type {any} */ (stubActor()), /** @type {any} */ (stubQueue()));
  }
  return cast;
}
/** an app stub carrying exactly what applyScenario touches */
function stubApp(cast, sink) {
  return {
    cast,
    scenarioId: null,
    clock: { totalMinutes: 0, day: 1 },
    lighting: { presetId: null, apply(id) { this.presetId = id; sink.lighting = id; } },
    brains: Object.fromEntries(Object.keys(cast).map((id) => [id, { engage(m) { sink.engaged.push([id, m]); } }])),
    cutscene: { play: async (steps) => { sink.cutscenes.push(steps); } },
    eventRunner: { fire: async (id) => { sink.fired.push(id); } },
  };
}

test("staging Kai's Card Game places the room and deals a real hand", async () => {
  // Was: `SCENARIOS.kais_card_game.game === 'cards'`.
  const cast = makeCast();
  const sink = { engaged: [], cutscenes: [], fired: [], lighting: null };
  const app = stubApp(cast, sink);
  const kaiDom = cast.kai.stats.dominance;

  let requested = null;
  const off = on('game.requested', (p) => { requested = p; });
  await applyScenario(/** @type {any} */ (app), SCENARIOS.kais_card_game);
  off();

  assert.equal(requested?.game, 'cards');
  assert.ok(cast.kai.stats.dominance > kaiDom, 'Kai must actually get his dominance shift');
  assert.deepEqual(cast.kai.queue.gotos.at(-1), ['lounge', 'couch_front'], 'the scenario must seat Kai');
  assert.equal(cast.kai.queue.cleared, 1, 'placement must clear the standing queue first');
  assert.ok(sink.engaged.some(([id]) => id === 'kai'), 'the brain must be held off the staging');

  // the payload runs a real hand to a real winner
  let n = 0;
  const rng = { next: () => (n += 0.17) % 1, chance: () => false, int: (a) => a, pick: (a) => a[0], dice: () => 10 };
  const game = new Cards({ rng, kaiDominance: () => cast.kai.stats.dominance });
  game.start();
  for (let i = 0; i < 5; i++) assert.ok(game.play('high'), `trick ${i} must resolve`);
  assert.equal(game.active, false);
  assert.equal(game.playerTricks + game.kaiTricks, 5);
  assert.equal(game.log.length, 5);
  assert.ok(['player', 'kai', 'draw'].includes(game.winner));
});

test('a dominant Kai cheats the deck, and the cheat is what wins him the trick', () => {
  // deterministic: always "cheat" when the dominance test allows it
  const rng = { next: () => 0.1, chance: () => true, int: () => 0, pick: (a) => a[0] };
  const honest = new Cards({ rng: { ...rng, chance: () => false }, kaiDominance: () => 90 });
  honest.start();
  const fair = honest.play('high');
  assert.equal(fair.cheated, false, 'no cheat when the chance roll fails');

  const crooked = new Cards({ rng, kaiDominance: () => 90 });
  crooked.start();
  const t = crooked.play('high');
  assert.equal(t.cheated, true, 'a dominant Kai palms the card');
  assert.ok(t.his > t.yours, 'the cheat must beat you on a high call');
  assert.equal(t.win, false);

  // and a meek Kai never cheats, however the dice fall
  const meek = new Cards({ rng, kaiDominance: () => 40 });
  meek.start();
  assert.equal(meek.play('high').cheated, false, 'low dominance must never cheat');
});

test('no character has an undress outfit state', async () => {
  const { OUTFITS } = await import('../../data/outfits.js');
  for (const [id, recipes] of Object.entries(OUTFITS)) {
    for (const bad of ['none', 'underwear']) {
      assert.ok(!(bad in recipes), `${id} still has outfit "${bad}"`);
    }
  }
});

test('parseSaveEnvelope accepts a versioned envelope and rejects garbage', () => {
  const ok = parseSaveEnvelope({
    version: 1, run: {}, clock: {}, characters: {}, meta: { label: 'x' },
  });
  assert.equal(ok.ok, true);
  assert.equal(parseSaveEnvelope({ foo: 1 }).ok, false);
  assert.equal(parseSaveEnvelope(null).ok, false);
  assert.equal(parseSaveEnvelope('nope').ok, false);
});

test('the talk synth speaks with each character\'s own voice', () => {
  // Was: `TALK_PROFILES[id].pitch > 0` for four ids — true of any object with a
  // number on it. This drives sayTalk() through a recording AudioContext.
  // vowel-group split: one gate per vowel cluster, punctuation and digits dropped
  assert.deepEqual(syllables('Hello there'), ['ell', 'o', 'er', 'e']);
  assert.deepEqual(syllables('Hello, there! (2 a.m.)'), syllables('Hello there 2 am'));
  assert.deepEqual(syllables(''), []);
  assert.equal(syllables('a longer line of speech').length > syllables('hi').length, true);

  const made = [];
  const param = (name) => ({ value: 0, targets: [], setTargetAtTime(v, t) { this.targets.push([name, v, t]); } });
  const node = (kind) => {
    const n = {
      kind, type: '', frequency: param('freq'), Q: param('Q'), gain: param('gain'),
      started: null, stopped: null,
      connect() {}, start(t) { this.started = t; }, stop(t) { this.stopped = t; },
    };
    made.push(n);
    return n;
  };
  const ctx = {
    sampleRate: 48000,
    createOscillator: () => node('osc'),
    createGain: () => node('gain'),
    createBiquadFilter: () => node('filter'),
    createBufferSource: () => node('buf'),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
  };
  const engine = { ctx, now: 0, bus: () => node('bus') };

  const line = 'The tower is listening tonight';
  const dur = {};
  for (const id of ['lola', 'aria', 'kai', 'player', 'vox']) {
    made.length = 0;
    dur[id] = sayTalk(/** @type {any} */ (engine), TALK_PROFILES[id], line, null, id);
    assert.ok(dur[id] > 0, `${id} produced no speech`);
    const osc = made.find((n) => n.kind === 'osc');
    // the carrier must be driven to THIS character's pitch (±3% jitter)
    const pitches = osc.frequency.targets.map(([, v]) => v);
    assert.ok(pitches.length >= syllables(line).length, `${id} gated no syllables`);
    for (const p of pitches) {
      assert.ok(Math.abs(p / TALK_PROFILES[id].pitch - 1) < 0.06, `${id} sang at ${p}, not ${TALK_PROFILES[id].pitch}`);
    }
    // rough voices use a sawtooth carrier, smooth ones a triangle
    assert.equal(osc.type, TALK_PROFILES[id].roughness > 0.18 ? 'sawtooth' : 'triangle', `${id} carrier`);
    // three formant bandpasses, seeded from the profile
    const bands = made.filter((n) => n.kind === 'filter' && n.type === 'bandpass');
    assert.equal(bands.length, 4, 'three formants + the breath filter');
  }
  // rate is real: Kai (0.94) drawls, Aria (1.10) clips
  assert.ok(dur.kai > dur.aria, `kai ${dur.kai} should outlast aria ${dur.aria}`);
  assert.ok(sayTalk(/** @type {any} */ (engine), TALK_PROFILES.lola, 'a much much much longer line to speak aloud')
    > dur.lola, 'more words must take more time');
  assert.equal(sayTalk(/** @type {any} */ ({ ctx: null, now: 0, bus: () => null }), TALK_PROFILES.lola, line), 0,
    'no audio context → no speech, no crash');
});

test('the leftover events, the third mystery and the new objectives all RUN', async () => {
  // Was: `assert.ok(EVENTS[id])` for six ids plus two `.some(...)` checks.
  const cast = makeCast();
  const run = newRunState(7);
  const runner = new EventRunner({
    run: () => run, cast: () => cast,
    lighting: { apply() {} },
    audioFacade: () => ({ sfx() {}, voxLine() {} }),
    nowMinute: () => 4320,
  });

  // fire a leftover event end-to-end and answer its choice
  const water = run.resources.water, meds = run.resources.meds;
  const trust = cast.aria.stats.trust;
  const off = on('event.choice', ({ options, pick }) => {
    assert.ok(options.length >= 2, 'the event must offer a real decision');
    pick(0);   // "Flush the tank (-4 water, -1 meds)"
  });
  await runner.fire('water_sickness');
  off();
  assert.equal(run.resources.water, water - 4, 'the chosen branch must spend water');
  assert.equal(run.resources.meds, meds - 1, 'and meds');
  assert.ok(cast.aria.stats.trust > trust, 'and reach the cast');
  assert.deepEqual(run.eventsFired, ['water_sickness']);
  assert.equal(run.activeEventId, null, 'the event must release its lock');
  assert.equal(run.lastEventEndMinute, 4320, 'and stamp the scheduler gap');
  assert.deepEqual(run.history.choices, [{ prompt: run.history.choices[0].prompt, chose: run.history.choices[0].chose }]);

  // the third mystery is solvable through the real engine
  const m = new Mystery({ cast: () => cast, run: () => run });
  assert.equal(m.start('grid_ghost'), true);
  const c = MYSTERY_CASES.grid_ghost;
  assert.equal(m.availableInterrogations().length, 0, 'no clues, no leverage');
  for (const clue of c.clues) m.onProp(clue.prop, clue.zone);
  assert.equal(m.found.size, c.clues.length, 'every clue must be findable on its own prop');
  m.onProp('a_prop_from_another_case', 'nowhere');
  assert.equal(m.found.size, c.clues.length, 'and nothing else may hand you one');
  assert.ok(m.availableInterrogations().length > 0, 'clues must unlock interrogations');
  const solved = m.accuse(c.culprit);
  assert.deepEqual(solved, { correct: true, culprit: c.culprit });
  assert.deepEqual(run.flags.solvedCases, ['grid_ghost'], 'a closed case is recorded on the RUN');
  assert.equal(m.accuse('lola'), null, 'you only get one accusation');

  // the new objectives complete, pay out once, and stay done
  const clock = { day: 6 };
  run.objectives = { done: [] };
  run.flags.voxTalks = 8;
  const cells = run.resources.cells, morale = run.player.morale;
  const newly = updateObjectives(run, clock).map((o) => o.id);
  assert.ok(newly.includes('keep_alive'), 'day 6 with the cast alive completes keep_alive');
  assert.ok(newly.includes('vox_fondness'), '8 VOX talks completes vox_fondness');
  assert.equal(run.resources.cells, cells + 2, 'vox_fondness must pay its 2 cells');
  assert.ok(run.player.morale > morale, 'keep_alive must pay its morale');
  assert.deepEqual(updateObjectives(run, clock), [], 'rewards are one-shot');
  assert.equal(run.resources.cells, cells + 2);

  // losing the cast un-completes it for a fresh run
  const lost = newRunState(8);
  lost.flags.lostCast = true;
  assert.ok(!updateObjectives(lost, clock).some((o) => o.id === 'keep_alive'),
    'keep_alive must NOT complete when someone died');
});
