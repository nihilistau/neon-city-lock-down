// @ts-check
// src/core/userContent.js — the Creation Kit's loader. Its whole promise is
// FAIL-SOFT: user-authored files are validated and registered one at a time, a
// bad one is collected as an error and skipped, and nothing a user writes can
// stop the game booting or corrupt the shipped content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadUserContent, registerUserItem, userCutscenes, userIndex } from '../../src/core/userContent.js';
import { SCENARIOS } from '../../data/scenarios.js';
import { EVENTS } from '../../data/events.js';
import { getTopic, topicsFor, unregisterTopic } from '../../src/dialogue/topics.js';
import { on } from '../../src/core/bus.js';

/** a fetch stand-in over an in-memory file table */
function fakeFetch(index, files = {}, opts = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (url === '/api/user') {
      if (opts.indexThrows) throw new Error('ECONNREFUSED');
      if (opts.indexStatus && opts.indexStatus !== 200) return { ok: false, status: opts.indexStatus };
      return { ok: true, status: 200, json: async () => index };
    }
    const key = url.replace('/api/user/', '');
    if (!(key in files)) return { ok: false, status: 404 };
    const body = files[key];
    return { ok: true, status: 200, json: async () => { if (body === '<<badjson>>') throw new SyntaxError('Unexpected token'); return body; } };
  };
  impl.calls = calls;
  return impl;
}

const scenario = (id) => ({ id, title: `T ${id}`, blurb: 'b', lighting: 'neon_night' });
const event = (id) => ({ id, script: [{ type: 'alert', text: 'hi' }] });
const dialogueTopic = (id) => ({
  id, char: 'lola', lines: [{ text: 'A line with no tags.' }],
});

/** keep the shared registries clean between tests */
function cleanup(ids = {}) {
  for (const id of ids.scenarios || []) delete SCENARIOS[id];
  for (const id of ids.events || []) delete EVENTS[id];
  for (const name of ids.cutscenes || []) userCutscenes.delete(name);
  for (const id of ids.topics || []) unregisterTopic(id);
  userIndex.scenarios.length = 0; userIndex.events.length = 0;
  userIndex.cutscenes.length = 0; userIndex.dialogue.length = 0;
  userIndex.errors = [];
}

test('a well-formed pack registers into the live game', async () => {
  const builtInScenarios = Object.keys(SCENARIOS).length;
  const seen = [];
  const off = on('usercontent.loaded', (p) => seen.push(p));

  const fetchImpl = fakeFetch(
    { scenarios: ['my_night'], events: ['my_event'], cutscenes: ['my_scene'], dialogue: ['my_topic'] },
    {
      'scenarios/my_night.json': scenario('user_night'),
      'events/my_event.json': { ...event('user_event'), weight: 7 },
      'cutscenes/my_scene.json': [{ type: 'titleCard', text: 'ONE' }, { type: 'wait', sec: 0 }],
      'dialogue/my_topic.json': dialogueTopic('lola.user.hello'),
    });
  const out = await loadUserContent(/** @type {any} */ (fetchImpl));
  off();

  assert.deepEqual(out.errors, [], 'a clean pack must produce no errors');
  assert.ok(SCENARIOS.user_night, 'the scenario is playable');
  assert.equal(SCENARIOS.user_night.title, 'T user_night');
  assert.ok(EVENTS.user_event, 'the event is schedulable');
  assert.deepEqual(userCutscenes.get('my_scene')?.[0], { type: 'titleCard', text: 'ONE' });
  assert.ok(getTopic('lola.user.hello'), 'the topic is in the dialogue registry');
  assert.ok(topicsFor('lola').some((t) => t.id === 'lola.user.hello'), 'and indexed under its character');
  assert.ok(getTopic('lola.user.hello').lines[0].compiled, 'line text is compiled on registration');

  assert.deepEqual(out.scenarios, ['user_night']);
  assert.deepEqual(out.events, ['user_event']);
  assert.deepEqual(out.cutscenes, ['my_scene']);
  assert.deepEqual(out.dialogue, ['my_topic']);
  assert.equal(seen.length, 1, 'the kit panel is told exactly once');
  assert.equal(Object.keys(SCENARIOS).length, builtInScenarios + 1, 'built-ins are untouched');
  assert.ok(SCENARIOS.first_night, 'and still there');

  // a user event's numeric weight becomes the (run)=>number the scheduler calls
  assert.equal(typeof EVENTS.user_event.weight, 'function');
  assert.equal(EVENTS.user_event.weight({ threat: 0 }), 7);
  assert.equal(EVENTS.user_event.weight({ threat: 80 }), 7, 'no scale → flat weight');
  assert.equal(EVENTS.user_event.weight(undefined), 7, 'the scheduler may call it bare');

  cleanup({ scenarios: ['user_night'], events: ['user_event'], cutscenes: ['my_scene'], topics: ['lola.user.hello'] });
});

test('one broken file does not take the others — or the boot — down with it', async () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...a) => warned.push(a);

  const fetchImpl = fakeFetch(
    { scenarios: ['good', 'no_id', 'no_title'], events: ['good_ev', 'no_script', 'missing'], cutscenes: ['not_a_list'], dialogue: ['bad_topic'] },
    {
      'scenarios/good.json': scenario('ok_scenario'),
      'scenarios/no_id.json': { title: 'nameless' },
      'scenarios/no_title.json': { id: 'untitled' },
      'events/good_ev.json': event('ok_event'),
      'events/no_script.json': { id: 'scriptless' },
      // events/missing.json deliberately absent → http 404
      'cutscenes/not_a_list.json': { nope: true },
      'dialogue/bad_topic.json': { id: 'lola.user.broken' },   // no lines[] → topic() throws
    });
  const out = await loadUserContent(/** @type {any} */ (fetchImpl));
  console.warn = realWarn;

  assert.ok(SCENARIOS.ok_scenario, 'the good scenario still registered');
  assert.ok(EVENTS.ok_event, 'the good event still registered');
  assert.equal(SCENARIOS.untitled, undefined, 'a title-less scenario is not registered');
  assert.equal(EVENTS.scriptless, undefined, 'a script-less event is not registered');
  assert.equal(userCutscenes.has('not_a_list'), false);
  assert.equal(getTopic('lola.user.broken'), undefined);

  const byName = Object.fromEntries(out.errors.map((e) => [`${e.cat}/${e.name}`, e.error]));
  assert.equal(out.errors.length, 6, `expected 6 collected errors, got ${JSON.stringify(out.errors)}`);
  assert.match(byName['scenarios/no_id'], /id \+ title/);
  assert.match(byName['scenarios/no_title'], /id \+ title/);
  assert.match(byName['events/no_script'], /id \+ script/);
  assert.match(byName['events/missing'], /http 404/, 'a missing file is an error, not a crash');
  assert.match(byName['cutscenes/not_a_list'], /steps\[\] array/);
  assert.ok(byName['dialogue/bad_topic'], 'a malformed topic is caught');
  assert.equal(warned.length, 6, 'every skip is reported to the console too');

  assert.deepEqual(out.scenarios, ['ok_scenario']);
  assert.deepEqual(out.events, ['ok_event']);
  cleanup({ scenarios: ['ok_scenario'], events: ['ok_event'] });
});

test('a hostile or absent index cannot stop the game booting', async () => {
  // no server at all (plain file:// play) — loadUserContent has nothing to fetch
  assert.equal(await loadUserContent(/** @type {any} */ (null)), userIndex);

  // the API is down
  const down = await loadUserContent(/** @type {any} */ (fakeFetch({}, {}, { indexThrows: true })));
  assert.deepEqual(down.errors, []);

  // the API answers, badly
  const notFound = await loadUserContent(/** @type {any} */ (fakeFetch({}, {}, { indexStatus: 500 })));
  assert.deepEqual(notFound.errors, []);

  // the index itself is garbage: wrong types, unknown categories, junk names
  const junk = fakeFetch(
    { scenarios: 'not-an-array', events: null, cutscenes: 42, dialogue: undefined, secrets: ['x'] }, {});
  const out = await loadUserContent(/** @type {any} */ (junk));
  assert.deepEqual(out.errors, [], 'a malformed index is tolerated, not fatal');
  assert.ok(!junk.calls.some((u) => u.includes('secrets')), 'unknown categories are never fetched');
  assert.deepEqual(junk.calls, ['/api/user'], 'and nothing else is requested');

  // errors from a previous load do not linger
  const realWarn = console.warn;
  console.warn = () => {};
  const failing = await loadUserContent(/** @type {any} */ (fakeFetch({ events: ['bad'] }, { 'events/bad.json': { id: 'x' } })));
  console.warn = realWarn;
  assert.equal(failing.errors.length, 1);
  const clean = await loadUserContent(/** @type {any} */ (fakeFetch({}, {})));
  assert.deepEqual(clean.errors, [], 'each load reports only its own errors');
  cleanup();
});

test('registerUserItem: threat-scaled weights, re-saving a topic, and unknown categories', () => {
  // the kit re-saves the same topic as the author edits it; registerTopics throws
  // on a duplicate id, so registration has to be idempotent or the second save
  // of every topic would fail.
  registerUserItem('dialogue', 'pack', dialogueTopic('lola.user.edit'));
  assert.equal(getTopic('lola.user.edit').lines[0].text, 'A line with no tags.');
  registerUserItem('dialogue', 'pack', { ...dialogueTopic('lola.user.edit'), lines: [{ text: 'Edited line.' }] });
  assert.equal(getTopic('lola.user.edit').lines[0].text, 'Edited line.', 're-saving must replace, not throw');
  assert.equal(topicsFor('lola').filter((t) => t.id === 'lola.user.edit').length, 1, 'and must not duplicate');
  assert.deepEqual(userIndex.dialogue, ['pack'], 'the index lists the file once');

  // an array of topics in one file is accepted too
  registerUserItem('dialogue', 'pack2', [dialogueTopic('lola.user.a'), dialogueTopic('lola.user.b')]);
  assert.ok(getTopic('lola.user.a') && getTopic('lola.user.b'));

  // weightThreatScale makes an event more likely as the tower heats up
  registerUserItem('events', 'scaled', { ...event('scaled_event'), weight: 2, weightThreatScale: 0.1 });
  const w = EVENTS.scaled_event.weight;
  assert.equal(w({ threat: 0 }), 2);
  assert.equal(w({ threat: 50 }), 7);
  assert.ok(w({ threat: 100 }) > w({ threat: 50 }), 'monotonic in threat');
  registerUserItem('events', 'neg', { ...event('neg_event'), weight: 1, weightThreatScale: -1 });
  assert.equal(EVENTS.neg_event.weight({ threat: 100 }), 0, 'weight can never go negative');

  // a cutscene may be a bare array or {steps}
  registerUserItem('cutscenes', 'bare', [{ type: 'titleCard', text: 'X' }]);
  registerUserItem('cutscenes', 'wrapped', { steps: [{ type: 'titleCard', text: 'Y' }] });
  assert.equal(userCutscenes.get('bare').length, 1);
  assert.equal(userCutscenes.get('wrapped')[0].text, 'Y');

  assert.throws(() => registerUserItem('secrets', 'x', {}), /unknown category secrets/);
  assert.throws(() => registerUserItem('scenarios', 'x', { id: 'only_id' }), /id \+ title/);
  assert.throws(() => registerUserItem('events', 'x', { id: 'e', script: 'not an array' }), /script\[\]/);
  assert.throws(() => registerUserItem('cutscenes', 'x', { steps: 'nope' }), /steps\[\] array/);

  cleanup({
    events: ['scaled_event', 'neg_event'], cutscenes: ['bare', 'wrapped'],
    topics: ['lola.user.edit', 'lola.user.a', 'lola.user.b'],
  });
});
