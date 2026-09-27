// @ts-check
// src/sim/bedScene.js — the bed as furniture. No animation beyond sitting and
// reclining; "stay the night" is a fade, one narration line and a time skip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BedScene, bedPrompt, STAY_MINUTES, GUEST_SEAT } from '../../src/sim/bedScene.js';
import { Scheduler } from '../../src/sim/scheduler.js';
import { newRunState } from '../../src/sim/world.js';
import { resetBus, on } from '../../src/core/bus.js';

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

test('invite: a stranger refuses; an ally sits beside you and warms a little', () => {
  resetBus();
  const { p } = ports();
  const b = new BedScene(p);
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
  b.invite(fakeChar('aria', 'ally'));
  assert.deepEqual(b.invite(fakeChar('kai', 'ally')), { ok: false, reason: 'full' });
});

test('stay the night needs trusted', async () => {
  resetBus();
  const b = new BedScene(ports().p);
  assert.deepEqual(await b.stayNight(fakeChar('kai', 'ally')), { ok: false, reason: 'bond' });
});

test('stay the night: fade, narrate, skip 180 min with the scheduler held, then rested', async () => {
  resetBus();
  const { p, calls, player, needs, scheduler } = ports();
  const b = new BedScene(p);
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
