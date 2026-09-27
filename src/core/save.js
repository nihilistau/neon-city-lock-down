// @ts-check
// Versioned save envelope: slots + roguelike autosave. Serializes clock, rng,
// run state, characters (stats/bond/memory/position/wardrobe/brain), lighting.
// Autosave is deleted on death — perma-death is real.

import { STAT_KEYS } from '../chars/stats.js';

const VERSION = 2;
const SLOT_PREFIX = 'ncld.slot.';
export const AUTOSAVE_KEY = 'ncld.autosave';

/**
 * Build the save envelope from a live app.
 * @param {import('./app.js').App} app
 */
export function buildSave(app, label = '') {
  return {
    version: VERSION,
    savedAt: Date.now(),
    meta: {
      label: label || `Day ${app.clock.day} — ${app.clock.label.split('— ')[1]}`,
      day: app.clock.day,
      playerName: app.player?.name,
    },
    clock: app.clock.serialize(),
    rng: app.rng.serialize(),
    run: app.run,
    scheduler: app.scheduler.serialize(),
    inventory: app.inventory?.serialize(),
    lighting: app.lighting.presetId,
    // Which floor the player is standing on. Omitting this meant an autosave on
    // the rooftop resumed in the penthouse — and every floor-scoped thing
    // (lighting look, ambience, colliders) came back wrong with it.
    activeFloor: app.world?.activeFloor,
    characters: Object.fromEntries(Object.values(app.cast).map((c) => [c.id, {
      ...c.serialize(),
      wardrobe: c.wardrobe?.serialize(),
      brain: app.brains[c.id]?.serialize(),
    }])),
  };
}

/** outfit states retired with the v0.6 content cleanse */
const RETIRED_OUTFITS = new Set(['none', 'underwear']);

/**
 * Migrate an older save envelope forward to the current VERSION. Each case
 * upgrades v→v+1. Unknown-shaped saves fail loudly in applySave.
 * @param {any} save
 */
export function migrate(save) {
  // Mutates the envelope in place. Safe: every caller hands it a freshly
  // JSON.parse'd object (readSlot, importSave), never live or shared state.
  const s = save;
  while (s && s.version < VERSION) {
    switch (s.version) {
      case 1: {
        // v0.6 retired the intimacy ladder and three stats. Old runs keep
        // everything else; the bond tier re-derives from trust + loyalty.
        for (const c of Object.values(s.characters || {})) {
          delete c.gates;
          delete c.consent;
          if (c.stats) c.stats = Object.fromEntries(Object.entries(c.stats).filter(([k]) => STAT_KEYS.includes(/** @type {any} */ (k))));
          if (c.wardrobe && RETIRED_OUTFITS.has(c.wardrobe.current)) delete c.wardrobe;
        }
        s.version = 2;
        break;
      }
      default:
        return s;   // unknown version: applySave rejects it
    }
  }
  return s;
}

/**
 * Restore a save envelope into a live app (same cast composition).
 * @param {import('./app.js').App} app @param {any} save
 */
export function applySave(app, save) {
  save = migrate(save);
  if (save.version !== VERSION) throw new Error(`save version ${save.version} unsupported`);
  // The bed state is not saved — a load always starts standing. Reset (not
  // getUp, which is a no-op while standing) so the first-person seated lock and
  // every guest — seatedAt included — are cleared before the queues are.
  app.bedScene?.reset();
  app.clock.deserialize(save.clock);
  // buildSave() has always captured rng state and applySave() never restored it,
  // so a seeded run stopped being reproducible the instant you loaded it. In
  // place, not by replacement — every system holds its own stream reference.
  if (save.rng) app.rng.restore(save.rng);
  Object.assign(app.run, save.run);
  app.scheduler.deserialize(save.scheduler);
  app.inventory?.deserialize(save.inventory);
  app.lighting.apply(save.lighting || 'neon_night', 0.01);
  for (const [id, data] of Object.entries(save.characters)) {
    const c = app.cast[id];
    if (!c) continue;
    c.queue.clear();
    c.restore(data);
    if (data.wardrobe) c.wardrobe?.deserialize(data.wardrobe);
    if (data.brain) app.brains[id]?.deserialize(data.brain);
    if (!c.alive) c.actor.setDowned(true);
    else c.actor.playClip(c.persona.personality.idleClip || 'idle_stand', 0.01);
  }

  // Restore the floor BEFORE anything spatial reads it.
  const floor = save.activeFloor;
  if (floor && app.world?.floorGroups?.[floor] && floor !== app.world.activeFloor) {
    app.setFloor(floor, { from: floor });   // one call, all six steps
  }

  // Refugees are spawned into the cast at runtime, so `save.characters` has
  // entries with no `app.cast[id]` to restore into and the loop above skipped
  // them — they vanished from the world. But `run.refugees` DID restore and kept
  // suppressing the refugee event (events.js gates on `- refugees * 4`), so the
  // guest was gone from the tower, gone from the pantry maths, and still
  // blocking their own replacement. Respawn them, then restore their state.
  for (const [id, data] of Object.entries(save.characters)) {
    if (app.cast[id] || !id.startsWith('refugee')) continue;
    const c = app.spawnRefugeeById?.(id);
    if (!c) continue;
    c.queue.clear();
    c.restore(data);
    if (data.wardrobe) c.wardrobe?.deserialize(data.wardrobe);
    if (data.brain) app.brains[id]?.deserialize(data.brain);
    if (!c.alive) c.actor.setDowned(true);
  }
}

/** @param {number|string} slot */
export function saveToSlot(app, slot, label) {
  const data = buildSave(app, label);
  localStorage.setItem(slot === 'auto' ? AUTOSAVE_KEY : SLOT_PREFIX + slot, JSON.stringify(data));
  return data.meta;
}

/** @param {number|string} slot @returns {any|null} */
export function readSlot(slot) {
  try {
    const raw = localStorage.getItem(slot === 'auto' ? AUTOSAVE_KEY : SLOT_PREFIX + slot);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function deleteAutosave() {
  localStorage.removeItem(AUTOSAVE_KEY);
}

/** list slot metas for the menu */
export function listSlots() {
  const out = [];
  for (const slot of [1, 2, 3]) {
    const data = readSlot(slot);
    out.push({ slot, meta: data?.meta || null, savedAt: data?.savedAt || null });
  }
  const auto = readSlot('auto');
  if (auto) out.push({ slot: 'auto', meta: auto.meta, savedAt: auto.savedAt });
  return out;
}

/** export current save as a downloadable JSON file */
export function exportSave(app) {
  const blob = new Blob([JSON.stringify(buildSave(app, 'export'), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ncld-save-day${app.clock.day}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Validate a save envelope without applying it.
 * @param {any} raw
 * @returns {{ok:true, save:any}|{ok:false, reason:string}}
 */
export function parseSaveEnvelope(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not_object' };
  raw = migrate(raw);
  if (raw.version !== VERSION) return { ok: false, reason: 'version' };
  if (!raw.run || typeof raw.run !== 'object') return { ok: false, reason: 'shape' };
  if (!raw.clock || typeof raw.clock !== 'object') return { ok: false, reason: 'shape' };
  if (!raw.characters || typeof raw.characters !== 'object') return { ok: false, reason: 'shape' };
  return { ok: true, save: raw };
}

/**
 * Import a JSON envelope (object or string) into a live app.
 * @param {import('./app.js').App} app
 * @param {any} json
 */
export function importSave(app, json) {
  let data = json;
  if (typeof json === 'string') {
    try { data = JSON.parse(json); } catch { return { ok: false, reason: 'json' }; }
  }
  const parsed = parseSaveEnvelope(data);
  if (!parsed.ok) return parsed;
  try {
    applySave(app, parsed.save);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'apply' };
  }
}
