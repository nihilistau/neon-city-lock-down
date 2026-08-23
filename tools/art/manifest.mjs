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

const FACE_STYLE =
  'Rendered in a single consistent style: smooth matte clay sculpt, soft even '
  + 'surface planes, semi-realistic human proportions, no cel shading, no anime, '
  + 'no photorealism, no wrinkles, no pores. Front view, symmetrical, looking '
  + 'straight at the camera, head filling the frame from forehead to chin. '
  + 'Completely FLAT even studio light: no cast shadows, no rim light, no ambient '
  + 'occlusion, no specular highlights. Bald with no hair and no hairline. '
  + 'No eyebrows, no facial hair, neutral closed lips. Plain flat mid-grey '
  + 'background. No clothing, jewellery, tattoos, makeup or text.';

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

  // ── faces: identity underpaint for the 256px face decal ────────────────
  // NOTE there is deliberately no player face. The appearance editor offers
  // 6 skin tones x 6 hair colours x 7 styles, and a fixed face texture fights it
  // directly — v0.4's player-f carried cyan pixie hair, a face tattoo and an
  // earring painted in, so choosing dark skin and blonde hair gave you a
  // dark-skinned body with a light-skinned tattooed face under blonde strands.
  // The player uses the purely procedural face, which derives from their choice.
  // These supply IDENTITY ONLY — skin tone, cheekbones, jaw, eye colour. The rig
  // draws the brows, nose and lips itself because those are animated (visemes,
  // blinks, expressions), and face.js washes those two bands out of the
  // underpaint so there is exactly one of each. So: no hair (3D strands render
  // over the top), no background, and above all FLAT LIGHTING — v0.4's faces
  // carried baked ambient occlusion and a rim light that fought the scene key.
  ...[
    ['lola', 'a woman aged 32, feminine face, warm tan skin, high strong cheekbones, '
      + 'square jaw, direct level gaze, magenta-brown eyes'],
    ['aria', 'a woman aged 23, feminine face, light warm skin, soft rounded cheeks, '
      + 'small delicate chin, wide open violet eyes'],
    ['kai', 'a man aged 35, masculine face, medium brown skin, lean but healthy cheeks, '
      + 'straight nose, calm half-lidded gold-amber eyes'],
  ].map(([id, subject]) => /** @type {ArtSpec} */ ({
    id: `face-${id}`, kind: 'face', size: 512,
    out: `assets/chars/${id}/face.jpg`,
    // One rigid style anchor shared by all five. The first pass varied the style
    // per character (one cel-shaded, one doll-like, one gaunt) which is exactly
    // the inconsistency this set exists to remove — v0.4 had Kai photoreal beside
    // four stylised heads, in the same shot.
    prompt: `${subject}. ${FACE_STYLE}`,
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
