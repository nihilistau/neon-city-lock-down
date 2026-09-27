// @ts-check
// src/sim/bedScene.js — the bed as furniture. No animation beyond sitting and
// reclining; "stay the night" is a fade, one narration line and a time skip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BedScene, bedPrompt, bedUsers, STAY_MINUTES, GUEST_SEAT } from '../../src/sim/bedScene.js';
import { Scheduler } from '../../src/sim/scheduler.js';
import { newRunState } from '../../src/sim/world.js';
import { resetBus, on, emit } from '../../src/core/bus.js';
import { Brain } from '../../src/sim/ai/brain.js';
import { ACTIONS } from '../../src/sim/ai/actionCatalog.js';

function fakeChar(id, tier) {
  const order = ['stranger', 'ally', 'trusted', 'loyal'];
  return {
    id, name: id, alive: true, stats: { happiness: 50, loyalty: 50, tension: 50, trust: 50 },
    bondAtLeast: (t) => order.indexOf(tier) >= order.indexOf(t),
    applied: [], applyStats(d, why) { this.applied.push([d, why]); },
    queue: { log: [], clear() { this.log.push('clear'); }, sit(s) { this.log.push(`sit:${s}`); }, stand() { this.log.push('stand'); } },
  };
}

function ports(over = {}) {
  const calls = { placed: [], released: 0, skipped: 0, fades: [], narrated: [] };
  const player = { morale: 50 };
  const needs = { rest: 80 };
  const scheduler = { hold: false, heldDuringSkip: null };
  const p = {
    placePlayer: (pose) => calls.placed.push(pose),
    releasePlayer: () => { calls.released++; },
    skip: (m) => { calls.skipped += m; scheduler.heldDuringSkip = scheduler.hold; },
    scheduler,
    fade: async (on) => { calls.fades.push(on); },
    narrate: async (t) => { calls.narrated.push(t); },
    narration: (id) => `narration for ${id}`,
    player: () => player,
    brain: () => ({ needs }),
    ...over,
  };
  return { p, calls, player, needs, scheduler };
}

test('prompt text follows the player state', () => {
  assert.equal(bedPrompt('none'), 'Sit on the bed');
  assert.equal(bedPrompt('sitting'), 'Lie down');
  assert.equal(bedPrompt('lying'), 'Get up');
});

test('E cycles sit → lie → get up', () => {
  resetBus();
  const { p, calls } = ports();
  const b = new BedScene(p);
  assert.equal(b.use(), 'sitting');
  assert.equal(b.use(), 'lying');
  assert.equal(b.use(), 'none');
  assert.deepEqual(calls.placed, ['sitting', 'lying']);
  assert.equal(calls.released, 1);
});

test('getUp from sitting releases the player and stands guests up', () => {
  resetBus();
  const { p, calls } = ports();
  const b = new BedScene(p);
  const kai = fakeChar('kai', 'ally');
  b.use();
  b.invite(kai);
  b.getUp();
  assert.equal(b.playerState, 'none');
  assert.equal(calls.released, 1);
  assert.deepEqual(b.guests, []);
  assert.ok(kai.queue.log.includes('stand'));
});

test('invite (player on the bed): a stranger refuses; an ally sits beside you and warms a little', () => {
  resetBus();
  const { p } = ports();
  const b = new BedScene(p);
  b.use();   // invite and stay need the player on the bed
  const lola = fakeChar('lola', 'stranger');
  assert.deepEqual(b.invite(lola), { ok: false, reason: 'bond' });
  assert.equal(lola.queue.log.length, 0);

  const aria = fakeChar('aria', 'ally');
  const events = [];
  on('bedscene.guest', (e) => events.push(e));
  assert.deepEqual(b.invite(aria), { ok: true });
  assert.ok(aria.queue.log.includes(`sit:${GUEST_SEAT}`));
  assert.deepEqual(aria.applied[0][0], { trust: 3, tension: -5 });
  assert.deepEqual(events, [{ id: 'aria', seated: true }]);
  assert.deepEqual(b.invite(aria), { ok: true, reason: 'already' });
});

test('only one guest seat: a second invite is turned away as full', () => {
  resetBus();
  const b = new BedScene(ports().p);
  b.use();   // invite and stay need the player on the bed
  b.invite(fakeChar('aria', 'ally'));
  assert.deepEqual(b.invite(fakeChar('kai', 'ally')), { ok: false, reason: 'full' });
});

test('stay the night needs trusted', async () => {
  resetBus();
  const b = new BedScene(ports().p);
  b.use();   // invite and stay need the player on the bed
  assert.deepEqual(await b.stayNight(fakeChar('kai', 'ally')), { ok: false, reason: 'bond' });
});

test('stay the night: fade, narrate, skip 180 min with the scheduler held, then rested', async () => {
  resetBus();
  const { p, calls, player, needs, scheduler } = ports();
  const b = new BedScene(p);
  b.use();   // invite and stay need the player on the bed
  const aria = fakeChar('aria', 'trusted');
  const seen = [];
  on('bedscene.started', () => seen.push('started'));
  on('bedscene.ended', () => seen.push('ended'));
  const res = await b.stayNight(aria);
  assert.deepEqual(res, { ok: true });
  assert.equal(calls.skipped, STAY_MINUTES);
  assert.equal(scheduler.heldDuringSkip, true, 'no event may fire during the skip');
  assert.equal(scheduler.hold, false, 'released afterwards');
  assert.deepEqual(calls.fades, [true, false]);
  assert.deepEqual(calls.narrated, ['narration for aria']);
  assert.equal(needs.rest, 0);
  assert.equal(player.morale, 60);
  assert.ok(aria.applied.some(([d]) => d.happiness === 8 && d.loyalty === 5 && d.tension === -10));
  assert.deepEqual(seen, ['started', 'ended']);
  assert.equal(b.playerState, 'lying');
  assert.equal(b.busy, false);
});

test('stay the night always releases the scheduler, even if a port throws', async () => {
  resetBus();
  const { p, scheduler } = ports({ skip: () => { throw new Error('boom'); } });
  const b = new BedScene(p);
  b.use();   // invite and stay need the player on the bed
  await assert.rejects(b.stayNight(fakeChar('aria', 'trusted')));
  assert.equal(scheduler.hold, false);
  assert.equal(b.busy, false);
});

test('Scheduler.hold suppresses both queued and rolled events', () => {
  const s = new Scheduler(/** @type {any} */ ({ chance: () => true, weighted: (a) => a[0] }));
  const run = newRunState();
  run.eventQueue.push({ atMinute: 0, eventId: 'x' });
  s.hold = true;
  assert.equal(s.tick(run, { day: 1, minuteOfDay: 0, phase: 'night', totalMinutes: 10 }), null);
  s.hold = false;
  assert.equal(s.tick(run, { day: 1, minuteOfDay: 0, phase: 'night', totalMinutes: 10 }), 'x');
});

test('bed dialogue: a refusal never carries a bed action; the granted line does', async () => {
  await import('../../data/dialogue/bed.js');
  const { getTopic } = await import('../../src/dialogue/topics.js');
  const { selectLine } = await import('../../src/dialogue/selector.js');
  const order = ['stranger', 'ally', 'trusted', 'loyal'];
  const rng = /** @type {any} */ ({ range: () => 0 });
  for (const id of ['lola', 'aria', 'kai']) {
    for (const tier of order) {
      const c = /** @type {any} */ ({
        ...fakeChar(id, tier), memory: { lineUsage: () => ({ count: 0, lastMin: 0 }), hasFlag: () => false },
      });
      const at = (t) => order.indexOf(tier) >= order.indexOf(t);
      const invite = selectLine(getTopic(`${id}.bed.invite`), c, 0, rng);
      assert.equal(invite.bed, at('ally') ? 'invite' : undefined, `${id}/${tier} invite`);
      const stay = selectLine(getTopic(`${id}.bed.stay`), c, 0, rng);
      assert.equal(stay.bed, at('trusted') ? 'stay' : undefined, `${id}/${tier} stay`);
      assert.equal(selectLine(getTopic(`${id}.bed.dismiss`), c, 0, rng).bed, 'dismiss');
    }
  }
});

// ── fix round 1: context gates, holds, reservation, reset ─────────────────

/** A queue that behaves like ActorQueue for bed purposes: commands land in `queue`. */
function realishChar(id, tier = 'ally', seatedAt = null) {
  const c = /** @type {any} */ (fakeChar(id, tier));
  c.queue = {
    log: [], queue: [], current: null, seatedAt,
    clear() { this.log.push('clear'); this.queue.length = 0; this.current = null; },
    gotoSocket(s) { this.queue.push({ type: 'gotoSocket', args: [s] }); },
    sit(s) { this.gotoSocket(s); this.queue.push({ type: 'sit', args: [s] }); },
    stand() { this.log.push('stand'); this.queue.push({ type: 'stand', args: [] }); },
    standNow() { this.log.push('standNow'); this.seatedAt = null; },
    wait(n) { this.queue.push({ type: 'wait', args: [n] }); },
    goto(z, w) { this.queue.push({ type: 'goto', args: [z, w] }); },
    playClip(clip) { this.queue.push({ type: 'playClip', args: [clip] }); },
    call(fn) { this.queue.push({ type: 'call', args: [fn] }); },
  };
  return c;
}

test('invite and stay need the player on the bed', async () => {
  resetBus();
  const b = new BedScene(ports().p);
  const aria = fakeChar('aria', 'trusted');
  assert.deepEqual(b.invite(aria), { ok: false, reason: 'player' });
  assert.deepEqual(await b.stayNight(aria), { ok: false, reason: 'player' });
  assert.equal(aria.queue.log.length, 0, 'a refusal moves nobody');
  assert.deepEqual(b.guests, []);
});

test('asking a second character to stay makes the current guest give up the seat', async () => {
  resetBus();
  const b = new BedScene(ports().p);
  b.use();
  const kai = fakeChar('kai', 'ally');
  const aria = fakeChar('aria', 'trusted');
  b.invite(kai);
  assert.deepEqual(await b.stayNight(aria), { ok: true });
  assert.deepEqual(b.guests, ['aria']);
  assert.ok(kai.queue.log.includes('stand'));
});

test('dismiss is ignored during the stay-the-night fade', async () => {
  resetBus();
  /** @type {() => void} */
  let release = () => {};
  const gate = new Promise((r) => { release = () => r(undefined); });
  const b = new BedScene(ports({ narrate: () => gate }).p);
  b.use();
  const aria = fakeChar('aria', 'trusted');
  const stay = b.stayNight(aria);
  await new Promise((r) => setImmediate(r));
  assert.equal(b.busy, true);
  b.dismiss(aria);
  assert.deepEqual(b.guests, ['aria'], 'no dismissing under the black');
  release();
  await stay;
});

for (const phase of ['fade', 'narrate']) {
  test(`a load (reset) during the stay-the-night ${phase} aborts it: no skip, no stats, no re-placing`, async () => {
    resetBus();
    /** @type {() => void} */
    let release = () => {};
    const gate = new Promise((r) => { release = () => r(undefined); });
    const over = phase === 'fade'
      ? { fade: (on) => { calls.fades.push(on); return on ? gate : Promise.resolve(); } }
      : { narrate: () => gate };
    const made = ports(over);
    const { p, player, needs, scheduler } = made;
    const calls = made.calls;
    const b = new BedScene(p);
    b.use();   // sitting
    const aria = fakeChar('aria', 'trusted');
    const stay = b.stayNight(aria);
    await new Promise((r) => setImmediate(r));
    assert.equal(b.busy, true);
    const placedBefore = calls.placed.length;
    b.reset();   // applySave
    const appliedBefore = aria.applied.length;
    release();
    assert.deepEqual(await stay, { ok: false, reason: 'reset' });
    assert.equal(calls.skipped, 0, 'no clock skip over the loaded save');
    assert.equal(player.morale, 50, 'no morale applied');
    assert.equal(needs.rest, 80, 'no rest applied');
    assert.equal(aria.applied.length, appliedBefore, 'no bed:stay stats applied');
    assert.ok(!aria.applied.some(([, why]) => why === 'bed:stay'));
    assert.equal(calls.placed.length, placedBefore, 'player not re-placed after the load');
    assert.equal(b.playerState, 'none');
    assert.equal(b.busy, false);
    assert.equal(scheduler.hold, false);
    assert.equal(calls.fades.at(-1), false, 'still fades back in');
  });
}

test('a guest who dies frees the seat; combat gets every guest up', () => {
  resetBus();
  const b = new BedScene(ports().p);
  b.use();
  const aria = realishChar('aria');
  b.invite(aria);
  aria.alive = false;
  emit('char.died', { id: 'aria' });
  assert.deepEqual(b.guests, [], 'the dead do not keep the seat');
  const kai = realishChar('kai');
  assert.deepEqual(b.invite(kai), { ok: true }, 'and the seat is free again');
  emit('combat.started', {});
  assert.deepEqual(b.guests, []);
  assert.ok(kai.queue.log.includes('standNow'));
});

test('reset (load) clears everything even while standing, seatedAt included', () => {
  resetBus();
  const { p, calls } = ports();
  const aria = realishChar('aria');
  const b = new BedScene({ ...p, others: () => [aria] });
  b.use();
  b.invite(aria);
  aria.queue.seatedAt = GUEST_SEAT;   // she reached the seat
  b.playerState = 'none';             // standing: getUp() would be a no-op here
  b.busy = true;
  b.reset();
  assert.deepEqual(b.guests, []);
  assert.equal(b.busy, false);
  assert.equal(aria.queue.seatedAt, null, 'standing up clears seatedAt immediately');
  assert.equal(b.isFree(), true);
  // and from lying: the player is released
  b.use(); b.use();
  b.reset();
  assert.equal(b.playerState, 'none');
  assert.equal(calls.released, 1);
});

test('sleep reserves the bed: two sleep decisions in the same minute, one bed', () => {
  resetBus();
  const lola = realishChar('lola');
  const kai = realishChar('kai');
  const b = new BedScene({ ...ports().p, others: () => [lola, kai] });
  const sleep = /** @type {any} */ (ACTIONS.find((a) => a.id === 'sleep'));
  const ctx = { bedFree: () => b.isFree() };
  sleep.exec(lola, ctx);
  sleep.exec(kai, ctx);
  assert.ok(lola.queue.queue.some((c) => c.type === 'sit' && c.args[0] === 'bed.lie_center'), 'the first sleeper takes the bed');
  assert.ok(!kai.queue.queue.some((c) => String(c.args?.[0]).startsWith('bed.')), 'the second goes to the window');
  assert.deepEqual(bedUsers([lola, kai]).map((c) => c.id), ['lola']);
});

test('sitting down makes an NPC sleeper get up and leave the bed', () => {
  resetBus();
  const lola = realishChar('lola', 'ally', 'bed.lie_center');
  const b = new BedScene({ ...ports().p, others: () => [lola] });
  const evicted = [];
  on('bedscene.evicted', (e) => evicted.push(e.id));
  b.use();
  assert.equal(lola.queue.seatedAt, null);
  assert.deepEqual(evicted, ['lola']);
});

/** @param {any} char */
function brainFor(char) {
  return new Brain(char, /** @type {any} */ ({
    rng: { range: () => 0, next: () => 0.5 },
    others: () => [], threat: () => 0, sfx: () => {}, combatActive: () => false,
  }));
}

test('a held brain does not act, and the hold is never saved', () => {
  const mk = () => {
    const c = realishChar('aria');
    c.stats = { happiness: 50, openness: 50, dominance: 50, trust: 50, tension: 50, energy: 20, sobriety: 80, loyalty: 50, fear: 20 };
    c.queue.busy = false;
    c.memory = { hasFlag: () => false };
    return c;
  };
  const free = mk();
  brainFor(free).tick(10, 1);
  assert.ok(free.queue.queue.length > 0, 'control: an unheld brain picks an action');

  const held = mk();
  const hb = brainFor(held);
  hb.hold();
  hb.tick(10, 1);
  assert.equal(held.queue.queue.length, 0, 'held: nothing is queued');
  assert.equal(JSON.stringify(hb.serialize()).includes('held'), false, 'the hold is not serialized');
  // a load restores into a fresh brain — no hold comes back with it
  const loaded = brainFor(mk());
  loaded.deserialize(JSON.parse(JSON.stringify(hb.serialize())));
  assert.equal(loaded._held, false);
  hb.release();
  hb.tick(11, 1);
  assert.ok(held.queue.queue.length > 0, 'released: it acts again');
});

test('everyday chat does not trigger the bed intents; bed phrasings still do', async () => {
  await import('../../data/dialogue/intents.js');
  await import('../../data/dialogue/games.js');
  await import('../../data/dialogue/bed.js');
  const { matchIntents } = await import('../../src/dialogue/parser/intents.js');
  const { normalize } = await import('../../src/dialogue/parser/normalize.js');
  const top = (t) => matchIntents(normalize(t))[0]?.id;
  for (const t of ['what are we doing tonight?', 'stay with me, we need to guard the door', 'come here', 'come here, look at this',
    'im going to bed', 'where is the bed', 'nice bed', 'the bed alcove is clear', 'you should get some rest']) {
    assert.ok(!['bed_stay', 'bed_invite', 'bed_dismiss'].includes(top(t)), `"${t}" must not be a bed intent (got ${top(t)})`);
  }
  assert.equal(top('stay the night'), 'bed_stay');
  assert.equal(top('come sit with me'), 'bed_invite');
  assert.equal(top('come sit on the bed'), 'bed_invite');
  assert.equal(top('goodnight'), 'bed_dismiss');
  assert.equal(top('you can go'), 'bed_dismiss');
});

test('the save menu refuses to open during the stay-the-night fade', async () => {
  resetBus();
  const hadDoc = 'document' in globalThis;
  const prevDoc = globalThis.document;
  // @ts-ignore — the menu only registers a keydown listener at construction
  globalThis.document = { addEventListener() {} };
  try {
    const { SaveMenu } = await import('../../src/ui/saveMenu.js');
    const alerts = [];
    on('hud.alert', (a) => alerts.push(a));
    const app = /** @type {any} */ ({ bedScene: { busy: true }, loop: { pause() { throw new Error('paused'); } } });
    const menu = new SaveMenu(app);
    menu.toggle();
    assert.equal(menu.open, false, 'no loading over the black');
    assert.equal(alerts.length, 1);
  } finally {
    // @ts-ignore
    if (hadDoc) globalThis.document = prevDoc; else delete globalThis.document;
  }
});
