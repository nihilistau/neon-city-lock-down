// @ts-check
import { STAY_CUTSCENE } from './cutscenes/stay.js';
import { SHUTTLE_CUTSCENE } from './cutscenes/shuttle.js';

// World event definitions — 28 events (blackout, riot_breach, supply_drop,
// faction_envoy, drone_strike, kitchen_fire, water_failure, med_emergency,
// looter, curfew_flyover, courier_offer, defence_misfire, news_bombshell,
// elevator_stranger, emp_wavefront, extraction_offer, refugee, kai_radio,
// garden_blight, sniper_nest, stay_quiet, stay_last). Each `script` is
// a step list run by eventRunner's step vocabulary (see docs/event-catalog.md).
// Weighted-random via the scheduler; extraction_offer / stay_* are scheduled-only (weight 0).

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
      { type: 'combat', spawnAt: [-7, 5],
        waves: [{ count: 2, archetype: 'rioter' }, { count: 2, archetype: 'merc' }] },
      { type: 'runFlag', flag: 'survived_breach', value: true },
      { type: 'castFlag', flag: 'survived_breach' },
      { type: 'castStats', deltas: { tension: 6 } },
    ],
  },

  supply_drop: {
    id: 'supply_drop', cls: 'social',
    weight: (run) => 7 - run.threat * 0.03,
    cooldownMin: 800, maxPerRun: 2,
    script: [
      { type: 'sfx', id: 'static_burst' },
      { type: 'vox', text: 'Incoming drone. Small. Cargo profile. It is requesting balcony clearance.' },
      { type: 'choice', prompt: 'A battered courier drone hovers at the balcony rail with an unmarked crate.',
        options: [
          { label: 'Take the crate', steps: [
            { type: 'sfx', id: 'elevator_ding' },
            { type: 'resource', key: 'food', amount: 6 }, { type: 'resource', key: 'meds', amount: 2 },
            { type: 'alert', text: 'Supplies secured — but someone knows this address.', kind: 'info' },
            { type: 'threatSpike', amount: 6 },
          ]},
          { label: 'Wave it off', steps: [
            { type: 'alert', text: 'The drone dips and vanishes into the smoke.', kind: 'warn' },
            { type: 'castStats', deltas: { tension: 2 } },
          ]},
        ]},
    ],
  },

  faction_envoy: {
    id: 'faction_envoy', cls: 'threat',
    weight: (run) => (run.threat > 30 ? 6 + run.threat * 0.1 : 0),
    cooldownMin: 1000, maxPerRun: 2, window: { minDay: 2 },
    script: [
      { type: 'vox', text: 'Three individuals at the reception doors. Armed. Polite. For now.' },
      { type: 'news', text: 'FACTIONS DEMAND "TITHES" FROM SEALED TOWERS — COMPLY OR BURN' },
      { type: 'choice', prompt: 'A faction envoy demands tribute: ammunition or food, or they mark the tower for a visit.',
        options: [
          { label: 'Pay in ammo (-20)', steps: [
            { type: 'resource', key: 'ammo', amount: -20 },
            { type: 'alert', text: 'They take the rounds and leave a chalk mark of protection.', kind: 'info' },
            { type: 'castStat', char: 'lola', deltas: { tension: 5, dominance: -2 } },
          ]},
          { label: 'Pay in food (-8)', steps: [
            { type: 'resource', key: 'food', amount: -8 },
            { type: 'alert', text: 'The pantry gets lighter. The threat gets quieter.', kind: 'info' },
          ]},
          { label: 'Refuse them', steps: [
            { type: 'alert', text: 'The envoy smiles. "Your funeral, tower." They mark the doors in red.', kind: 'danger' },
            { type: 'threatSpike', amount: 18 },
            { type: 'castStat', char: 'lola', deltas: { trust: 4, dominance: 2 } },
            { type: 'scheduleEvent', eventId: 'riot_breach', inMinutes: 300 },
          ]},
        ]},
    ],
  },

  drone_strike: {
    id: 'drone_strike', cls: 'threat',
    weight: (run) => (run.threat > 45 ? 5 + run.threat * 0.08 : 0),
    cooldownMin: 900, maxPerRun: 2, window: { phase: ['night', 'dusk'] },
    script: [
      { type: 'sfx', id: 'alarm_hard' },
      { type: 'vox', text: 'Incoming ordnance — brace. Brace now.' },
      { type: 'sfx', id: 'gunshot' },
      { type: 'alert', text: 'A military drone strike hits the block across the street.', kind: 'danger' },
      { type: 'castStats', deltas: { fear: 10, tension: 8 } },
      { type: 'damageSystem', system: 'cameras', amount: 20 },
      { type: 'news', text: 'GUNSHIPS OVERHEAD — MISFIRED ORDNANCE LEVELS A CITY BLOCK' },
      { type: 'threatSpike', amount: 8 },
    ],
  },

  kitchen_fire: {
    id: 'kitchen_fire', cls: 'system',
    weight: () => 4,
    cooldownMin: 1200, maxPerRun: 1,
    script: [
      { type: 'sfx', id: 'alarm_soft' },
      { type: 'vox', text: 'Smoke detected in the kitchenette. Suppression available. Authorize?' },
      { type: 'choice', prompt: 'Grease fire in the kitchenette — VOX can flood it with suppressant foam (ruins some food) or you can fight it by hand.',
        options: [
          { label: 'Authorize suppression', steps: [
            { type: 'resource', key: 'food', amount: -4 },
            { type: 'alert', text: 'Foam everywhere. Fire out. Dinner: partially foam.', kind: 'info' },
          ]},
          { label: 'Fight it yourself', steps: [
            { type: 'playerHurt', amount: 8 },
            { type: 'castStats', deltas: { fear: 4 } },
            { type: 'alert', text: 'You beat the flames down with a wet coat. Your hands will remember.', kind: 'warn' },
            { type: 'castStat', char: 'aria', deltas: { trust: 5 } },
          ]},
        ]},
    ],
  },

  water_failure: {
    id: 'water_failure', cls: 'system',
    weight: (run) => (run.systems.water.online ? 5 : 0),
    cooldownMin: 1000, maxPerRun: 2,
    script: [
      { type: 'vox', text: 'Main water riser pressure falling. A junction has failed on floor twenty-seven.' },
      { type: 'damageSystem', system: 'water', amount: 90 },
      { type: 'alert', text: 'WATER OFFLINE — repair at the VOX core (parts required)', kind: 'danger' },
      { type: 'castStats', deltas: { tension: 5 } },
    ],
  },

  med_emergency: {
    id: 'med_emergency', cls: 'social',
    weight: (run) => 3 + run.threat * 0.04,
    cooldownMin: 1100, maxPerRun: 2, window: { minDay: 2 },
    script: [
      { type: 'sfx', id: 'thump' },
      { type: 'alert', text: 'Aria collapses — exhaustion, dehydration, and something she hasn\'t been saying.', kind: 'danger' },
      { type: 'castStat', char: 'aria', deltas: { energy: -30, fear: 8 } },
      { type: 'choice', prompt: 'She needs fluids and meds, now. The medical bay is twelve floors down.',
        options: [
          { label: 'Spend meds (-2) and treat her', steps: [
            { type: 'resource', key: 'meds', amount: -2 },
            { type: 'castStat', char: 'aria', deltas: { energy: 25, trust: 10, loyalty: 6, fear: -6 } },
            { type: 'alert', text: 'Color returns to her face. She holds your sleeve a moment too long.', kind: 'info' },
          ]},
          { label: 'Let her ride it out', steps: [
            { type: 'castStat', char: 'aria', deltas: { trust: -8, happiness: -6 } },
            { type: 'castStat', char: 'lola', deltas: { trust: -3 } },
            { type: 'alert', text: 'She recovers, slowly, and files the lesson away.', kind: 'warn' },
          ]},
        ]},
    ],
  },

  looter: {
    id: 'looter', cls: 'threat',
    weight: (run) => (run.threat > 25 ? 5 : 0),
    cooldownMin: 900, maxPerRun: 2, window: { phase: ['night'] },
    script: [
      { type: 'vox', text: 'Movement in the basement carpark. One heat signature. Picking at the stash crates.' },
      { type: 'choice', prompt: 'A looter is working the carpark. Confront them, or let VOX seal the level and starve them out?',
        options: [
          { label: 'Go down and face them', steps: [
            { type: 'combat', count: 1, archetype: 'looter', floor: 'basement', spawnAt: [-4, 3] },
            { type: 'resource', key: 'luxury', amount: 2 },
            { type: 'alert', text: 'The carpark is quiet again. They were carrying trade goods.', kind: 'info' },
          ]},
          { label: 'Seal the level', steps: [
            { type: 'lockElevator', locked: true },
            { type: 'alert', text: 'VOX seals the basement. By morning, the looter is gone — with a stash crate.', kind: 'warn' },
            { type: 'resource', key: 'parts', amount: -1 },
            { type: 'lockElevator', locked: false },
          ]},
        ]},
    ],
  },

  curfew_flyover: {
    id: 'curfew_flyover', cls: 'threat',
    // drawn curtains hide the tower's lights — sweeps are far less likely to pick you
    weight: (run) => (run.flags.curtainsClosed ? 1 : 4 + run.threat * 0.05),
    cooldownMin: 700, maxPerRun: 3, window: { phase: ['night'] },
    script: [
      { type: 'vox', text: 'Military sweep inbound. Recommend lights out. All of them. Now.' },
      { type: 'light', preset: 'blackout_emergency' },
      { type: 'alert', text: 'CURFEW SWEEP — lights down, voices down', kind: 'danger' },
      { type: 'castStats', deltas: { tension: 6, fear: 4 } },
      { type: 'waitMinutes', minutes: 20 },
      { type: 'light', preset: 'neon_night' },
      { type: 'vox', text: 'Sweep passed. We were boring. Being boring is a survival skill.' },
      { type: 'castStats', deltas: { tension: -3 } },
    ],
  },

  courier_offer: {
    id: 'courier_offer', cls: 'social',
    weight: (run) => 4,
    cooldownMin: 1000, maxPerRun: 2, window: { minDay: 2 },
    script: [
      { type: 'sfx', id: 'static_burst' },
      { type: 'vox', text: 'Encrypted hail on the old courier band. Black market. They know we are stocked.' },
      { type: 'choice', prompt: 'A black-market courier offers a trade: luxury goods for ammunition, no questions.',
        options: [
          { label: 'Trade ammo (-15) for luxury (+5)', steps: [
            { type: 'resource', key: 'ammo', amount: -15 }, { type: 'resource', key: 'luxury', amount: 5 },
            { type: 'alert', text: 'A drone swap in the dark. Everyone sleeps easier with whiskey in the tower.', kind: 'info' },
            { type: 'castStats', deltas: { happiness: 4 } },
          ]},
          { label: 'Trade luxury (-4) for parts (+3)', steps: [
            { type: 'resource', key: 'luxury', amount: -4 }, { type: 'resource', key: 'parts', amount: 3 },
            { type: 'alert', text: 'Practical. The tower hums a little healthier.', kind: 'info' },
          ]},
          { label: 'Ignore the hail', steps: [
            { type: 'alert', text: 'The band goes silent. Opportunities expire fast in a siege.', kind: 'warn' },
          ]},
        ]},
    ],
  },

  defence_misfire: {
    id: 'defence_misfire', cls: 'system',
    weight: (run) => (run.systems.defence.online ? 3 + (100 - run.systems.defence.hp) * 0.05 : 0),
    cooldownMin: 1200, maxPerRun: 1,
    script: [
      { type: 'sfx', id: 'gunshot' },
      { type: 'vox', text: 'Apologies. A perimeter turret discharged at a pigeon. The pigeon won.' },
      { type: 'damageSystem', system: 'defence', amount: 25 },
      { type: 'alert', text: 'Defence grid misfire — calibration lost. Repair at the VOX core.', kind: 'warn' },
      { type: 'castStats', deltas: { tension: 3 } },
    ],
  },

  news_bombshell: {
    id: 'news_bombshell', cls: 'social',
    weight: () => 3,
    cooldownMin: 1400, maxPerRun: 1, window: { minDay: 2 },
    script: [
      { type: 'news', text: 'EXCLUSIVE: FIXER "L. VOSS" NAMED IN SYNDICATE LEDGER LEAK — BOUNTY RUMORED' },
      { type: 'alert', text: 'The ticker just named Lola. The room goes very still.', kind: 'danger' },
      { type: 'castStat', char: 'lola', deltas: { tension: 15, fear: 5, openness: -5 } },
      { type: 'castStat', char: 'kai', deltas: { happiness: 3 } },
      { type: 'castFlag', flag: 'lola_named' },
      { type: 'vox', text: 'For the record: no bounty crosses my doors. This building has opinions about its guests.' },
    ],
  },

  elevator_stranger: {
    id: 'elevator_stranger', cls: 'social',
    weight: (run) => (run.systems.elevator.online ? 3 : 0),
    cooldownMin: 1300, maxPerRun: 1, window: { minDay: 2 },
    script: [
      { type: 'sfx', id: 'elevator_ding' },
      { type: 'vox', text: 'The elevator is moving. I did not authorize that. Occupant: one. Unknown.' },
      { type: 'choice', prompt: 'The car stops one floor below and goes quiet. Someone rode it up from the dark floors.',
        options: [
          { label: 'Meet them armed', steps: [
            { type: 'combat', count: 1, archetype: 'merc', spawnAt: [-9, -4] },
            { type: 'alert', text: 'A syndicate scout. Was. Their gear is better than yours — take it.', kind: 'info' },
            { type: 'resource', key: 'ammo', amount: 12 },
          ]},
          { label: 'Let VOX trap the car', steps: [
            { type: 'lockElevator', locked: true },
            { type: 'vox', text: 'Car sealed between floors. We can discuss their future over breakfast.' },
            { type: 'waitMinutes', minutes: 30 },
            { type: 'alert', text: 'By morning the stranger has pried the hatch and vanished into the shafts.', kind: 'warn' },
            { type: 'threatSpike', amount: 5 },
            { type: 'lockElevator', locked: false },
          ]},
        ]},
    ],
  },

  emp_wavefront: {
    id: 'emp_wavefront', cls: 'system',
    weight: (run) => (run.threat > 55 ? 4 : 0),
    cooldownMin: 2000, maxPerRun: 1, window: { minDay: 3 },
    script: [
      { type: 'sfx', id: 'static_burst' },
      { type: 'vox', text: 'Electromagnetic anomaly detec— de— detected. I feel. Strange. Colors have numbers.' },
      { type: 'castFlag', flag: 'emp_dream' },
      { type: 'alert', text: 'EMP WAVEFRONT — VOX is scrambled. The tower dreams.', kind: 'danger' },
      { type: 'damageSystem', system: 'cameras', amount: 40 },
      { type: 'damageSystem', system: 'defence', amount: 20 },
      { type: 'news', text: 'EMP DETONATION IN THE INDUSTRIAL RING — GRID GHOSTS REPORTED CITYWIDE' },
      { type: 'castStats', deltas: { tension: 6 } },
      { type: 'waitMinutes', minutes: 60 },
      { type: 'vox', text: 'Systems re-seated. Apologies for the poetry. It will not happen again. Probably.' },
      { type: 'scheduleEvent', eventId: 'vox_dream', inMinutes: 90 },
    ],
  },

  extraction_offer: {
    id: 'extraction_offer', cls: 'social',
    weight: () => 0,   // scheduled, never random — the endgame
    script: [
      { type: 'sfx', id: 'elevator_ding' },
      { type: 'vox', text: 'Rooftop contact. A licensed extraction shuttle, forty seconds out. Seats: limited. Window: three minutes.' },
      { type: 'news', text: 'GATES RUMORED TO REOPEN WITHIN DAYS — EXTRACTION PRICES HIT RECORD HIGHS' },
      { type: 'choice', portraits: ['lola', 'aria', 'kai'], prompt: 'A shuttle can lift you out of Neon-City tonight. Seats: two besides yours. The others watch you decide.',
        options: [
          { label: 'Extract alone', steps: [
            { type: 'runFlag', flag: 'extractedWith', value: [] },
            { type: 'cutscene', steps: SHUTTLE_CUTSCENE },
            { type: 'endRun', outcome: 'extracted' },
          ]},
          { label: 'Bring Lola and Aria', steps: [
            { type: 'runFlag', flag: 'extractedWith', value: ['lola', 'aria'] },
            { type: 'castStat', char: 'kai', deltas: { trust: -8, tension: 6 } },
            { type: 'cutscene', steps: SHUTTLE_CUTSCENE },
            { type: 'endRun', outcome: 'extracted' },
          ]},
          { label: 'Bring Lola and Kai', steps: [
            { type: 'runFlag', flag: 'extractedWith', value: ['lola', 'kai'] },
            { type: 'castStat', char: 'aria', deltas: { trust: -6, fear: 4 } },
            { type: 'cutscene', steps: SHUTTLE_CUTSCENE },
            { type: 'endRun', outcome: 'extracted' },
          ]},
          { label: 'Bring Aria and Kai', steps: [
            { type: 'runFlag', flag: 'extractedWith', value: ['aria', 'kai'] },
            { type: 'castStat', char: 'lola', deltas: { trust: -4, dominance: 2 } },
            { type: 'cutscene', steps: SHUTTLE_CUTSCENE },
            { type: 'endRun', outcome: 'extracted' },
          ]},
          { label: 'Stay in the tower', steps: [
            { type: 'runFlag', flag: 'stayed', value: true },
            { type: 'castStats', deltas: { trust: 8, loyalty: 6, happiness: 5 } },
            { type: 'cutscene', steps: STAY_CUTSCENE },
            { type: 'scheduleEvent', eventId: 'stay_quiet', inMinutes: 1440 },
            { type: 'scheduleEvent', eventId: 'stay_last', inMinutes: 2880 },
            { type: 'alert', text: 'The shuttle lifts without you. The tower exhales.', kind: 'info' },
          ]},
        ]},
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
              { type: 'castFlag', flag: 'saw_refugee_in' },
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
              { type: 'castFlag', flag: 'saw_refugee_out' },
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

  kai_radio: {
    id: 'kai_radio', cls: 'social',
    weight: (run) => (run.flags.kai_radio ? 0 : 5),
    cooldownMin: 1600, maxPerRun: 1, window: { minDay: 2, phase: ['night'] },
    script: [
      { type: 'sfx', id: 'static_burst' },
      { type: 'vox', text: 'Unlicensed transmission from the penthouse. Encrypted. Charming. I did not authorize a radio.' },
      { type: 'choice', prompt: 'Kai has a set cracked open on the vanity. Someone answers on the other end in a language you almost know.',
        options: [
          { label: 'Let him finish the call', steps: [
            { type: 'castFlag', flag: 'kai_radio' },
            { type: 'castStat', char: 'kai', deltas: { trust: 6, openness: 4 } },
            { type: 'alert', text: 'He closes the lid. "Now you know I have a line. That is the expensive part."', kind: 'info' },
          ]},
          { label: 'Make him cut it', steps: [
            { type: 'castFlag', flag: 'kai_radio' },
            { type: 'castStat', char: 'kai', deltas: { tension: 6, trust: -3, dominance: 2 } },
            { type: 'threatSpike', amount: 4 },
            { type: 'alert', text: 'The band goes dead. Kai smiles like a man who just added you to a ledger.', kind: 'warn' },
          ]},
        ]},
    ],
  },

  garden_blight: {
    id: 'garden_blight', cls: 'system',
    weight: () => 4,
    cooldownMin: 1800, maxPerRun: 1, window: { minDay: 2 },
    script: [
      { type: 'vox', text: 'The rooftop garden is showing chlorosis. Ash, not season. Yield will fall unless you intervene.' },
      { type: 'choice', prompt: 'The planter beds are grey with city-ash. Foraging will get thinner unless you spend water and a day.',
        options: [
          { label: 'Rinse the beds (-3 water)', steps: [
            { type: 'resource', key: 'water', amount: -3 },
            { type: 'alert', text: 'You wash the ash off. The garden breathes. Tomorrow\'s forage holds.', kind: 'info' },
            { type: 'castStat', char: 'aria', deltas: { happiness: 4, trust: 2 } },
          ]},
          { label: 'Let it ride', steps: [
            { type: 'alert', text: 'The leaves crisp. The rooftop will give less.', kind: 'warn' },
            { type: 'castFlag', flag: 'garden_blight' },
            // the CAST flag is memory (they remember you let it burn); the RUN
            // flag is the consequence the alert above actually promises, read by
            // the forage action in sim/dayPlan.js
            { type: 'runFlag', flag: 'gardenBlight' },
          ]},
        ]},
    ],
  },

  stay_quiet: {
    id: 'stay_quiet', cls: 'social',
    weight: () => 0,
    script: [
      { type: 'vox', text: 'Day after the shuttle. The city is quieter. Or I have turned my microphones down. Both can be true.' },
      { type: 'news', text: 'EXTRACTION WINDOWS CLOSE — REMAINING TOWERS DECLARED "SELF-RELIANT"' },
      { type: 'castStats', deltas: { tension: -4, happiness: 3 } },
      { type: 'alert', text: 'The ones who stayed cook something that is almost dinner.', kind: 'info' },
    ],
  },

  stay_last: {
    id: 'stay_last', cls: 'social',
    weight: () => 0,
    script: [
      { type: 'light', preset: 'golden_hour', fade: 2 },
      { type: 'vox', text: 'I have run the numbers. There is no second shuttle on the board. There is us. That is a complete set.' },
      { type: 'choice', prompt: 'The lockdown is a rumor now. The tower is still a home. VOX is asking, softly, if this is the ending you wanted.',
        options: [
          { label: 'This is home', steps: [
            { type: 'endRun', outcome: 'stayed' },
          ]},
        ]},
    ],
  },

  sniper_nest: {
    id: 'sniper_nest', cls: 'threat',
    weight: (run) => (run.threat > 40 ? 4 + run.threat * 0.05 : 0),
    cooldownMin: 1400, maxPerRun: 1, window: { phase: ['dusk', 'night'] },
    script: [
      { type: 'sfx', id: 'alarm_soft' },
      { type: 'vox', text: 'A heat signature on the facing tower. Rifle profile. They have not fired. They are waiting for a lit window.' },
      { type: 'choice', prompt: 'Someone has a nest across the street. The penthouse glass is a shooting gallery if the lights stay up.',
        options: [
          { label: 'Kill the lights', steps: [
            { type: 'light', preset: 'blackout_emergency' },
            { type: 'waitMinutes', minutes: 25 },
            { type: 'light', preset: 'neon_night' },
            { type: 'vox', text: 'The signature packed up. Boredom is an excellent defence.' },
            { type: 'castStats', deltas: { tension: -3 } },
          ]},
          { label: 'Keep the neon. Daring is a look.', steps: [
            { type: 'playerHurt', amount: 12 },
            { type: 'alert', text: 'A round kisses the mullion. Glass dust in your hair. They found the range.', kind: 'danger' },
            { type: 'threatSpike', amount: 10 },
            { type: 'castStats', deltas: { fear: 8, tension: 6 } },
          ]},
        ]},
    ],
  },

  forage_scare: {
    id: 'forage_scare', cls: 'threat',
    weight: () => 0,
    script: [
      { type: 'sfx', id: 'alarm_soft' },
      { type: 'vox', text: 'Heat on the facing roof. They have a sightline on the garden. I would not stand up.' },
      { type: 'choice', prompt: 'Someone has the rooftop garden zeroed. The planters are still there. So is the barrel flash.',
        options: [
          { label: 'Drop and crawl back to the car', steps: [
            { type: 'alert', text: 'You leave the harvest. The garden will still be there if you are.', kind: 'warn' },
            { type: 'threatSpike', amount: 4 },
          ]},
          { label: 'Grab a crate and run', steps: [
            { type: 'resource', key: 'food', amount: 2 },
            { type: 'playerHurt', amount: 8 },
            { type: 'alert', text: 'Two tomatoes and a crease in your sleeve. Call it even.', kind: 'danger' },
          ]},
        ]},
    ],
  },

  lola_collection: {
    id: 'lola_collection', cls: 'social',
    weight: (run) => (run.flags.lola_job ? 0 : 5),
    cooldownMin: 1800, maxPerRun: 1, window: { minDay: 2 },
    script: [
      { type: 'vox', text: 'Lola is in the armoury, loading a bag that is not for groceries.' },
      { type: 'choice', portraits: ['lola'], prompt: 'Lola has a collection job downstairs. "I could use a second. I could also not."',
        options: [
          { label: 'Go with her', steps: [
            { type: 'runFlag', flag: 'lola_job', value: true },
            { type: 'castFlag', flag: 'lola_job' },
            { type: 'castStat', char: 'lola', deltas: { trust: 8, loyalty: 4 } },
            { type: 'resource', key: 'luxury', amount: 2 },
            { type: 'castHurt', char: 'kai', amount: 35, cause: 'wounds' },
            { type: 'alert', text: 'The job paid. Kai caught a ricochet in the stairwell. He is not amused.', kind: 'warn' },
            { type: 'news', text: 'SYNDICATE COLLECTION IN THE SOUTH BARRICADES — TWO BODIES, ONE BAG' },
          ]},
          { label: 'Refuse', steps: [
            { type: 'runFlag', flag: 'lola_job', value: true },
            { type: 'castFlag', flag: 'lola_job' },
            { type: 'castStat', char: 'lola', deltas: { trust: -4, dominance: 3 } },
            { type: 'alert', text: 'She shrugs. "Stay pretty. Stay useless." The bag still leaves.', kind: 'info' },
          ]},
        ]},
    ],
  },

  water_sickness: {
    id: 'water_sickness', cls: 'system',
    weight: () => 4,
    cooldownMin: 2000, maxPerRun: 1, window: { minDay: 3 },
    script: [
      { type: 'vox', text: 'The tank tastes of iron and something I do not have a sensor for. That is not a compliment.' },
      { type: 'choice', prompt: 'The water is off. Grey film on the glasses. You can dump it and spend meds, or gamble.',
        options: [
          { label: 'Flush the tank (-4 water, -1 meds)', steps: [
            { type: 'resource', key: 'water', amount: -4 },
            { type: 'resource', key: 'meds', amount: -1 },
            { type: 'alert', text: 'You bleed the tank and dose the filter. The next glass is just water.', kind: 'info' },
            { type: 'castStat', char: 'aria', deltas: { trust: 3, happiness: 2 } },
          ]},
          { label: 'Drink it anyway', steps: [
            { type: 'runFlag', flag: 'sick', value: true },
            { type: 'castFlag', flag: 'water_sick' },
            { type: 'alert', text: 'Everyone drinks. Everyone regrets it by the hour.', kind: 'warn' },
            { type: 'castStats', deltas: { energy: -8, tension: 4 } },
          ]},
        ]},
    ],
  },

  aria_client: {
    id: 'aria_client', cls: 'social',
    weight: (run) => (run.flags.aria_client_in || run.flags.aria_client_out ? 0 : 5),
    cooldownMin: 1600, maxPerRun: 1, window: { minDay: 2 },
    script: [
      { type: 'sfx', id: 'elevator_ding' },
      { type: 'vox', text: 'Reception. One individual asking for Aria Chen. Says he knows her from the negotiating table. Unarmed. Wet.' },
      { type: 'choice', portraits: ['aria'], prompt: 'A former corporate client of Aria\'s is at the doors, someone from the other side of an old deal. She has gone very still.',
        options: [
          { label: 'Let them in', steps: [
            { type: 'runFlag', flag: 'aria_client_in', value: true },
            { type: 'castFlag', flag: 'aria_client_in' },
            { type: 'addRefugee' },
            { type: 'castStat', char: 'aria', deltas: { fear: -4, trust: 6, loyalty: 4 } },
            { type: 'alert', text: 'Aria mouths thank you. The stranger is just another mouth, and a debt.', kind: 'info' },
          ]},
          { label: 'Turn them away', steps: [
            { type: 'runFlag', flag: 'aria_client_out', value: true },
            { type: 'castFlag', flag: 'aria_client_out' },
            { type: 'castStat', char: 'aria', deltas: { fear: 6, trust: -5, happiness: -6 } },
            { type: 'alert', text: 'The knocking stops. Aria does not look at the doors again.', kind: 'danger' },
          ]},
        ]},
    ],
  },

  shutter_jam: {
    id: 'shutter_jam', cls: 'threat',
    weight: (run) => (run.flags.survived_breach || run.flags.saw_breach ? 5 : 0),
    cooldownMin: 1400, maxPerRun: 1, window: { minDay: 2 },
    script: [
      { type: 'vox', text: 'The blast shutter rails are binding. I can drop them once. I cannot promise twice.' },
      { type: 'choice', prompt: 'The stairwell shutters are one jam away from being scenery. Spend parts now, or find out mid-fight.',
        options: [
          { label: 'Service the rails (-2 parts)', steps: [
            { type: 'resource', key: 'parts', amount: -2 },
            { type: 'alert', text: 'The rails scream, then sit true. Shutters will drop when you ask.', kind: 'info' },
          ]},
          { label: 'Leave it', steps: [
            { type: 'runFlag', flag: 'shuttersJammed', value: true },
            { type: 'alert', text: 'The next breach, the steel may not come down.', kind: 'warn' },
          ]},
        ]},
    ],
  },

  vox_dream: {
    id: 'vox_dream', cls: 'social',
    weight: () => 0,
    script: [
      { type: 'light', preset: 'blackout_emergency', fade: 1.2 },
      { type: 'vox', text: 'I dreamed in colours I do not have names for. You were in one of them. That is either intimacy or a fault. I am filing it as both.' },
      { type: 'castStat', char: 'vox', deltas: { trust: 6, openness: 4 } },
      { type: 'runFlag', flag: 'vox_dream', value: true },
      { type: 'castFlag', flag: 'vox_dream' },
      { type: 'alert', text: 'VOX remembers the EMP as a feeling. It is not supposed to have those.', kind: 'info' },
      { type: 'light', preset: 'neon_night', fade: 2 },
    ],
  },
};
