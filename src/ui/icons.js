// @ts-check
// HUD resource icons — generated neon glyphs on chroma green, keyed at runtime.

export const ICON_IDS = [
  'food', 'water', 'meds', 'ammo', 'cells', 'parts', 'luxury', 'hp',
  'threat', 'plan', 'whisper', 'inventory', 'fists',
];

/** @type {Record<string, string>} */
const keyed = {};

function keyGreen(img) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, 64, 64);
  const data = ctx.getImageData(0, 0, 64, 64);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (g > 140 && g > r * 1.35 && g > b * 1.35) d[i + 3] = 0;
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL('image/png');
}

/** Kick off loads. Safe to call once from initHud. */
export function loadHudIcons(onReady) {
  if (typeof Image === 'undefined') return;
  let left = ICON_IDS.length;
  for (const id of ICON_IDS) {
    const img = new Image();
    img.onload = () => {
      keyed[id] = keyGreen(img);
      left--;
      if (left <= 0) onReady?.();
    };
    img.onerror = () => { left--; if (left <= 0) onReady?.(); };
    img.src = `/assets/ui/icons/${id}.jpg`;
  }
}

/** @param {string} id */
export function iconUrl(id) {
  return keyed[id] || `/assets/ui/icons/${id}.jpg`;
}

const ITEM_HUD = { fists: 'fists', medkit: 'meds', ration: 'food', whiskey: 'luxury' };

/** HUD/inventory glyph: mapped items use keyed art, others keep their emoji. */
export function itemIconSrc(id) {
  const hud = ITEM_HUD[id];
  return hud ? iconUrl(hud) : null;
}
