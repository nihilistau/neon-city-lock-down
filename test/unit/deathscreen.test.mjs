// @ts-check
// The run summary's Bonds list speaks the bond tier (src/chars/bond.js), not a
// private cold/wary/warm/devoted scale of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** a localStorage stand-in, since these tests run in Node (endRun deletes the autosave) */
const store = new Map();
/** @type {any} */ (globalThis).localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { bondLabel } = await import('../../src/ui/deathScreen.js');
const { endRun } = await import('../../src/sim/death.js');

test('bondLabel shows the tier the summary recorded', () => {
  const summary = { bonds: { lola: 90 }, bondTiers: { lola: 'ally' } };
  // the recorded live tier wins, even where raw trust alone would say more
  assert.equal(bondLabel(summary, 'lola'), 'ally');
});

test('bondLabel derives a tier for older summaries that only carry trust', () => {
  const legacy = { bonds: { a: 10, b: 40, c: 60, d: 90 } };
  assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => bondLabel(legacy, id)),
    ['stranger', 'ally', 'trusted', 'loyal']);
  assert.equal(bondLabel({}, 'nobody'), 'stranger');
});

test('endRun records each character\'s live bond tier alongside raw trust', () => {
  const char = (id, trust, loyalty, bond) => ({ id, alive: true, stats: { trust, loyalty }, bond });
  const app = /** @type {any} */ ({
    run: { history: { kills: 0, choices: [], resourcesSpent: {} }, flags: {}, eventsFired: [] },
    clock: { day: 2, totalMinutes: 1500 },
    cast: {
      lola: char('lola', 70, 60, 'trusted'),
      kai: char('kai', 20, 5, 'stranger'),
      aria: char('aria', 50, 30, undefined),   // no live tier: derived from stats
    },
  });
  const s = endRun(app, 'extracted');
  assert.deepEqual(s.bondTiers, { lola: 'trusted', kai: 'stranger', aria: 'ally' });
  assert.deepEqual(s.bonds, { lola: 70, kai: 20, aria: 50 }, 'raw trust is kept for meta + unlocks');
  assert.equal(bondLabel(s, 'lola'), 'trusted');
});
