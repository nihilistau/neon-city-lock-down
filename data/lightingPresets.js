// @ts-check
// Lighting presets + time-of-day keyframes — PURE DATA (no three.js), so both
// the config layer (data/configDefaults.js → lighting) and Node tooling can
// import them. The Lighting system (src/scene3d/lighting.js) reads the live
// values via cfg('lighting.presets') / cfg('lighting.tod'). Editable in
// config/lighting.yaml. Colors are 0xRRGGBB ints; intensities are three.js units.

/** @typedef {{hemi:{sky:number, ground:number, intensity:number},
 *             key:{color:number, intensity:number, pos:[number,number,number]},
 *             warm:{color:number, intensity:number}, cool:{color:number, intensity:number},
 *             accent:{color:number, intensity:number},
 *             fog:{color:number, density:number}, exposure:number,
 *             pulse?:{light:string, speed:number, depth?:number, lightning?:boolean}}} LightPreset */

/** @type {Record<string, LightPreset>} */
export const LIGHTING_PRESETS = {
  // The baseline. `warm` used to run at 95 against cool 34 and accent 42, and
  // it sits lower and closer to the action than either — so a hue census of the
  // finished frame (8 camera angles, penthouse) came back 61.8% warm amber,
  // 3.8% cyan, 1.7% magenta. The neon-noir game rendered as a brown room. The
  // amber is a practical lamp and should read as one: a warm pool you walk
  // through, not the key light. Cyan and magenta now carry the room, backed by
  // real spill from the visible neon runs (see zoneBuilder `light:` opts).
  neon_night: {
    hemi: { sky: 0x2a4a8a, ground: 0x141020, intensity: 1.1 },
    key: { color: 0xbfd8ff, intensity: 1.1, pos: [6, 10, 10] },
    warm: { color: 0xffb347, intensity: 34 },
    cool: { color: 0x39e6ff, intensity: 46 },
    accent: { color: 0xff3fa4, intensity: 58 },
    fog: { color: 0x06070c, density: 0.012 },
    exposure: 1.1,
  },
  blackout_emergency: {
    hemi: { sky: 0x1a0a0a, ground: 0x050205, intensity: 0.4 },
    key: { color: 0x883333, intensity: 0.2, pos: [6, 10, 10] },
    warm: { color: 0xff4757, intensity: 30 },
    cool: { color: 0x220a14, intensity: 8 },
    accent: { color: 0xff2222, intensity: 110 },
    fog: { color: 0x040205, density: 0.03 },
    exposure: 0.9,
    pulse: { light: 'accent', speed: 2.2 },
  },
  golden_hour: {
    hemi: { sky: 0x8a5a3a, ground: 0x241418, intensity: 1.2 },
    key: { color: 0xffa25c, intensity: 2.2, pos: [10, 5, 8] },
    warm: { color: 0xffb347, intensity: 60 },
    cool: { color: 0x6a86b0, intensity: 12 },
    accent: { color: 0xff7a4d, intensity: 24 },
    fog: { color: 0x1a1010, density: 0.010 },
    exposure: 1.15,
  },
  candlelit: {
    hemi: { sky: 0x1c1410, ground: 0x0a0604, intensity: 0.35 },
    key: { color: 0x443322, intensity: 0.15, pos: [6, 10, 10] },
    warm: { color: 0xff9a3c, intensity: 70 },
    cool: { color: 0x14100a, intensity: 3 },
    accent: { color: 0xcc6a2a, intensity: 16 },
    fog: { color: 0x080503, density: 0.02 },
    exposure: 1.0,
    pulse: { light: 'warm', speed: 9.5, depth: 0.12 },
  },
  dawn_grey: {
    hemi: { sky: 0x5a6a7e, ground: 0x1c2028, intensity: 1.2 },
    key: { color: 0xc8d4e2, intensity: 1.0, pos: [8, 8, 10] },
    warm: { color: 0xd8c8b8, intensity: 26 },
    cool: { color: 0x8aa0b8, intensity: 20 },
    accent: { color: 0x88788a, intensity: 10 },
    fog: { color: 0x10141a, density: 0.014 },
    exposure: 0.95,
  },
  storm: {
    hemi: { sky: 0x2a3442, ground: 0x0c1014, intensity: 0.8 },
    key: { color: 0x8a9ab0, intensity: 0.7, pos: [4, 12, 6] },
    warm: { color: 0xffb347, intensity: 60 },
    cool: { color: 0x39536b, intensity: 22 },
    accent: { color: 0x5a6e8c, intensity: 18 },
    fog: { color: 0x080b10, density: 0.022 },
    exposure: 0.95,
    pulse: { light: 'key', speed: 0.35, depth: 3.2, lightning: true },
  },
  club_pulse: {
    hemi: { sky: 0x2a1040, ground: 0x100518, intensity: 0.5 },
    key: { color: 0x6a3aa0, intensity: 0.4, pos: [6, 10, 10] },
    warm: { color: 0xff3fa4, intensity: 60 },
    cool: { color: 0x9d6bff, intensity: 60 },
    accent: { color: 0xff3fa4, intensity: 90 },
    fog: { color: 0x0a0512, density: 0.018 },
    exposure: 1.05,
    pulse: { light: 'accent', speed: 4.4 },
  },
  fireplace_warm: {
    hemi: { sky: 0x2a1a10, ground: 0x0e0806, intensity: 0.5 },
    key: { color: 0x554433, intensity: 0.2, pos: [6, 10, 10] },
    warm: { color: 0xff8833, intensity: 110 },
    cool: { color: 0x1a1208, intensity: 4 },
    accent: { color: 0xd06a2a, intensity: 20 },
    fog: { color: 0x0a0604, density: 0.016 },
    exposure: 1.05,
    pulse: { light: 'warm', speed: 7.3, depth: 0.15 },
  },
  security_red: {
    hemi: { sky: 0x2a1014, ground: 0x0a0406, intensity: 0.55 },
    key: { color: 0xaa4444, intensity: 0.45, pos: [6, 10, 10] },
    warm: { color: 0xff6a5c, intensity: 30 },
    cool: { color: 0x3a1a20, intensity: 10 },
    accent: { color: 0xff3040, intensity: 60 },
    fog: { color: 0x0c0508, density: 0.02 },
    exposure: 0.95,
  },
  morning_haze: {
    hemi: { sky: 0x8a8a7e, ground: 0x2a2822, intensity: 1.4 },
    key: { color: 0xfff2dc, intensity: 1.8, pos: [10, 7, 9] },
    warm: { color: 0xffe0b0, intensity: 30 },
    cool: { color: 0xb0c4d0, intensity: 16 },
    accent: { color: 0xc8b090, intensity: 12 },
    fog: { color: 0x1c1e1e, density: 0.024 },
    exposure: 1.1,
  },
};

/** time-of-day keyframes over dayFraction (0 = midnight); modulates the key light
 *  + hemisphere + exposure when the active preset is tod-aware (neon_night). */
export const TOD_KEYS = [
  { t: 0.00, key: { color: 0xbfd8ff, i: 1.1 }, hemi: 1.0, exp: 1.0 },
  { t: 0.22, key: { color: 0xbfd8ff, i: 1.0 }, hemi: 1.0, exp: 1.0 },
  { t: 0.28, key: { color: 0xffb0a0, i: 1.5 }, hemi: 1.4, exp: 1.05 },
  { t: 0.42, key: { color: 0xf0f4ff, i: 2.6 }, hemi: 2.1, exp: 1.15 },
  { t: 0.58, key: { color: 0xffffff, i: 2.9 }, hemi: 2.3, exp: 1.18 },
  { t: 0.72, key: { color: 0xffc890, i: 2.0 }, hemi: 1.7, exp: 1.1 },
  { t: 0.79, key: { color: 0xff9a5c, i: 1.6 }, hemi: 1.3, exp: 1.05 },
  { t: 0.86, key: { color: 0xbfd8ff, i: 1.1 }, hemi: 1.0, exp: 1.0 },
  { t: 1.00, key: { color: 0xbfd8ff, i: 1.1 }, hemi: 1.0, exp: 1.0 },
];
