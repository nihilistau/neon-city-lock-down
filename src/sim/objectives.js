// @ts-check
// Mid-run objectives — multi-day goals that give the stretch between the scripted
// day-3 and day-7 beats its own shape, and reward the day-plan actions. Pure
// logic over `run` (+ clock); completion is one-shot and grants a reward.

/**
 * @typedef {Object} Objective
 * @property {string} id @property {string} title @property {string} desc
 * @property {(run:any, clock:any)=>number} progress  0..1
 * @property {(run:any, clock:any)=>boolean} done
 * @property {(run:any)=>string} reward  applied once on completion → short note
 */

/** @type {Objective[]} */
export const OBJECTIVES = [
  {
    id: 'stabilize', title: 'Stabilize the tower',
    desc: 'Get every tower system above 60%.',
    progress: (run) => {
      const sys = Object.values(run.systems);
      return sys.filter((s) => s.hp >= 60).length / sys.length;
    },
    done: (run) => Object.values(run.systems).every((s) => s.hp >= 60),
    reward: (run) => { run.resources.parts += 3; return '+3 parts salvaged'; },
  },
  {
    id: 'stockpile', title: 'Lay in supplies',
    desc: 'Reach day 5 holding 20+ food and 20+ water.',
    progress: (run, clock) => Math.min(1,
      (Math.min(run.resources.food, 20) / 20 + Math.min(run.resources.water, 20) / 20 + Math.min(clock.day, 5) / 5) / 3),
    done: (run, clock) => clock.day >= 5 && run.resources.food >= 20 && run.resources.water >= 20,
    reward: (run) => { run.player.morale = Math.min(100, run.player.morale + 15); return 'the tower breathes easier (+morale)'; },
  },
  {
    id: 'ceasefire', title: 'Broker a ceasefire',
    desc: 'Close two faction deals.',
    progress: (run) => Math.min(1, (run.flags.dealt || 0) / 2),
    done: (run) => (run.flags.dealt || 0) >= 2,
    reward: (run) => { run.flags.ceasefire = true; run.threat = Math.max(0, run.threat - 12); return 'the streets quiet (threat eased)'; },
  },
  {
    id: 'sharpshooter', title: 'Sharpen up',
    desc: 'Train your combat skill to 85.',
    progress: (run) => Math.min(1, ((run.player.skill ?? 60) - 60) / (85 - 60)),
    done: (run) => (run.player.skill ?? 60) >= 85,
    reward: (run) => { run.resources.ammo += 20; return '+20 rounds from the armoury'; },
  },
  {
    id: 'keep_alive', title: 'Keep them alive',
    desc: 'Reach day 6 with Lola, Aria, and Kai still standing.',
    progress: (run, clock) => {
      if (run.flags.lostCast) return Math.min(0.99, (clock.day || 1) / 6);
      return Math.min(1, (clock.day || 1) / 6);
    },
    done: (run, clock) => clock.day >= 6 && !run.flags.lostCast,
    reward: (run) => { run.player.morale = Math.min(100, run.player.morale + 10); return 'everyone is still here (+morale)'; },
  },
  {
    id: 'vox_fondness', title: 'VOX is listening',
    desc: 'Talk to VOX until it flags you as more than a work order.',
    progress: (run) => Math.min(1, (run.flags.voxTalks || 0) / 8),
    done: (run) => (run.flags.voxTalks || 0) >= 8,
    reward: (run) => { run.resources.cells += 2; return 'VOX opens a spare cell locker (+2 cells)'; },
  },
];

/** Ensure run.objectives bookkeeping exists. */
export function initObjectives(run) {
  if (!run.objectives) run.objectives = { done: [] };
}

/**
 * Check for newly-completed objectives, apply their rewards once.
 * @returns {{id:string, title:string, note:string}[]} newly completed
 */
export function updateObjectives(run, clock) {
  initObjectives(run);
  const newly = [];
  for (const o of OBJECTIVES) {
    if (run.objectives.done.includes(o.id)) continue;
    if (o.done(run, clock)) {
      const note = o.reward(run);
      run.objectives.done.push(o.id);
      newly.push({ id: o.id, title: o.title, note });
    }
  }
  return newly;
}

/** State for the UI: each objective with live progress + completion. */
export function objectiveState(run, clock) {
  initObjectives(run);
  return OBJECTIVES.map((o) => ({
    id: o.id, title: o.title, desc: o.desc,
    progress: Math.max(0, Math.min(1, o.progress(run, clock))),
    complete: run.objectives.done.includes(o.id),
  }));
}
