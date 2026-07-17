// @ts-check
// Versioned save envelope: slots + roguelike autosave. Serializes clock, rng,
// run state, characters (stats/gates/memory/position/wardrobe/brain), lighting.
// Autosave is deleted on death — perma-death is real.

const VERSION = 1;
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
    lighting: app.lighting.presetId,
    characters: Object.fromEntries(Object.values(app.cast).map((c) => [c.id, {
      ...c.serialize(),
      wardrobe: c.wardrobe?.serialize(),
      brain: app.brains[c.id]?.serialize(),
    }])),
  };
}

/**
 * Restore a save envelope into a live app (same cast composition).
 * @param {import('./app.js').App} app @param {any} save
 */
export function applySave(app, save) {
  if (save.version !== VERSION) throw new Error(`save version ${save.version} unsupported`);
  app.clock.deserialize(save.clock);
  Object.assign(app.run, save.run);
  app.scheduler.deserialize(save.scheduler);
  app.lighting.apply(save.lighting || 'neon_night', 0.01);
  for (const [id, data] of Object.entries(save.characters)) {
    const c = app.cast[id];
    if (!c) continue;
    c.queue.clear();
    c.restore(data);
    if (data.wardrobe) c.wardrobe?.deserialize(data.wardrobe);
    if (data.brain) app.brains[id]?.deserialize(data.brain);
    c.actor.playClip(c.persona.personality.idleClip || 'idle_stand', 0.01);
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
