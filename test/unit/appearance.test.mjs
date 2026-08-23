// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerPersona, SKIN_TONES, HAIR_COLORS, HAIR_STYLES } from '../../data/cast/player.js';
import { fabricForPiece } from '../../src/humanoid/outfitBuilder.js';
import { EVENTS } from '../../data/events.js';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAY_CUTSCENE } from '../../data/cutscenes/stay.js';
import { SHUTTLE_CUTSCENE } from '../../data/cutscenes/shuttle.js';
import { LOUNGE_SETTLE } from '../../data/cutscenes/settle.js';
import { fallenCutscene } from '../../data/cutscenes/fallen.js';
import { EventRunner } from '../../src/sim/eventRunner.js';

test('appearance overrides skin, hair, height, build, style', () => {
  const p = buildPlayerPersona('Nyx', 'she', {
    skin: '#6e5142', hair: '#c4c0c8', hairStyle: 'long', height: 1.81, build: 1.12,
  });
  assert.equal(p.colors.skin, '#6e5142');
  assert.equal(p.colors.hair, '#c4c0c8');
  assert.equal(p.hairStyle, 'long');
  assert.equal(p.body.height, 1.81);
  assert.equal(p.body.build, 1.12);
  assert.ok(p.faceAsset.includes('player-f'));
});

test('male appearance picks the male face asset and short default hair', () => {
  const p = buildPlayerPersona('Rex', 'he', {});
  assert.ok(p.faceAsset.includes('player-m'));
  assert.equal(p.hairStyle, 'short');
  assert.ok(HAIR_STYLES.includes(p.hairStyle));
  assert.ok(SKIN_TONES.length >= 5);
  assert.ok(HAIR_COLORS.length >= 5);
});

test('jackets use leather and dresses use silk', () => {
  assert.equal(fabricForPiece('jacket'), 'leather');
  assert.equal(fabricForPiece('dress'), 'silk');
  assert.equal(fabricForPiece('shorts'), 'cotton');
});

test('extraction offer has stay, solo extract, and companion extract', () => {
  const labels = EVENTS.extraction_offer.script
    .find((s) => s.type === 'choice').options.map((o) => o.label);
  assert.ok(labels.some((l) => /stay/i.test(l)));
  assert.ok(labels.some((l) => /alone/i.test(l)));
  assert.ok(labels.some((l) => /bring/i.test(l)));
  assert.ok(EVENTS.stay_last, 'stay epilogue event missing');
  const bring = EVENTS.extraction_offer.script.find((s) => s.type === 'choice').options
    .find((o) => /Lola and Aria/i.test(o.label));
  const flag = bring.steps.find((s) => s.type === 'runFlag');
  assert.deepEqual(flag.value, ['lola', 'aria']);
  const alone = EVENTS.extraction_offer.script.find((s) => s.type === 'choice').options
    .find((o) => /alone/i.test(o.label));
  assert.deepEqual(alone.steps.find((s) => s.type === 'runFlag').value, []);
});

test('stay, shuttle, lounge-settle, and fallen cutscenes are authored', () => {
  assert.ok(STAY_CUTSCENE.length >= 4);
  assert.ok(SHUTTLE_CUTSCENE.length >= 4);
  assert.ok(LOUNGE_SETTLE.length >= 3);
  assert.ok(STAY_CUTSCENE.some((s) => s.type === 'titleCard'));
  assert.ok(SHUTTLE_CUTSCENE.some((s) => s.type === 'titleCard'));
  const fallen = fallenCutscene('Lola');
  assert.ok(fallen.length >= 3);
  assert.ok(fallen.some((s) => s.type === 'titleCard' && /LOLA/.test(s.text)));
});

test('runFlag stores arrays, not coerced booleans', async () => {
  const run = { flags: {} };
  const er = new EventRunner({
    run: () => run,
    cast: () => ({}),
    lighting: { apply() {} },
    audioFacade: () => ({ sfx() {}, voxLine() {} }),
    nowMinute: () => 0,
  });
  await er.runner.run([{ type: 'runFlag', flag: 'extractedWith', value: ['lola', 'kai'] }]);
  assert.deepEqual(run.flags.extractedWith, ['lola', 'kai']);
  await er.runner.run([{ type: 'runFlag', flag: 'stayed' }]);
  assert.equal(run.flags.stayed, true);
  await er.runner.run([{ type: 'runFlag', flag: 'extractedWith', value: [] }]);
  assert.deepEqual(run.flags.extractedWith, []);
});

test('leather and silk fabric maps are on disk', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  assert.ok(existsSync(join(root, 'assets/fabrics/leather.jpg')));
  assert.ok(existsSync(join(root, 'assets/fabrics/silk.jpg')));
  assert.ok(existsSync(join(root, 'assets/city/skyline.jpg')));
});

test('elevator picker does not go through event.choice', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src/ui/elevator.js'), 'utf8');
  assert.ok(src.includes('elev-picker'));
  assert.ok(!src.includes('event.choice'));
});

test('itemIconSrc maps fists and medkit onto HUD art', async () => {
  const { itemIconSrc } = await import('../../src/ui/icons.js');
  assert.ok(itemIconSrc('fists')?.includes('fists'));
  assert.ok(itemIconSrc('medkit')?.includes('meds'));
  assert.equal(itemIconSrc('sidearm'), null);
});

test('extra HUD icons are on disk', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (const id of ['threat', 'plan', 'whisper', 'inventory', 'fists']) {
    assert.ok(existsSync(join(root, 'assets/ui/icons', `${id}.jpg`)), id);
  }
});
