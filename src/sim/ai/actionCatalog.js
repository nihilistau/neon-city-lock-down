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
      const spots = [
        ['lounge', 'window'], ['lounge', 'center'], ['bar', 'corner'], ['bar', 'center'],
        ['fireplace', 'hearth'], ['vanity', 'center'], ['shower', 'center'], ['balcony', 'rail'],
      ];
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
      n.fun * 0.9 - c.stats.tension * 0.3,
    exec: (c) => {
      c.queue.goto('lounge', 'center');
      c.queue.playClip('dance_sway', 0.5, 30);
    },
    satisfy: { fun: 45, social: 10 },
    statFx: { energy: -5, happiness: 7 },
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
  {
    id: 'fireplace',
    score: (c, n) => n.rest * 0.5 + (100 - c.stats.energy) * 0.2 + (c.stats.tension > 40 ? 10 : 0),
    exec: (c) => {
      c.queue.goto('fireplace', 'hearth');
      c.queue.sit(c.id === 'aria' ? 'armchair1.seat0' : 'armchair0.seat0');
      c.queue.wait(40);
    },
    satisfy: { rest: 25, safety: 10 },
    statFx: { tension: -4, happiness: 2 },
  },
  {
    id: 'rooftop_air',
    score: (c, n, ctx) => n.air * 0.7 - (ctx.threat > 60 ? 30 : 0),
    exec: (c) => {
      c.queue.goto('rooftop', 'edge');
      c.queue.playClip('idle_stand', 0.4, 35);
    },
    satisfy: { air: 55, rest: 8 },
    statFx: { tension: -6, happiness: 3 },
  },
  {
    id: 'sleep',
    score: (c, n, ctx) => {
      const h = (ctx.minuteOfDay ?? 720) / 60;
      const late = (h >= 1 && h < 7) || h >= 22;
      return (c.stats.energy < 35 ? n.rest * 1.1 : 0) + (late ? 18 : 0);
    },
    exec: (c, ctx) => {
      // lie on the bed when nobody (player or guest) is using it; else the window.
      // The brain collects the payoff when the queue drains, so the bed branch
      // waits and then stands — otherwise the sleeper would stay on the mattress.
      if (ctx?.bedFree?.()) { c.queue.sit('bed.lie_center'); c.queue.wait(50); c.queue.stand(); }
      else { c.queue.goto('bed_alcove', 'window'); c.queue.playClip('lounge', 0.5, 50); }
    },
    satisfy: { rest: 60 },
    statFx: { energy: 18, tension: -6 },
  },
  {
    id: 'armoury_check',
    score: (c, n, ctx) => (c.id === 'lola' ? 18 : 4) + ctx.threat * 0.15 + n.safety * 0.2,
    exec: (c) => {
      c.queue.goto('armoury', 'racks');
      c.queue.playClip('idle_confident', 0.4, 28);
    },
    satisfy: { safety: 25 },
    statFx: { tension: -2, dominance: 1 },
  },
  {
    id: 'shower',
    score: (c, n, ctx) => {
      const h = (ctx.minuteOfDay ?? 720) / 60;
      const morning = h >= 7 && h < 10 ? 18 : 0;
      return n.rest * 0.25 + (100 - c.stats.energy) * 0.2 + morning;
    },
    exec: (c) => {
      c.queue.goto('shower', 'pod');
      c.queue.playClip('idle_stand', 0.4, 22);
    },
    satisfy: { rest: 15 },
    statFx: { energy: 4, tension: -3 },
  },
  {
    id: 'vanity',
    score: (c, n, ctx) => {
      const who = c.id === 'aria' || c.id === 'kai' ? 14 : 4;
      const h = (ctx.minuteOfDay ?? 720) / 60;
      const dusk = h >= 17 && h < 21 ? 10 : 0;
      return who + dusk + n.social * 0.15;
    },
    exec: (c) => {
      c.queue.goto('vanity', 'mirror');
      c.queue.playClip('idle_stand', 0.4, 20);
    },
    satisfy: { social: 10, fun: 8 },
    statFx: { openness: 2, happiness: 1 },
  },
  {
    id: 'telescope',
    score: (c, n, ctx) => {
      const h = (ctx.minuteOfDay ?? 720) / 60;
      const night = h >= 20 || h < 5 ? 16 : 4;
      return n.air * 0.4 + night - (ctx.threat > 70 ? 20 : 0);
    },
    exec: (c) => {
      c.queue.goto('balcony', 'telescope_spot');
      c.queue.playClip('idle_stand', 0.4, 28);
    },
    satisfy: { air: 30, fun: 8 },
    statFx: { tension: -3, openness: 2 },
  },
  {
    id: 'garden',
    score: (c, n, ctx) => {
      const who = c.id === 'aria' ? 16 : 5;
      const h = (ctx.minuteOfDay ?? 720) / 60;
      const day = h >= 8 && h < 17 ? 12 : 0;
      return who + day + n.air * 0.2 - (ctx.threat > 55 ? 25 : 0);
    },
    exec: (c) => {
      c.queue.goto('rooftop', 'garden');
      c.queue.playClip('idle_stand', 0.4, 30);
    },
    satisfy: { air: 25, rest: 8 },
    statFx: { happiness: 3, tension: -2 },
  },
];
