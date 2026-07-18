// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, CONFIG_SCHEMA } from '../../data/configSchema.js';
import { CONFIG_DEFAULTS } from '../../data/configDefaults.js';
import { cfg, applyConfig, getConfig, _setConfigStore } from '../../src/core/config.js';

test('defaults satisfy their own schema (no drift)', () => {
  for (const group of Object.keys(CONFIG_DEFAULTS)) {
    assert.deepEqual(validateConfig(group, CONFIG_DEFAULTS[group]), [], `${group} defaults invalid`);
  }
});

test('every schema group has defaults and vice versa', () => {
  assert.deepEqual(Object.keys(CONFIG_SCHEMA).sort(), Object.keys(CONFIG_DEFAULTS).sort());
});

test('validateConfig accepts a valid partial', () => {
  assert.deepEqual(validateConfig('camera', { walkSpeed: 3.2, thirdPerson: { shoulderDist: 3 } }), []);
});

test('validateConfig rejects out-of-range numbers', () => {
  const errs = validateConfig('camera', { walkSpeed: 999 });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /walkSpeed: 999 > max/);
});

test('validateConfig rejects unknown keys and wrong types', () => {
  assert.match(validateConfig('camera', { nope: 1 })[0], /unknown key/);
  assert.match(validateConfig('camera', { walkSpeed: 'fast' })[0], /expected number/);
});

test('validateConfig checks array length and map values', () => {
  assert.match(validateConfig('camera', { rig: { target: [0, 1] } })[0], /expected length 3/);
  assert.match(validateConfig('combat', { magSize: { smg: 0 } })[0], /< min/);
});

test('applyConfig merges valid edits into the live store; cfg reads them', () => {
  _setConfigStore(structuredClone(CONFIG_DEFAULTS));
  assert.equal(cfg('camera.walkSpeed'), 2.6);
  assert.deepEqual(applyConfig('camera', { walkSpeed: 4 }), []);
  assert.equal(cfg('camera.walkSpeed'), 4);
  // untouched keys keep defaults (deep merge)
  assert.equal(cfg('camera.runSpeed'), 4.4);
});

test('applyConfig rejects invalid edits without mutating the store', () => {
  _setConfigStore(structuredClone(CONFIG_DEFAULTS));
  const errs = applyConfig('camera', { walkSpeed: 999 });
  assert.ok(errs.length);
  assert.equal(cfg('camera.walkSpeed'), 2.6);   // unchanged
});

test('cfg returns fallback for missing paths', () => {
  _setConfigStore(structuredClone(CONFIG_DEFAULTS));
  assert.equal(cfg('camera.nope.deep', 'x'), 'x');
  assert.equal(getConfig().camera.eye, 1.62);
});
