// @ts-check
// Engine config DEFAULTS — the single source of truth for every tunable knob.
// Each top-level key is a config GROUP that maps 1:1 to a `config/<group>.yaml`
// file: at boot, src/core/config.js fetches that YAML and deep-merges it over
// these defaults, so the game runs IDENTICALLY when no config/ dir exists.
// Read values at runtime via cfg('group.path.to.key'). Documented in docs/config/.
//
// This module is PURE DATA (no imports) so Node tooling (tools/lint-config.mjs,
// unit tests) and the browser can both import it. Phases add groups here.

export const CONFIG_DEFAULTS = {
  // ── camera: first/third person controller, situational director, orbit rig ──
  camera: {
    eye: 1.62,                 // eye height, metres
    radius: 0.26,              // body collision radius
    walkSpeed: 2.6,            // m/s
    runSpeed: 4.4,             // m/s (shift)
    mouseSensitivity: 0.0019,  // base rad per mouse px (× settings.mouseSensitivity)
    pitchClamp: 1.35,          // max look up/down, radians
    lookSmoothing: 30,         // ease rate toward the look target (×dt)
    mouselook: {
      maxDelta: 40,            // px/event clamp
      spikeDelta: 200,         // px/event → dropped as an impossible spike
      settleMs: 160,           // ignore mouselook this long after lock/focus/blur
    },
    thirdPerson: {
      shoulderDist: 2.7,       // camera distance behind the player
      shoulderSide: 0.85,      // over-the-shoulder side offset (body in one third)
      shoulderUp: 0.14,        // pivot raise above the eye
    },
    aimAssist: {
      strength: 7.0,           // per-second pull toward the sticky target
      stickDeg: 22,            // half-angle cone (deg) within which magnetism engages
      softenMs: 220,           // magnetism ramps back over this long after a manual look
    },
    director: {
      shots: {
        dialogue: { priority: 3, ttl: 4.5 },
        action: { priority: 6, ttl: 1e9 },
        event: { priority: 4, ttl: 4 },
      },
      easeBase: 0.0008,        // per-second lerp base (1 - base^dt)
      shakeOnHit: 0.5,         // handheld shake impulse when the player is hit
      shakeDecay: 0.06,        // shake decay base (^dt)
      shakeAmp: 0.06,          // shake amplitude in metres
      establishing: { radius: 4.2, height: 2.6, speed: 0.12 },
      action: { eyeY: 2.2, spanFactor: 0.9, spanPad: 1.5 },
      event: { eyeY: 3.1 },
    },
    rig: {
      orbit: { damping: 0.08, maxPolar: 1.6336, minDist: 1.2, maxDist: 18 }, // maxPolar = PI*0.52
      target: [-3.5, 1.1, 0],
      initialPos: [2.5, 3.2, 5.5],
    },
  },

  // ── combat: weapons, hostile archetypes, magazines, cover, turret ──
  combat: {
    // field names match resolver.js so WEAPONS/HOSTILE_ARCHETYPES re-export cleanly
    weapons: {
      sidearm: { id: 'sidearm', damage: [12, 22], accuracy: 0.78, range: 9 },
      smg: { id: 'smg', damage: [8, 14], accuracy: 0.6, range: 7 },
      pipe: { id: 'pipe', damage: [6, 12], accuracy: 0.85, range: 1.2 },
      shiv: { id: 'shiv', damage: [5, 10], accuracy: 0.8, range: 1 },
    },
    hostileArchetypes: {
      rioter: { hp: 45, skill: 30, weapon: 'pipe', speed: 1.5, aggression: 0.8 },
      looter: { hp: 35, skill: 25, weapon: 'shiv', speed: 1.7, aggression: 0.5 },
      merc: { hp: 70, skill: 65, weapon: 'smg', speed: 1.3, aggression: 0.95 },
    },
    magSize: { sidearm: 12, smg: 25, pipe: 1, shiv: 1 },
    turretPeriod: 2.6,         // seconds between turret shots
    waveDelay: 6,              // seconds between breach waves
    cover: {
      minTop: 0.5,             // min furniture height to count as cover
      maxTop: 1.45,            // height at which cover saturates
      nearM: 2.2,              // must be within this to use a cover spot
      tallAt: 0.9,             // furniture at/above this height (m) gives tall-cover quality
      qualityTall: 0.65,       // cover quality for tall furniture (top ≥ tallAt)
      qualityLow: 0.4,         // cover quality otherwise
      maxRange: 14,            // max search range for a cover spot
      offset: 0.55,            // stand-off distance behind cover
    },
  },
};
