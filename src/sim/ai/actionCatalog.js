// @ts-check
// AI action catalog: each action scores itself against (character, needs, world)
// and executes by pushing ActorQueue commands. `satisfy` applies when the queue
// drains (action completed). Durations are handled by queue waits.

/**
 * @typedef {Object} AiAction
 * @property {string} id
 * @property {(c:any, needs:any, ctx:any) => number} score
 * @property {(c:any, ctx:any) => void} exec
 * @property {Partial<Record<string, number>>} satisfy
 * @property {Partial<Record<string, number>>} [statFx]
 */

/** @type {AiAction[]} */
export const ACTIONS = [
  {
    id: 'sit_couch',
    score: (c, n) => n.rest * 0.8 + (100 - c.stats.energy) * 0.3,
    exec: (c) => {
      const seat = c.id === 'aria' ? 'couch.seat1' : 'couch.seat0';
      c.queue.sit(seat);
      c.queue.wait(50);
    },
    satisfy: { rest: 30 },
    statFx: { energy: 6, tension: -3 },
  },
  {
    id: 'bar_drink',
    score: (c, n, ctx) => n.drink * 0.9 + c.stats.tension * 0.25 - (c.stats.sobriety < 35 ? 40 : 0),
    exec: (c, ctx) => {
      const stool = c.id === 'aria' ? 'stool0.seat0' : 'stool2.seat0';
      c.queue.sit(stool);
      c.queue.call(() => ctx.sfx('pour_drink'));
      c.queue.wait(25);
      c.queue.call(() => ctx.sfx('glass_clink'));
      c.queue.wait(15);
    },
    satisfy: { drink: 45, fun: 10 },
    statFx: { sobriety: -9, openness: 4, tension: -4, happiness: 3 },
  },
  {
    id: 'balcony_air',
    score: (c, n, ctx) => n.air * 0.9 - (ctx.threat > 55 ? 25 : 0) - c.stats.fear * 0.2,
    exec: (c) => {
      c.queue.goto('balcony', 'rail');
      c.queue.playClip('idle_stand', 0.4, 40);
    },
    satisfy: { air: 50, rest: 5 },
    statFx: { tension: -5, happiness: 2 },
  },
  {
    id: 'wander',
    score: (c, n) => 12 + n.fun * 0.2,
    exec: (c, ctx) => {
      const spots = [['lounge', 'window'], ['lounge', 'center'], ['bar', 'corner'], ['bar', 'center']];
      const [zone, wp] = ctx.rng.pick(spots);
      c.queue.goto(zone, wp);
      c.queue.wait(18);
    },
    satisfy: { fun: 10, air: 5 },
  },
  {
    id: 'approach_company',
    score: (c, n, ctx) => {
      const others = ctx.others(c);
      if (!others.length) return 0;
      return n.social * 0.85 + c.stats.happiness * 0.1;
    },
    exec: (c, ctx) => {
      const others = ctx.others(c);
      const target = ctx.rng.pick(others);
      c.queue.goto(target.queue.zone);
      c.queue.look(target.actor.root);
      c.queue.wait(30);
      c.queue.look(null);
    },
    satisfy: { social: 40 },
    statFx: { happiness: 2 },
  },
  {
    id: 'dance',
    score: (c, n) =>
      (c.stats.happiness > 55 || c.stats.sobriety < 60 ? n.fun * 0.7 : 0) +
      c.stats.arousal * 0.15 - c.stats.tension * 0.3,
    exec: (c) => {
      c.queue.goto('lounge', 'center');
      c.queue.playClip('dance_sway', 0.5, 30);
    },
    satisfy: { fun: 45, social: 10 },
    statFx: { energy: -5, happiness: 4, arousal: 3 },
  },
  {
    id: 'brood',
    score: (c, n, ctx) => c.stats.tension * 0.4 + ctx.threat * 0.2 + n.safety * 0.3,
    exec: (c) => {
      c.queue.goto('lounge', 'window');
      c.queue.playClip('gesture_cross_arms', 0.4, 35);
    },
    satisfy: { safety: 30 },
    statFx: { tension: -2 },
  },
];
