// @ts-check
// Engine config DEFAULTS — the single source of truth for every tunable knob.
// Each top-level key is a config GROUP that maps 1:1 to a `config/<group>.yaml`
// file: at boot, src/core/config.js fetches that YAML and deep-merges it over
// these defaults, so the game runs IDENTICALLY when no config/ dir exists.
// Read values at runtime via cfg('group.path.to.key'). Documented in docs/config/.
//
// This module is PURE DATA so Node tooling (tools/lint-config.mjs, unit tests)
// and the browser can both import it. Larger data sets (e.g. lighting presets)
// live in their own pure module and are referenced here. Phases add groups.
import { LIGHTING_PRESETS, TOD_KEYS } from './lightingPresets.js';

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
        dialogue: { priority: 3, ttl: 8 },
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
      orbit: { damping: 0.08, maxPolar: Math.PI * 0.52, minDist: 1.2, maxDist: 18 }, // just past horizontal
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
      fists: { id: 'fists', damage: [3, 6], accuracy: 0.88, range: 0.9 },
    },
    hostileArchetypes: {
      rioter: { hp: 45, skill: 30, weapon: 'pipe', speed: 1.5, aggression: 0.8 },
      looter: { hp: 35, skill: 25, weapon: 'shiv', speed: 1.7, aggression: 0.5 },
      merc: { hp: 70, skill: 65, weapon: 'smg', speed: 1.3, aggression: 0.95 },
    },
    magSize: { sidearm: 12, smg: 25, pipe: 1, shiv: 1, fists: 1 },
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

  // ── sim: event pacing, threat pressure, survival economy, day-plan actions ──
  sim: {
    scheduler: {
      rollEveryMin: 45,        // roll for a random event ~every N game-min
      minGapMin: 150,          // hard floor between the END of one event and the next
      fireChanceBase: 0.18,    // base per-roll fire probability
      fireChanceThreatScale: 0.0015, // added per point of threat
      fireChanceMax: 0.4,      // cap on per-roll fire probability
    },
    threat: {
      dayBaseStart: 12,        // baseline threat contribution on day 1
      dayBasePerDay: 7,        // added per day
      dayBaseCap: 60,          // cap on the day baseline
      nightBoost: 8, duskBoost: 5,
      waveAmp: 6,              // amplitude of the diurnal threat wave
      ease: 0.004,             // ease rate toward the target each minute
      spikeDecay: 0.9985,      // per-minute decay of an event spike
      flareChance: 0.002,      // per-minute chance of a random flare
      flareMin: 1, flareMax: 4,
      // tower-system + flag consequences (added toward the threat TARGET)
      camerasBlindPenalty: 8,  // cameras offline → VOX is blind, threat sits higher
      jammerRelief: 12,        // a live signal jammer suppresses threat…
      jammerDurationMin: 240,  // …for this many game-minutes after use
      ceasefireRelief: 12,     // a brokered faction ceasefire eases the baseline
    },
    survival: {
      mealsPerDay: 3, waterPerDay: 1,   // per head
      hungerRate: 1.4, hungerRelief: 1.6, thirstRate: 2.0, thirstRelief: 2.4,
      hungerHealthAt: 80, hungerHealthLoss: 1, thirstHealthAt: 75, thirstHealthLoss: 2,
      moraleFoodDrain: 1.2, moraleWaterDrain: 1.5, moraleRecover: 0.25,
      castFoodShortAt: 0.3, castWaterShortAt: 0.3,
      warnFoodAt: 6, warnWaterAt: 8,
      // NPC mortality from deprivation — graded, not binary. Loss ramps from 0
      // at `castStarveAt` to the full rate at a total shortfall.
      castStarveAt: 0.25,        // shortfall fraction below which nobody is harmed
      castStarveLoss: 6,         // max hp/hour from hunger, at a total food shortfall
      castThirstLoss: 8,         // max hp/hour from thirst (outpaces hunger)
      castRegen: 1.5,            // hp/hour regained when fed and watered
    },
    systems: {
      degrade: { power: 4, water: 3, defence: 6, elevator: 2, cameras: 5 }, // per-day HP loss
      offlineHp: 12,           // a system goes offline at/below this HP
      cellDrainPer30: 0.5,     // reserve cell drain per 30 min while the grid is down
    },
    dayPlan: {
      apPerDay: 4,             // action points per day
      repair: { ap: 1, cost: 1, amount: 35 },
      fortify: { ap: 1, cost: 1, defence: 20, threatDrop: 8 },
      forage: { ap: 1, foodBase: 2, foodRand: 3, waterRand: 3, partsChance: 0.35,
                blightMul: 0.4 },   // multiplier once the rooftop garden is blighted
      // Refugees earn their keep, so taking one in is a bet rather than a
      // slow-motion death sentence: a mouth today, a pair of hands tomorrow.
      refugeeWork: { ap: 1, foodPer: 3 },
      refugeeRelease: { ap: 0, morale: 10 },   // the cost of asking them to leave
      train: { ap: 1, gain: 7, cap: 92 },
      rest: { ap: 1, health: 16, morale: 12 },
      deal: { ap: 2, cost: 3, threatDrop: 20 },
    },
  },

  // ── chars: stat model coupling/decay/compliance + intimacy-gate thresholds ──
  chars: {
    startStats: {   // defaultStats() baseline before persona overrides
      arousal: 5, pleasure: 15, happiness: 50, horniness: 10, openness: 30, dominance: 50,
      trust: 20, tension: 25, energy: 75, sobriety: 100, loyalty: 10, fear: 5,
    },
    coupling: {     // cross-stat gain modifiers (src/chars/stats.js couplingFactor)
      tensionSuppress: 0.55,  // arousal/horniness gain suppressed per unit tension
      fearSuppress: 0.5,      // …per unit fear
      intoxArousal: 0.4,      // intoxication amplifies arousal gain
      intoxOpen: 0.5,         // intoxication amplifies openness gain
      fearClose: 0.4,         // fear suppresses openness gain
      tensionTrust: 0.4,      // tension suppresses trust gain
      pleasureBase: 0.3,      // pleasure gain floor
      pleasureArousal: 0.9,   // …plus this × arousal
      fearTension: 0.35,      // fear amplifies tension gain
    },
    decay: {        // passive homeostatic regression (decayTick)
      rest: { arousal: 5, horniness: 8, tension: 22, pleasure: 12, fear: 4 },
      rate: { arousal: 0.5, horniness: 0.35, tension: 0.25, pleasure: 0.6, fear: 0.4 },
      approachFactor: 0.3,    // rise-toward-rest is this fraction of the fall rate
      sobrietyRegain: 0.35,   // sobriety per minute
    },
    compliance: {   // compliance() weights (0..1) + dominance clash
      trust: 0.30, openness: 0.22, happiness: 0.14, loyalty: 0.14, calm: 0.12, brave: 0.08,
      clashScale: 0.35, clashMin: -20, clashMax: 35,
    },
    bond: {         // relationship tier (src/chars/bond.js), on (trust + loyalty) / 2
      thresholds: { ally: 35, trusted: 55, loyal: 75 },
      hysteresis: 5,  // a held tier survives until the score drops below entry - this
    },
    gates: {        // intimacy ladder (src/chars/gates.js)
      thresholds: {   // minimum stats to OFFER each tier
        light_touch: { trust: 15, openness: 18 },
        kiss: { trust: 26, arousal: 22, openness: 30 },
        touch: { trust: 34, arousal: 38, horniness: 28 },
        undress: { trust: 42, arousal: 52, horniness: 42, openness: 46 },
        intimate: { trust: 48, arousal: 62, horniness: 56 },
        explicit: { trust: 54, arousal: 72, horniness: 66, openness: 56 },
        depraved: { trust: 60, arousal: 82, horniness: 78, openness: 66, loyalty: 28 },
      },
      explicitnessCap: { suggestive: 'kiss', mature: 'intimate', full: 'depraved' },
    },
  },

  // ── lighting: named presets + time-of-day keyframes (see data/lightingPresets.js) ──
  lighting: {
    presets: LIGHTING_PRESETS,   // 10 presets: neon_night, blackout_emergency, golden_hour, …
    tod: TOD_KEYS,               // time-of-day key/hemi/exposure keyframes (neon_night is ToD-aware)
    envIntensity: 0.4,           // image-based lighting strength (src/scene3d/env.js).
                                 // 0 disables reflections entirely; >1 overpowers the key/fill balance.
    hemiScale: 0.45,             // presets were authored with no env map, so their hemisphere light
                                 // stood in for all ambient bounce. Scale it back now that IBL is real,
                                 // or the two double-count and the scene goes flat. 1 = no compensation.
  },

  // ── render: the post-FX stack and shadow quality ──
  // Every one of these was hardcoded in src/scene3d/*. They are the settings a
  // player reaches for when the game runs hot or looks wrong on their panel, and
  // there was no way to touch any of them. Phase 6 hangs the graphics menu here.
  render: {
    shadows: 'soft',             // 'off' | 'hard' | 'soft' — soft is PCFSoftShadowMap
    shadowMapSize: 2048,         // per-side texels for the key light's shadow map
    ao: {
      enabled: true,
      radius: 0.45,              // world-space sample radius in metres
      intensity: 0.9,            // 0 = no darkening, 1 = full occlusion in creases
      bias: 0.025,               // depth slack, in metres; too low = self-occlusion acne
      samples: 12,               // hemisphere taps per pixel
    },
    bloom: {
      strength: 0.42,
      radius: 0.40,
      threshold: 1.55,           // LINEAR HDR, pre-tonemap. Above lit skin/hair, below the neon core.
    },
    grain: { amount: 0.055, vignette: 0.42 },
    fov: 55,                     // vertical field of view, degrees
  },

  // ── humanoid: procedural walk cycle + animation blending ──
  humanoid: {
    gait: {                      // src/humanoid/gait.js pose amplitudes (degrees, metres)
      strideLen: 0.62,           // metres per step at full walk
      walkSpeed: 1.25,           // m/s considered "full walk" (amplitude scale)
      thighAmp: 26, shinFlex: 38, armAmp: 13,   // swing amplitudes, degrees
      hipBob: 0.028, hipDrop: 0.012, hipShift: 0.014,  // hip bob/shift, metres
    },
    animator: { crossfade: 0.3 },  // clip crossfade duration, seconds
    skeleton: { armAngle: 42 },    // A-pose arm angle from vertical (deg); proportions are code-defined
    body: {                      // swept-limb mesh density + skin weighting (src/humanoid/bodyBuilder.js)
      radialTrunk: 20,           // ring segments around the torso/neck/head stack
      radialLimb: 12,            // ring segments around arms (legs use +2)
      skinBand: 0.030,           // chain blend half-width, FRACTION OF HEIGHT
      deltoidBlend: 0.80,        // share of the shoulder shelf driven by the arm bone
      gluteBlend: 0.55,          // share of the seat driven by the thigh bone
      jawBlend: 0.85,            // share of the chin mass driven by the jaw bone
    },
    skin: {                      // skin material (retuned for the procedural IBL)
      roughness: 0.62, sheen: 0.65, sheenRoughness: 0.72,
      envMapIntensity: 0.7,      // keep low: bloom threshold is 0.86, bodies must not glow
      subsurface: 0.55,          // wrap-lighting subsurface strength (0 = off, stock lighting)
      subsurfaceWrap: 0.55,      // how far light wraps past the terminator
    },
    hair: {                      // generated strand cards + secondary sway
      strands: 0,                // 0 = use the per-style count (short 52 / bob 62 / long 72)
      fallScale: 1,              // multiplier on the free-fall length
      // Measured against the head-region blowout: sheen and (especially) any
      // clearcoat/anisotropy on backlit strands clip to white under the strong
      // point lights and bloom smears it across the head. These are the values
      // that measured clean (~82 blown px vs ~17200) while still reading as hair.
      roughness: 0.80,
      sheen: 0.12,               // whisper of retroreflection; higher re-blooms
      anisotropy: 0,             // OFF — a primary blowout driver on strands
      envMapIntensity: 0.12,
      stiffness: 55, damping: 9, // hair1..hair3 spring
      sway: 0.030,               // radians per m/s² of body-space acceleration
      idleSway: 0.035,           // ambient drift so hair is never dead still, radians
      maxDeg: 26,                // per-bone clamp
    },
    eye: {                       // eyeballs — the glossiest surface on a character
      // A wet sclera, not chrome. At roughness 0.20 the lounge lamp (95 candela)
      // put a specular here hot enough to clear the bloom threshold, and because
      // the blink scheduler covers/uncovers the eyes it winked on and off — it
      // read as blinking lights on every head. Lower roughness at your own risk.
      sclera: 0xdedad2,          // off-white; pure white is what blew out
      roughness: 0.38, envMapIntensity: 0.22,
      catchlight: 0.55,          // painted iris highlight; the iris is UNLIT, so 1.0 blooms
    },
    face: {
      redrawHz: 15,              // canvas repaint cap (skipped entirely when hidden)
      jawOpenDeg: 14,            // jaw bone rotation at full mouth open
      relief: 1,                 // nose/brow/lip/chin displacement scale (0 = flat patch)
      borderTuck: 0.014,         // how far the patch rim sinks into the skull, fraction of height
    },
    outfit: {                    // garment shells (src/humanoid/outfitBuilder.js)
      clearance: 0.0055,         // gap over the skin, FRACTION OF HEIGHT
      thickness: 0.0032,         // fabric thickness (drives the visible hem), fraction of height
      radial: 18,                // ring segments around a garment
      envMapIntensity: 0.7,
    },
  },

  // ── world: clock pace + phase boundaries ──
  world: {
    clock: {
      startHour: 18,             // Day 1 start hour (lockdown declared at dusk)
      speed: 1,                  // game minutes per real second
      dawnStart: 5, dayStart: 8, duskStart: 17, nightStart: 20,  // phase band hours
    },
  },

  // ── gameplay: bed-game desire / climax / safeword tuning ──
  gameplay: {
    bed: {
      startTrust: 15, startArousal: 20,   // start gate: needs trust ≥ startTrust OR arousal ≥ startArousal
      willing: {   // desire-based willingness (bedGame._willing)
        arousal: 0.42, horniness: 0.30, trust: 0.16, openness: 0.12,   // desire weights
        tension: 0.22, fear: 0.45,                                     // resistance weights
        base: 18, perTier: 5,                                          // need = base + tierIndex·perTier
      },
      climaxTier: 4, climaxPleasure: 82, climaxArousal: 70,   // climax requires tier ≥ / pleasure ≥ / arousal ≥
      safewordGap: 30,          // partner withdraws when tension > arousal + gap
    },
  },

  // ── llm: LM Studio engine knobs. Chat model / temperature / thinking on-off /
  //    per-character interaction live in the LLM panel (settings.llm); this group
  //    is the ADVANCED surface consumed by tools/gameEngine.mjs + the agent. ──
  llm: {
    connection: {
      baseUrl: 'ws://127.0.0.1:1234',   // LM Studio WebSocket URL (env LMS_BASE_URL overrides)
      apiKeyFile: 'lmstudio-api-key.txt', // relative to project root; holds sk-lm-<id>:<passkey>
    },
    models: {
      function: 'google/functiongemma-270m', // tiny model for structured tag extraction
      draft: '',                // speculative-decoding draft model key ('' = off)
    },
    sampling: {                 // extra per-request sampling (temperature = panel "warmth")
      topP: 0.95, topK: 40, minP: 0, repeatPenalty: 1.1,
    },
    budgets: {                  // max reply tokens by situation (agent.js)
      normal: 1600, heated: 2200, rewrite: 300,
    },
    reasoning: {                // <think> parsing markers (thinking on/off = panel toggle)
      startTag: '<think>', endTag: '</think>',
    },
    ttlSeconds: 86400,          // how long a JIT-loaded model stays resident (24h)
    stopStrings: [],            // hard stop sequences ([] = none)
    structured: {               // function-model extraction sampling
      temperature: 0.2, maxTokens: 200,
    },
    interceptors: {             // engine middleware toggles
      timing: false,            // log per-request latency/tps
      retry: 0,                 // auto-retry a failed generation N times
    },
  },

  // ── voice: Voxtral TTS engine paths + casting (tools/sidecar.mjs voice server) ──
  voice: {
    voxtralDir: 'third_party/voxtral', // project-root-relative or absolute; env VOXTRAL_DIR overrides
    binary: 'target/release/voxtral.exe',        // relative to voxtralDir
    gguf: 'models/voxtral-tts-q4.gguf',          // Q4 TTS model (relative to voxtralDir)
    voicesDir: 'models/voxtral-tts/voice_embedding', // dir of <name>.safetensors voice embeddings
    eulerSteps: 3,             // 3 = real-time, 4 = balanced, 8 = quality
    maxFrames: 2000,           // cap per synth call (~160 s at 12.5 Hz)
    sampleRate: 24000,         // voxtral output: 24 kHz / 16-bit / mono WAV
    port: 8425,                // voice server port
    cast: {                    // character → voice preset (VOICE_CAST override)
      lola: 'neutral_female', aria: 'cheerful_female', kai: 'casual_male',
      vox: 'neutral_male', radio: 'casual_female',
    },
    userVoicesDir: 'user/voices',      // saved clips + cloned embeddings land here
    userDialogueDir: 'user/dialogue',  // user-authored spoken lines
  },
};
