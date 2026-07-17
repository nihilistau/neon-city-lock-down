// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, stem } from '../../src/dialogue/parser/normalize.js';
import { toneOf, dominantTone } from '../../src/dialogue/parser/tone.js';
import { compileLine, TAG_TYPES } from '../../src/dialogue/stageDirections.js';
import { registerIntents, matchIntents, intentRegistry } from '../../src/dialogue/parser/intents.js';

test('normalize expands contractions + flags question/caps', () => {
  const n = normalize("You're an IDIOT, aren't you?");
  assert.ok(n.text.includes('you are'));
  assert.ok(n.text.includes('are not'));
  assert.equal(n.question, true);
});

test('stem reduces common suffixes', () => {
  assert.equal(stem('riots'), 'riot');
  assert.equal(stem('running'), 'runn');
  assert.equal(stem('stories'), 'story');
});

test('tone detects hostility and flirt', () => {
  const hostile = toneOf(normalize('shut up you pathetic coward'));
  assert.ok(hostile.hostility > 0);
  assert.equal(dominantTone(hostile), 'hostility');
  const flirty = toneOf(normalize('come closer i want to kiss you'));
  assert.ok(flirty.flirt > 0);
});

test('compileLine strips tags and records offsets', () => {
  const { cleanText, directions } = compileLine('Hi. [[face:smirk]] Come [[anim:walk]] here.');
  assert.equal(cleanText, 'Hi. Come here.');
  assert.equal(directions.length, 2);
  assert.equal(directions[0].type, 'face');
  assert.deepEqual(directions[0].args, ['smirk']);
  assert.equal(directions[1].type, 'anim');
  // offset points into cleanText, before the collapse of whitespace is fine to be monotonic
  assert.ok(directions[0].at <= directions[1].at);
});

test('compileLine throws on unknown tag', () => {
  assert.throws(() => compileLine('bad [[explode:now]] tag'), /unknown stage tag/);
});

test('compileLine validates arity', () => {
  assert.throws(() => compileLine('[[anim]]'), /needs 1 arg/);
  assert.throws(() => compileLine('[[gate]]'), /needs >=1 arg/);
});

test('every tag type is documented', () => {
  for (const t of ['anim', 'face', 'move', 'sit', 'gate', 'light', 'sfx', 'vox']) {
    assert.ok(t in TAG_TYPES, `${t} missing from TAG_TYPES`);
  }
});

test('intent matcher ranks by weighted score', () => {
  registerIntents([
    { id: 't_flirt', weighted: [['kiss', 2], ['want', 1]], phrases: ['come here'] },
    { id: 't_greet', keywords: ['hi', 'hello'] },
  ]);
  const ranked = matchIntents(normalize('i want to kiss you, come here'));
  assert.equal(ranked[0].id, 't_flirt');
  assert.ok(ranked[0].score > 0);
});
