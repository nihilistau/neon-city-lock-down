// @ts-check
// Dinner (19:00) and sleep-peel (01:00) — once per calendar day, skippable scenes.

export const DINNER_MINUTE = 19 * 60;
export const SLEEP_MINUTE = 60;

/**
 * Minutes until hh:mm, wrapping past midnight.
 * @param {{minuteOfDay:number}} clock
 */
export function minutesUntil(clock, hh, mm = 0) {
  const target = hh * 60 + mm;
  let d = target - clock.minuteOfDay;
  if (d <= 0) d += 1440;
  return d;
}

/** @param {any} run @param {{day:number}} clock */
export function shouldDinner(run, clock) {
  if ((clock.day ?? 0) < 1) return false;
  const seen = run.flags?.dinnerOn || {};
  return !seen[clock.day];
}

/** @param {any} run @param {{day:number}} clock */
export function markDinner(run, clock) {
  run.flags.dinnerOn = run.flags.dinnerOn || {};
  run.flags.dinnerOn[clock.day] = true;
}

/** @param {any} run @param {{day:number}} clock */
export function shouldSleep(run, clock) {
  if ((clock.day ?? 0) < 1) return false;
  const seen = run.flags?.sleepOn || {};
  return !seen[clock.day];
}

/** @param {any} run @param {{day:number}} clock */
export function markSleep(run, clock) {
  run.flags.sleepOn = run.flags.sleepOn || {};
  run.flags.sleepOn[clock.day] = true;
}

/**
 * After 22:00 or between 01:00–07:00, sleep outscores dance/drink.
 * @param {number} minuteOfDay @param {string} actionId
 */
export function nightScoreMul(minuteOfDay, actionId) {
  const h = minuteOfDay / 60;
  const late = (h >= 1 && h < 7) || h >= 22;
  if (!late) return 1;
  if (actionId === 'sleep') return 3;
  if (actionId === 'dance' || actionId === 'bar_drink') return 0.2;
  return 1;
}
