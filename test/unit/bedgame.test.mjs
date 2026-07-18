// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BedGame } from '../../src/games/bedGame.js';

// A partner stub carrying only what _willing() reads.
function partner(stats) {
  return {
    stats: {
      arousal: 0, horniness: 0, trust: 0, openness: 30, tension: 0, fear: 0,
      pleasure: 0, ...stats,
    },
    consent: { withdrawn: false, safeword: false },
  };
}

const game = new BedGame({
  cast: () => ({}), explicitness: () => 'full', nowMinute: () => 0,
  rng: { pick: (a) => a[0], int: () => 0, range: () => 0, chance: () => false },
  sfx: () => {},
});

test('a cold, guarded, tense partner is NOT willing to be kissed', () => {
  // Lola-at-start-ish: low arousal, low trust, high tension
  const w = game._willing(partner({ arousal: 8, trust: 18, tension: 42, horniness: 5 }), 'kiss');
  assert.equal(w.willing, false, `score ${w.score} vs need ${w.need}`);
});

test('warming up (arousal up, tension down) makes kiss reachable — the bug fix', () => {
  const w = game._willing(partner({ arousal: 40, horniness: 30, trust: 30, tension: 20, openness: 40 }), 'kiss');
  assert.equal(w.willing, true, `score ${w.score} should clear need ${w.need}`);
});

test('higher tiers demand more desire', () => {
  const p = partner({ arousal: 45, horniness: 35, trust: 35, tension: 18, openness: 45 });
  assert.ok(game._willing(p, 'kiss').willing, 'kiss ok');
  const intimate = game._willing(p, 'intimate');
  assert.ok(intimate.need > game._willing(p, 'kiss').need, 'intimate bar is higher');
});

test('withdrawal/safeword forces unwilling regardless of arousal', () => {
  const p = partner({ arousal: 95, horniness: 95, trust: 90, tension: 0 });
  p.consent.withdrawn = true;
  assert.equal(game._willing(p, 'kiss').willing, false);
});

test('willingness rises with arousal and falls with tension (monotonic knobs)', () => {
  const base = { trust: 30, horniness: 20, openness: 35, fear: 5 };
  const lowA = game._willing(partner({ ...base, arousal: 20, tension: 20 }), 'kiss').score;
  const hiA = game._willing(partner({ ...base, arousal: 60, tension: 20 }), 'kiss').score;
  const hiT = game._willing(partner({ ...base, arousal: 60, tension: 70 }), 'kiss').score;
  assert.ok(hiA > lowA, 'more arousal → more willing');
  assert.ok(hiT < hiA, 'more tension → less willing');
});
