// @ts-check
// Applies a chosen line's effects atomically: stat deltas (through Character →
// stats.js coupling), flags, memory, gate offers/grants, tone side-effects.

import { emit } from '../core/bus.js';

/**
 * @param {import('../chars/character.js').Character} char
 * @param {any} line chosen line (may carry .fx)
 * @param {any} topic parent topic (may carry .effects)
 * @param {{tone:any, nowMinute:number}} ctx
 */
export function applyLineEffects(char, line, topic, ctx) {
  // 1. line-local stat fx
  if (line.fx) char.applyStats(line.fx, `line:${line._key}`);

  // 2. topic-level effects
  const eff = topic.effects;
  if (eff) {
    if (eff.stat) char.applyStats(eff.stat, `topic:${topic.id}`);
    if (eff.setFlag) char.memory.setFlag(eff.setFlag);
    if (eff.clearFlag) char.memory.clearFlag(eff.clearFlag);
    if (eff.fact) for (const [k, v] of Object.entries(eff.fact)) char.memory.fact(k, v);
    if (eff.counter) char.memory.bump(eff.counter);
    if (eff.gate) {
      // eff.gate = { tier, action }
      char.gate(eff.gate.tier, eff.gate.action, ctx.nowMinute);
    }
  }

  // 3. tone side-effects — hostile/affectionate tone bleeds into stats
  //    regardless of what topic matched (mind games have real cost)
  const tn = ctx.tone;
  if (tn) {
    const bleed = {};
    if (tn.hostility > 0.2) { bleed.tension = tn.hostility * 6; bleed.trust = -tn.hostility * 3; bleed.fear = tn.hostility * 2; }
    if (tn.affection > 0.2) { bleed.trust = (bleed.trust || 0) + tn.affection * 3; bleed.happiness = tn.affection * 2; bleed.tension = (bleed.tension || 0) - tn.affection * 2; }
    if (tn.flirt > 0.2) { bleed.arousal = tn.flirt * 4; bleed.horniness = tn.flirt * 3; }
    if (tn.command > 0.3) { bleed.tension = (bleed.tension || 0) + tn.command * 2; }
    if (Object.keys(bleed).length) char.applyStats(bleed, 'tone');
  }

  // 4. record + topic memory
  char.memory.recordLine(line._key, ctx.nowMinute);
  char.memory.recordTopic(topic.id);

  emit('dialogue.effects', { id: char.id, topic: topic.id, line: line._key });
}
