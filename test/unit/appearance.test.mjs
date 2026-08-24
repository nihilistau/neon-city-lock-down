// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerPersona, SKIN_TONES, HAIR_COLORS, HAIR_STYLES } from '../../data/cast/player.js';
import { fabricForPiece } from '../../src/humanoid/outfitBuilder.js';
import { EVENTS } from '../../data/events.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAY_CUTSCENE } from '../../data/cutscenes/stay.js';
import { SHUTTLE_CUTSCENE } from '../../data/cutscenes/shuttle.js';
import { LOUNGE_SETTLE } from '../../data/cutscenes/settle.js';
import { fallenCutscene } from '../../data/cutscenes/fallen.js';
import { EventRunner } from '../../src/sim/eventRunner.js';
import { ICON_IDS } from '../../src/ui/icons.js';

test('appearance overrides skin, hair, height, build, style', () => {
  const p = buildPlayerPersona('Nyx', 'she', {
    skin: '#6e5142', hair: '#c4c0c8', hairStyle: 'long', height: 1.81, build: 1.12,
  });
  assert.equal(p.colors.skin, '#6e5142');
  assert.equal(p.colors.hair, '#c4c0c8');
  assert.equal(p.hairStyle, 'long');
  assert.equal(p.body.height, 1.81);
  assert.equal(p.body.build, 1.12);
  // The player deliberately has NO face asset: a fixed face texture contradicts
  // the 6 skin tones x 6 hair colours x 7 styles offered right above.
  assert.equal(p.faceAsset, undefined);
});

test('the player has no fixed face asset, and defaults to short hair', () => {
  const p = buildPlayerPersona('Rex', 'he', {});
  assert.equal(p.faceAsset, undefined, 'a fixed face fights the appearance editor');
  assert.equal(p.hairStyle, 'short');
  assert.ok(HAIR_STYLES.includes(p.hairStyle));
  assert.ok(SKIN_TONES.length >= 5);
  assert.ok(HAIR_COLORS.length >= 5);
});

test('every garment piece maps to a fabric that actually ships', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  assert.equal(fabricForPiece('jacket'), 'leather');
  assert.equal(fabricForPiece('dress'), 'silk');
  assert.equal(fabricForPiece('top'), 'cotton');
  // Every mapped fabric must exist on disk, and every shipped fabric must be
  // mapped — v0.4 shipped velvet.jpg and metal.jpg that nothing referenced.
  const pieces = ['jacket', 'dress', 'robe', 'top', 'shorts', 'leggings', 'towel'];
  const used = new Set(pieces.map(fabricForPiece).filter(Boolean));
  for (const kind of used) {
    assert.ok(existsSync(join(root, 'assets/fabrics', `${kind}.jpg`)), `${kind}.jpg missing`);
  }
  const onDisk = readdirSync(join(root, 'assets/fabrics')).map((f) => f.replace(/\.jpg$/, ''));
  for (const kind of onDisk) {
    assert.ok(used.has(kind), `${kind}.jpg ships but no piece uses it`);
  }
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

test('the elevator picker really renders, really dismisses, and really rides', async () => {
  // Was: a grep of elevator.js for the string 'elev-picker', which passes if the
  // string appears in a comment and passes against a completely broken picker.
  // This drives the real thing under jsdom instead.
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><body><div id="ui"></div><div id="overlay"></div></body>');
  const g = /** @type {any} */ (globalThis);
  g.window = dom.window; g.document = dom.window.document;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  g.HTMLSelectElement = dom.window.HTMLSelectElement;

  const { ElevatorUI } = await import('../../src/ui/elevator.js');
  const { initModalStack, isModalOpen } = await import('../../src/ui/modalStack.js');
  const { travelMinutes } = await import('../../src/sim/actors/nav.js');
  const { FLOORS } = await import('../../data/zones.js');
  initModalStack();

  const paused = [];
  const app = {
    world: { activeFloor: 'penthouse' },
    run: { systems: { elevator: { locked: false } } },
    loop: { pause: (r) => paused.push(['pause', r]), resume: (r) => paused.push(['resume', r]) },
  };
  const ui = new ElevatorUI(/** @type {any} */ (app));
  let rode = null;
  ui.ride = async (id) => { rode = id; };

  const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const overlay = dom.window.document.getElementById('overlay');

  // ── it renders one row per floor, and the current floor is not a destination
  ui.openPicker();
  let picker = overlay.querySelector('.elev-picker');
  assert.ok(picker, 'no picker mounted into #overlay');
  const rows = [...picker.querySelectorAll('button[data-id]')];
  assert.equal(rows.length, Object.keys(FLOORS).length, 'one button per floor');
  const here = rows.find((b) => b.dataset.id === 'penthouse');
  assert.equal(here.disabled, true, 'you cannot ride to the floor you are on');
  const roof = rows.find((b) => b.dataset.id === 'rooftop');
  assert.equal(roof.disabled, false);
  assert.match(roof.textContent, new RegExp(`${travelMinutes('penthouse', 'rooftop')} min`));
  assert.deepEqual(paused.at(-1), ['pause', 'elevator'], 'opening the picker pauses the sim');
  assert.equal(isModalOpen(), true, 'the picker must be on the modal stack, not floating free');

  // ── a click on the backdrop dismisses it and hands the sim back
  click(picker);
  assert.equal(overlay.querySelector('.elev-picker'), null, 'backdrop click must dismiss');
  assert.deepEqual(paused.at(-1), ['resume', 'elevator']);
  assert.equal(isModalOpen(), false);

  // ── Escape dismisses it too (it used to be a trap with no Esc handler)
  ui.openPicker();
  dom.window.document.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
  assert.equal(overlay.querySelector('.elev-picker'), null, 'Escape must dismiss');
  assert.deepEqual(paused.at(-1), ['resume', 'elevator']);

  // ── picking a floor closes the picker and rides to THAT floor
  ui.openPicker();
  picker = overlay.querySelector('.elev-picker');
  click(picker.querySelector('button[data-id="fl27"]'));
  assert.equal(rode, 'fl27', 'the picked floor must be the floor ridden to');
  assert.equal(overlay.querySelector('.elev-picker'), null, 'picking closes the picker');

  // ── "Stay" closes without riding
  rode = null;
  ui.openPicker();
  click(overlay.querySelector('.elev-picker button[data-cancel]'));
  assert.equal(rode, null, 'Stay must not ride anywhere');
  assert.equal(overlay.querySelector('.elev-picker'), null);
});

test('itemIconSrc maps fists and medkit onto HUD art', async () => {
  const { itemIconSrc } = await import('../../src/ui/icons.js');
  assert.ok(itemIconSrc('fists')?.includes('fists'));
  assert.ok(itemIconSrc('medkit')?.includes('meds'));
  assert.equal(itemIconSrc('sidearm'), null);
});

test('every HUD icon ships as a PNG with a real alpha channel', () => {
  // v0.4 shipped these as 1024px JPEGs — a format with NO alpha — and keyed them
  // to transparency in a canvas on every page load. Checking only that a file
  // exists would still pass against that. Check the format and the alpha too.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (const id of ICON_IDS) {
    const file = join(root, 'assets/ui/icons', `${id}.png`);
    assert.ok(existsSync(file), `${id}.png missing`);
    const buf = readFileSync(file);
    assert.equal(buf.slice(1, 4).toString('ascii'), 'PNG', `${id} is not a PNG`);
    // IHDR colour type: 6 = RGBA, 4 = grey+alpha. Byte 25 of a PNG header.
    assert.ok([4, 6].includes(buf[25]), `${id} has no alpha channel (colourType ${buf[25]})`);
    assert.ok(buf.length < 32 * 1024, `${id} is ${(buf.length / 1024) | 0}KB — it renders at 16px`);
  }
  // and the superseded JPEGs are gone, not shipped alongside
  for (const id of ICON_IDS) {
    assert.ok(!existsSync(join(root, 'assets/ui/icons', `${id}.jpg`)), `${id}.jpg still shipped`);
  }
});
