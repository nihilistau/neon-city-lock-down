// @ts-check
// World event definitions. Slice ships two (blackout, refugee); the full 16 land
// in Phase 5 with the same schema. Scripts are step lists run by eventRunner's
// vocabulary (vox/news/light/choice/fx/stat/resource/wait/restore).

/**
 * @typedef {Object} EventDef
 * @property {string} id
 * @property {'threat'|'social'|'system'} cls
 * @property {(run:any, clock:any) => number} weight  0 = ineligible
 * @property {number} [cooldownMin]
 * @property {number} [maxPerRun]
 * @property {{minDay?:number, phase?:string[]}} [window]
 * @property {any[]} script
 */

/** @type {Record<string, EventDef>} */
export const EVENTS = {
  blackout: {
    id: 'blackout',
    cls: 'system',
    weight: (run) => (run.systems.power.online ? 8 + run.threat * 0.15 : 0),
    cooldownMin: 400,
    maxPerRun: 3,
    script: [
      { type: 'vox', text: 'Warning. Grid instability detected in sector seven.', bakedId: 'vox.threat' },
      { type: 'news', text: 'GRID FAILURES CASCADE ACROSS MIDTOWN — HOSPITALS ON RESERVE POWER' },
      { type: 'wait', sec: 6 },
      { type: 'sfx', id: 'alarm_hard' },
      { type: 'powerDown' },
      { type: 'vox', text: 'Power grid compromised. Switching to reserve cells. Please remain calm.', bakedId: 'vox.blackout' },
      { type: 'castStats', deltas: { tension: 8, fear: 5 } },
      { type: 'alert', text: 'BLACKOUT — reserve cells engaged', kind: 'danger' },
      { type: 'resource', key: 'cells', amount: -2 },
      { type: 'waitMinutes', minutes: 45 },
      { type: 'powerUp' },
      { type: 'vox', text: 'Primary power restored. Apologies for the inconvenience.' },
      { type: 'castStats', deltas: { tension: -4 } },
      { type: 'news', text: 'TOWER DISTRICTS FLICKER BACK TO LIFE — OFFICIALS BLAME SABOTAGE' },
    ],
  },

  riot_breach: {
    id: 'riot_breach',
    cls: 'threat',
    weight: (run) => (run.threat > 35 ? run.threat * 0.25 : 0),
    cooldownMin: 900,
    maxPerRun: 2,
    window: { minDay: 1, phase: ['dusk', 'night'] },
    script: [
      { type: 'vox', text: 'Warning. Stairwell breach on the penthouse level. Multiple intruders.', },
      { type: 'news', text: 'TOWER BREACHES REPORTED ACROSS THE DISTRICT — DEFEND YOUR FLOORS' },
      { type: 'sfx', id: 'alarm_hard' },
      { type: 'alert', text: 'BREACH — penthouse stairwell', kind: 'danger' },
      { type: 'threatSpike', amount: 12 },
      { type: 'wait', sec: 3 },
      { type: 'combat', count: 2, archetype: 'rioter', spawnAt: [-7, 5] },
      { type: 'castStats', deltas: { tension: 6 } },
    ],
  },

  refugee: {
    id: 'refugee',
    cls: 'social',
    weight: (run) => 6 + run.threat * 0.1 - run.refugees * 4,
    cooldownMin: 700,
    maxPerRun: 2,
    window: { minDay: 1 },
    script: [
      { type: 'sfx', id: 'static_burst' },
      { type: 'vox', text: 'Motion at the reception entrance. One individual. Unarmed, injured, requesting shelter.' },
      { type: 'news', text: 'CROWDS FLEE THE SOUTH BARRICADES — SHELTER SPACE CRITICAL CITYWIDE' },
      {
        type: 'choice',
        prompt: 'Someone is begging at the tower doors — hungry, bleeding, terrified.',
        options: [
          {
            label: 'Let them in',
            steps: [
              { type: 'addRefugee' },
              { type: 'alert', text: 'You opened the doors. One more mouth to feed.', kind: 'info' },
              { type: 'castStat', char: 'aria', deltas: { happiness: 8, trust: 6, loyalty: 4 } },
              { type: 'castStat', char: 'lola', deltas: { tension: 6, trust: -3 } },
              { type: 'playerMorale', amount: 6 },
              { type: 'resource', key: 'meds', amount: -1 },
            ],
          },
          {
            label: 'Turn them away',
            steps: [
              { type: 'alert', text: 'The doors stayed sealed. The screaming faded eventually.', kind: 'danger' },
              { type: 'castStat', char: 'aria', deltas: { happiness: -8, fear: 5, trust: -4 } },
              { type: 'castStat', char: 'lola', deltas: { trust: 3, dominance: 2 } },
              { type: 'playerMorale', amount: -8 },
            ],
          },
        ],
      },
    ],
  },
};
