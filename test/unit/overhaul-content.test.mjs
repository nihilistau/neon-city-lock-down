// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS } from '../../data/scenarios.js';
import { OUTFITS } from '../../data/outfits.js';
import { parseSaveEnvelope } from '../../src/core/save.js';
import { Cards } from '../../src/games/cards.js';
import { TALK_PROFILES } from '../../src/audio/talkSynth.js';

test('the_bed_game declares a bed payload so the main menu does not lie', () => {
  const g = SCENARIOS.the_bed_game.game;
  assert.ok(g === 'bed' || (typeof g === 'string' && g.startsWith('bed:')), `got ${g}`);
});

test('kais_card_game declares a cards payload', () => {
  assert.equal(SCENARIOS.kais_card_game.game, 'cards');
});

test('player has wardrobe recipes', () => {
  assert.ok(OUTFITS.player, 'OUTFITS.player missing');
  assert.ok(OUTFITS.player.street_armor, 'player street_armor missing');
  assert.ok(OUTFITS.player.casual_lounge, 'player casual_lounge missing');
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

test('card game runs five tricks and reports a winner', () => {
  let n = 0;
  const rng = {
    next: () => { n += 0.17; return n % 1; },
    chance: () => false,
    int: (a, b) => a,
    pick: (a) => a[0],
    dice: () => 10,
  };
  const g = new Cards({ rng, kaiDominance: () => 40 });
  g.start();
  assert.equal(g.active, true);
  for (let i = 0; i < 5; i++) {
    const r = g.play('high');
    assert.ok(r, `trick ${i} should resolve`);
  }
  assert.equal(g.active, false);
  assert.equal(g.playerTricks + g.kaiTricks, 5);
  assert.ok(['player', 'kai', 'draw'].includes(g.winner));
});

test('human cast has procedural talk profiles (sidecar is optional)', () => {
  for (const id of ['lola', 'aria', 'kai', 'player']) {
    assert.ok(TALK_PROFILES[id], `missing talk profile: ${id}`);
    assert.ok(TALK_PROFILES[id].pitch > 0);
  }
});

test('leftover events and the third mystery exist', async () => {
  const { EVENTS } = await import('../../data/events.js');
  const { MYSTERY_CASES } = await import('../../data/games/mysteryCases.js');
  const { OBJECTIVES } = await import('../../src/sim/objectives.js');
  for (const id of ['lola_collection', 'water_sickness', 'aria_client', 'shutter_jam', 'vox_dream', 'forage_scare']) {
    assert.ok(EVENTS[id], `missing event ${id}`);
  }
  assert.ok(MYSTERY_CASES.grid_ghost);
  assert.ok(MYSTERY_CASES.grid_ghost.clues.every((c) => c.zone));
  assert.ok(OBJECTIVES.some((o) => o.id === 'keep_alive'));
  assert.ok(OBJECTIVES.some((o) => o.id === 'vox_fondness'));
  assert.equal(SCENARIOS.ghost_on_the_grid.game, 'mystery:grid_ghost');
});
