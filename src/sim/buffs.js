// @ts-check
// Timed player buffs (stims, etc.). Pure over `run`; the world tick expires them.

export const STIM_DURATION = 45; // game-minutes
export const STIM_SKILL = 12;
export const STIM_MORALE = 10;

/**
 * Combat stim: sharper aim, steadier nerve. Refreshes duration if already active
 * without stacking the skill bonus.
 * @param {any} run
 * @param {number} nowMinute
 */
export function applyStim(run, nowMinute) {
  if (run.flags.stimUntil != null && nowMinute < run.flags.stimUntil) {
    run.flags.stimUntil = nowMinute + STIM_DURATION;
    run.player.morale = Math.min(100, run.player.morale + 4);
    return;
  }
  run.player.skill = Math.min(100, (run.player.skill ?? 60) + STIM_SKILL);
  run.player.morale = Math.min(100, run.player.morale + STIM_MORALE);
  run.flags.stimSkillBoost = STIM_SKILL;
  run.flags.stimUntil = nowMinute + STIM_DURATION;
}

/**
 * Expire any timed buffs whose minute has come.
 * @param {any} run
 * @param {number} nowMinute
 */
export function tickBuffs(run, nowMinute) {
  if (run.flags.stimUntil != null && nowMinute >= run.flags.stimUntil) {
    run.player.skill = Math.max(0, (run.player.skill ?? 0) - (run.flags.stimSkillBoost || 0));
    run.flags.stimUntil = null;
    run.flags.stimSkillBoost = 0;
  }
}
