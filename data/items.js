// @ts-check
// Item catalog. Weapons feed the combat resolver (weaponKey → WEAPONS entry);
// consumables run a `use(app)` effect; valuables/key items are inert flavour or
// unlock hooks. Bulk survival stock (food/water/ammo/meds/cells/parts/luxury)
// stays in run.resources — the inventory holds discrete, carried items.

/**
 * @typedef {Object} ItemDef
 * @property {string} id @property {string} name @property {string} icon
 * @property {'weapon'|'consumable'|'valuable'|'key'} type
 * @property {string} desc
 * @property {string} [weaponKey]  resolver WEAPONS id (weapons only)
 * @property {boolean} [ranged]    needs ammo (weapons only)
 * @property {number} [value]      luxury/trade value
 * @property {boolean} [stack]     stackable (consumables/valuables)
 * @property {(app:any) => (string|void)} [use]  consumable effect → toast text
 */

/** @type {Record<string, ItemDef>} */
export const ITEMS = {
  // ── weapons ──────────────────────────────────────────────
  fists: {
    id: 'fists', name: 'Bare Hands', icon: '✊', type: 'weapon', weaponKey: 'shiv',
    desc: 'Always available. Not recommended against the armed.',
  },
  sidearm: {
    id: 'sidearm', name: 'Sidearm', icon: '🔫', type: 'weapon', weaponKey: 'sidearm', ranged: true,
    desc: 'A reliable pistol. Accurate, low recoil, spends one round per shot.',
  },
  smg: {
    id: 'smg', name: 'SMG', icon: '🔫', type: 'weapon', weaponKey: 'smg', ranged: true,
    desc: 'High rate of fire, lower accuracy. Eats ammo, ends arguments.',
  },
  pipe: {
    id: 'pipe', name: 'Steel Pipe', icon: '🦯', type: 'weapon', weaponKey: 'pipe',
    desc: 'Close and personal. No ammo, no mercy.',
  },
  shiv: {
    id: 'shiv', name: 'Shiv', icon: '🔪', type: 'weapon', weaponKey: 'shiv',
    desc: 'Quiet, quick, deniable. A street classic.',
  },

  // ── consumables ─────────────────────────────────────────
  medkit: {
    id: 'medkit', name: 'Field Medkit', icon: '🩹', type: 'consumable', stack: true,
    desc: 'Full trauma kit — restores serious health and clears injuries.',
    use: (app) => {
      const p = app.run.player;
      p.health = Math.min(100, p.health + 45);
      for (const c of Object.values(app.cast)) c.injuries = [];
      return 'You patch yourself up. +45 health, injuries treated.';
    },
  },
  stim: {
    id: 'stim', name: 'Combat Stim', icon: '💉', type: 'consumable', stack: true,
    desc: 'Wakes you up hard. Restores stamina/energy, dulls fear for a while.',
    use: (app) => {
      app.run.player.stamina = Math.min(100, (app.run.player.stamina || 60) + 40);
      app.run.player.morale = Math.min(100, app.run.player.morale + 10);
      return 'The stim hits. Everything gets sharp and loud.';
    },
  },
  ration: {
    id: 'ration', name: 'Ration Bar', icon: '🍫', type: 'consumable', stack: true,
    desc: 'Dense emergency calories. Blunts hunger.',
    use: (app) => {
      app.run.player.hunger = Math.max(0, app.run.player.hunger - 30);
      return 'Chalky, but it quiets your stomach.';
    },
  },
  whiskey: {
    id: 'whiskey', name: 'Good Whiskey', icon: '🥃', type: 'consumable', stack: true,
    desc: 'The genuinely old stuff. Loosens the room and the tongue.',
    use: (app) => {
      app.run.player.morale = Math.min(100, app.run.player.morale + 12);
      for (const c of Object.values(app.cast)) if (c.id !== 'vox') c.applyStats({ sobriety: -10, openness: 4, tension: -3 }, 'whiskey');
      return 'You pour a round. The tower exhales.';
    },
  },

  // ── valuables / key items ───────────────────────────────
  jammer: {
    id: 'jammer', name: 'Signal Jammer', icon: '📡', type: 'key', stack: false,
    desc: 'Military-grade. Blinds cameras and drones for a short window.',
    use: (app) => {
      app.run.flags.jammerActive = app.clock.totalMinutes;
      return 'Static blooms. The cameras go blind — you are briefly off the grid.';
    },
  },
  keycard: {
    id: 'keycard', name: 'Syndicate Keycard', icon: '🗝️', type: 'key', stack: false,
    desc: "Someone important's access card. VOX respects it. Mostly.",
  },
  chip: {
    id: 'chip', name: 'Data Chip', icon: '💾', type: 'valuable', stack: true, value: 8,
    desc: 'Encrypted contract data. Kai would pay well. So would his enemies.',
  },
  jewels: {
    id: 'jewels', name: 'Loose Stones', icon: '💎', type: 'valuable', stack: true, value: 5,
    desc: 'Untraceable, portable wealth. The only currency in a lockdown.',
  },
};

/** starting inventories keyed by loadout id (used by the new-game flow) */
export const STARTING_KITS = {
  fixer: [{ id: 'sidearm', qty: 1 }, { id: 'medkit', qty: 1 }, { id: 'whiskey', qty: 1 }],
  hoarder: [{ id: 'shiv', qty: 1 }, { id: 'ration', qty: 3 }, { id: 'medkit', qty: 2 }],
  gunhand: [{ id: 'smg', qty: 1 }, { id: 'sidearm', qty: 1 }, { id: 'stim', qty: 2 }],
};

/** loadout metadata for the new-game menu: display + starting-resource deltas */
export const LOADOUTS = {
  fixer: {
    id: 'fixer', name: 'The Fixer', icon: '🎯',
    desc: 'Balanced. A sidearm, a medkit, and a bottle of the good stuff. The professional\'s default.',
    resources: {},
  },
  hoarder: {
    id: 'hoarder', name: 'The Survivor', icon: '📦',
    desc: 'Provisions over firepower. Extra food, water, and meds — but light on ammo. Outlast the siege.',
    resources: { food: 14, water: 20, meds: 3, ammo: -30 },
  },
  gunhand: {
    id: 'gunhand', name: 'The Gunhand', icon: '🔥',
    desc: 'Loaded for a fight. An SMG, spare ammo, and stims — but the pantry is thin. Live fast.',
    resources: { ammo: 40, meds: 2, food: -8, luxury: -6 },
  },
};
