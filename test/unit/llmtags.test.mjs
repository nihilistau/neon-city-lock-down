// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTags, scrubPuppeting, cleanReply } from '../../src/dialogue/llm/tags.js';
import { compileLine } from '../../src/dialogue/stageDirections.js';

test('valid tags survive; the result compiles without throwing', () => {
  const raw = 'Come here. [[move:bar]] [[face:smirk]] [[stat:arousal+8]]';
  const clean = sanitizeTags(raw);
  assert.ok(clean.includes('[[move:bar]]'));
  assert.ok(clean.includes('[[face:smirk]]'));
  assert.ok(clean.includes('[[stat:arousal+8]]'));
  assert.doesNotThrow(() => compileLine(clean));
});

test('unknown tags are dropped so compileLine never throws', () => {
  const raw = 'Hi [[prop:champagne]] [[teleport:moon]] [[remember:they like gin]] there.';
  const clean = sanitizeTags(raw);
  assert.ok(!/\[\[/.test(clean), `no tags should remain: ${clean}`);
  assert.doesNotThrow(() => compileLine(clean));
});

test('alias tags map onto the real vocabulary', () => {
  assert.equal(sanitizeTags('[[emote:happy]]'), '[[face:smile]]');
  assert.equal(sanitizeTags('[[anim:beckon]]'), '[[anim:gesture_lean_in]]');
  assert.equal(sanitizeTags('[[move:bedroom]]'), '[[move:bed_alcove]]');
  assert.equal(sanitizeTags('[[coverage:full]]'), '[[outfit:evening_wear]]');
});

test('invalid anim/move values are dropped, not passed through', () => {
  assert.equal(sanitizeTags('[[anim:backflip]]'), '');
  assert.equal(sanitizeTags('[[move:mars]]'), '');
});

test('the retired consent/gate tags are dropped entirely', () => {
  assert.equal(sanitizeTags('hi [[consent:kiss]] [[gate:offer:kiss]]'), 'hi');
});

test('scrubPuppeting strips a prepended speaker label and guest-puppeting actions', () => {
  const out = scrubPuppeting('Lola: "Fine." *You take her hand and follow her.*', { otherNames: ['Aria Chen'] });
  assert.ok(!/^Lola:/.test(out));
  assert.ok(!/take her hand/i.test(out), `guest action should be gone: ${out}`);
  assert.ok(/Fine/.test(out));
});

test('scrubPuppeting removes another cast member speaking', () => {
  const out = scrubPuppeting('"Deal." Aria said, sliding closer.', { otherNames: ['Aria Chen', 'Kai Mercer'] });
  assert.ok(!/Aria said/i.test(out), out);
});

test('cleanReply is compile-safe on messy real-world output', () => {
  const raw = '```\nLola: "Sit." [[anim:sit_chair]] [[mood:cold]] *you obey instantly* [[hack:mainframe]]\n```';
  const clean = cleanReply(raw, { otherNames: ['Aria'] });
  assert.doesNotThrow(() => compileLine(clean));
  assert.ok(clean.includes('[[anim:sit_relaxed]]'));
});
