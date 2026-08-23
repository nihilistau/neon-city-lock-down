// @ts-check
// HUD resource icons.
//
// These are PNGs with a real alpha channel, generated and keyed offline by
// tools/gen-art.mjs (see tools/art/manifest.mjs for the prompts). Nothing keys
// at runtime any more.
//
// What this replaced: thirteen 1024x1024 JPEGs (~1.45MB, ~54MB of decoded
// bitmap) downloaded to draw thirteen glyphs at 16px, chroma-keyed in a canvas
// on every page load with a hard binary alpha test — which stair-stepped every
// edge, left a green fringe on the lossy source, and showed thirteen bright
// green squares until the last byte arrived. The set is now ~36KB at 64px.

export const ICON_IDS = [
  'food', 'water', 'meds', 'ammo', 'cells', 'parts', 'luxury', 'hp',
  'threat', 'plan', 'whisper', 'inventory', 'fists',
];

/** @param {string} id */
export function iconUrl(id) {
  return `/assets/ui/icons/${id}.png`;
}

/**
 * Preload so the first HUD paint isn't a row of empty boxes. Kept as a no-op-ish
 * shim because callers await it; there is no keying step to wait for now.
 * @param {() => void} [onReady]
 */
export function loadHudIcons(onReady) {
  if (typeof Image === 'undefined') { onReady?.(); return; }
  let left = ICON_IDS.length;
  const done = () => { if (--left <= 0) onReady?.(); };
  for (const id of ICON_IDS) {
    const img = new Image();
    img.onload = done;
    img.onerror = done;
    img.src = iconUrl(id);
  }
}

const ITEM_HUD = { fists: 'fists', medkit: 'meds', ration: 'food', whiskey: 'luxury' };

/** HUD/inventory glyph: mapped items use the icon set, others keep their emoji. */
export function itemIconSrc(id) {
  const hud = ITEM_HUD[id];
  return hud ? iconUrl(hud) : null;
}
