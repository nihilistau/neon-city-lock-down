// @ts-check
// The art manifest: every generated asset, its prompt, and how to process it.
//
// This is the provenance record. Regenerating an asset means editing its entry
// here and re-running `node tools/gen-art.mjs <id>` — never hand-editing the
// output, so the repo always knows how a given file came to exist.
//
// PROCESSING NOTES
// - The image API returns 1024x1024 JPEG with NO alpha channel. Anything that
//   needs transparency is generated on a solid chroma field and keyed at BUILD
//   time (once, offline, with feathered edges) rather than at runtime. v0.4
//   keyed on every page load, which cost 1.45MB of downloads to draw 13 glyphs
//   at 16px and flashed bright green squares until it finished.
// - Icons render at 16-18px. They are emitted at 64px: crisp on HiDPI, ~2KB.
// - Fabrics must TILE. They are generated tileable-by-prompt and then verified
//   by the seam metric in build-assets.mjs; a failing tile is reported, not
//   silently shipped.

/** Chroma key colour. Magenta is maximally distant from the cyan/amber palette. */
export const CHROMA = { r: 0xff, g: 0x00, b: 0xff };

const ICON_STYLE =
  'flat vector game HUD icon, single bold silhouette, thick solid shapes, '
  + 'bright high-contrast colour that reads clearly against a near-black UI, '
  + 'centred, filling most of the frame, no text, no letters, no shading, no gradient, '
  + 'no drop shadow, no border, no frame, pure solid #FF00FF magenta background';

/** @param {string} subject @param {string} colour */
const icon = (subject, colour) => `${subject}, solid ${colour} colour, ${ICON_STYLE}`;

const FABRIC_STYLE =
  'seamless tileable texture, flat orthographic top-down view, evenly lit, '
  + 'no shadows, no highlights, no vignette, no perspective, no objects, '
  + 'uniform across the whole frame, repeating pattern that tiles edge to edge';

/**
 * @typedef {Object} ArtSpec
 * @property {string} id
 * @property {string} prompt
 * @property {'icon'|'fabric'|'face'|'plate'} kind
 * @property {string} out           destination path, repo-relative
 * @property {number} [size]        output edge length in px
 * @property {boolean} [chroma]     key the magenta field to alpha
 */

/** @type {ArtSpec[]} */
export const ART = [
  // ── HUD icons: keyed to alpha, emitted at 64px ─────────────────────────
  ...[
    ['hp', 'a heart', '#ff4757'],
    ['food', 'a bowl of noodles with chopsticks', '#ffb347'],
    ['water', 'a water droplet', '#39e6ff'],
    ['meds', 'a medical cross in a rounded square', '#3dff9a'],
    ['ammo', 'a single upright bullet cartridge, bright and light-toned', '#e8f0f5'],
    ['cells', 'a lightning bolt in a battery outline', '#ffd166'],
    ['parts', 'a mechanical gear cog, bright and light-toned', '#cfe0ea'],
    ['luxury', 'a whiskey tumbler glass', '#ffb347'],
    ['threat', 'a warning triangle with an exclamation mark', '#ff4757'],
    ['inventory', 'a backpack', '#cfe3ec'],
    ['plan', 'a clipboard checklist', '#39e6ff'],
    ['whisper', 'a speech bubble with a keyhole', '#9d6bff'],
    ['fists', 'a clenched fist', '#ffb347'],
  ].map(([id, subject, colour]) => /** @type {ArtSpec} */ ({
    id: `icon-${id}`, kind: 'icon', chroma: true, size: 64,
    out: `assets/ui/icons/${id}.png`,
    prompt: icon(String(subject), String(colour)),
  })),

  // ── fabrics: used as roughness/normal detail, NOT albedo ───────────────
  ...[
    ['leather', 'worn black leather grain, fine pebbled texture'],
    ['silk', 'smooth silk satin weave, very fine directional sheen lines'],
    ['cotton', 'plain woven cotton canvas, visible thread crosshatch'],
    ['velvet', 'crushed velvet pile, soft irregular nap'],
    ['denim', 'indigo denim twill, diagonal weave'],
  ].map(([id, subject]) => /** @type {ArtSpec} */ ({
    id: `fabric-${id}`, kind: 'fabric', size: 512,
    out: `assets/fabrics/${id}.jpg`,
    prompt: `${subject}, ${FABRIC_STYLE}, greyscale, mid-grey average brightness`,
  })),

  // ── city ───────────────────────────────────────────────────────────────
  {
    id: 'city-windows', kind: 'fabric', size: 512,
    out: 'assets/city/windows.jpg',
    prompt: 'a grid of lit skyscraper windows at night, small evenly spaced rectangular '
      + 'windows in rows and columns, some lit warm amber some cyan some dark, '
      + `dark building facade between them, ${FABRIC_STYLE}`,
  },
  {
    id: 'city-skyline', kind: 'plate', size: 1024,
    out: 'assets/city/skyline.jpg',
    prompt: 'a dense cyberpunk city skyline at night seen from high above, neon-lit '
      + 'towers receding into haze, magenta and cyan glow, low horizon, no foreground '
      + 'objects, no window frame, no rain streaks, no text, no signage lettering, '
      + 'clean unobstructed vista, cinematic wide shot',
  },
];

/** @param {string} id @returns {ArtSpec|undefined} */
export const findArt = (id) => ART.find((a) => a.id === id);
