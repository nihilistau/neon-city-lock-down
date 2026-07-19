// @ts-check
// Config validation. Mirrors data/configDefaults.js structure; validateConfig()
// checks a (possibly partial) group object and returns an array of human-readable
// error strings (empty = valid). Used by src/core/config.js (reject bad live
// edits) and tools/lint-config.mjs (CI). PURE — no imports, Node + browser safe.
//
// Schema node shapes:
//   { type:'number'|'string'|'boolean', min?, max?, enum? }  — a scalar leaf
//   { array:'number', len? }                                  — array of a type
//   { map: <node> }                                           — free-form key → node
//   { <key>: <node>, ... }                                    — fixed-shape object

const num = (min, max) => ({ type: 'number', min, max });

/** @type {Record<string, any>} */
export const CONFIG_SCHEMA = {
  camera: {
    eye: num(0.8, 2.2), radius: num(0.1, 0.8), walkSpeed: num(0.5, 12), runSpeed: num(0.5, 16),
    mouseSensitivity: num(0.0002, 0.02), pitchClamp: num(0.5, 1.55), lookSmoothing: num(4, 120),
    mouselook: { maxDelta: num(5, 300), spikeDelta: num(50, 2000), settleMs: num(0, 1000) },
    thirdPerson: { shoulderDist: num(0.5, 10), shoulderSide: num(0, 3), shoulderUp: num(-1, 2) },
    aimAssist: { strength: num(0, 40), stickDeg: num(0, 90), softenMs: num(0, 2000) },
    director: {
      shots: { map: { priority: num(0, 100), ttl: num(0, 1e12) } },
      easeBase: num(1e-6, 0.5), shakeOnHit: num(0, 3), shakeDecay: num(1e-4, 1), shakeAmp: num(0, 1),
      establishing: { radius: num(1, 30), height: num(0.5, 20), speed: num(0, 5) },
      action: { eyeY: num(0.5, 12), spanFactor: num(0, 5), spanPad: num(0, 20) },
      event: { eyeY: num(0.5, 20) },
    },
    rig: {
      orbit: { damping: num(0.001, 1), maxPolar: num(0.1, 3.14), minDist: num(0.1, 40), maxDist: num(1, 200) },
      target: { array: 'number', len: 3 },
      initialPos: { array: 'number', len: 3 },
    },
  },
  combat: {
    weapons: { map: { id: { type: 'string' }, damage: { array: 'number', len: 2 }, accuracy: num(0, 1), range: num(0.1, 100) } },
    hostileArchetypes: { map: { hp: num(1, 100000), skill: num(0, 100), weapon: { type: 'string' }, speed: num(0.1, 20), aggression: num(0, 1) } },
    magSize: { map: num(1, 999) },
    turretPeriod: num(0.1, 60), waveDelay: num(0, 120),
    cover: {
      minTop: num(0, 3), maxTop: num(0, 3), nearM: num(0.1, 20), tallAt: num(0, 3),
      qualityTall: num(0, 1), qualityLow: num(0, 1), maxRange: num(1, 100), offset: num(0, 5),
    },
  },
  sim: {
    scheduler: {
      rollEveryMin: num(1, 1440), minGapMin: num(0, 1440), fireChanceBase: num(0, 1),
      fireChanceThreatScale: num(0, 0.1), fireChanceMax: num(0, 1),
    },
    threat: {
      dayBaseStart: num(0, 100), dayBasePerDay: num(0, 50), dayBaseCap: num(0, 100),
      nightBoost: num(0, 50), duskBoost: num(0, 50), waveAmp: num(0, 50), ease: num(0, 1),
      spikeDecay: num(0, 1), flareChance: num(0, 1), flareMin: num(0, 50), flareMax: num(0, 50),
    },
    survival: {
      mealsPerDay: num(0, 24), waterPerDay: num(0, 24),
      hungerRate: num(0, 20), hungerRelief: num(0, 20), thirstRate: num(0, 20), thirstRelief: num(0, 20),
      hungerHealthAt: num(0, 100), hungerHealthLoss: num(0, 50), thirstHealthAt: num(0, 100), thirstHealthLoss: num(0, 50),
      moraleFoodDrain: num(0, 20), moraleWaterDrain: num(0, 20), moraleRecover: num(0, 20),
      castFoodShortAt: num(0, 1), castWaterShortAt: num(0, 1), warnFoodAt: num(0, 100), warnWaterAt: num(0, 100),
    },
    systems: {
      degrade: { map: num(0, 100) }, offlineHp: num(0, 100), cellDrainPer30: num(0, 100),
    },
    dayPlan: {
      apPerDay: num(1, 24),
      repair: { ap: num(0, 24), cost: num(0, 99), amount: num(0, 100) },
      fortify: { ap: num(0, 24), cost: num(0, 99), defence: num(0, 100), threatDrop: num(0, 100) },
      forage: { ap: num(0, 24), foodBase: num(0, 99), foodRand: num(0, 99), waterRand: num(0, 99), partsChance: num(0, 1) },
      train: { ap: num(0, 24), gain: num(0, 100), cap: num(0, 100) },
      rest: { ap: num(0, 24), health: num(0, 100), morale: num(0, 100) },
      deal: { ap: num(0, 24), cost: num(0, 99), threatDrop: num(0, 100) },
    },
  },
  chars: {
    startStats: { map: num(0, 100) },
    coupling: {
      tensionSuppress: num(0, 2), fearSuppress: num(0, 2), intoxArousal: num(0, 2), intoxOpen: num(0, 2),
      fearClose: num(0, 2), tensionTrust: num(0, 2), pleasureBase: num(0, 2), pleasureArousal: num(0, 2), fearTension: num(0, 2),
    },
    decay: {
      rest: { map: num(0, 100) }, rate: { map: num(0, 20) }, approachFactor: num(0, 2), sobrietyRegain: num(0, 10),
    },
    compliance: {
      trust: num(0, 1), openness: num(0, 1), happiness: num(0, 1), loyalty: num(0, 1), calm: num(0, 1), brave: num(0, 1),
      clashScale: num(0, 2), clashMin: num(-100, 0), clashMax: num(0, 100),
    },
    gates: {
      thresholds: { map: { map: num(0, 100) } },
      explicitnessCap: { suggestive: { type: 'string' }, mature: { type: 'string' }, full: { type: 'string' } },
    },
  },
  lighting: {
    // presets/tod are deep free-form structures (colors, intensities, pulse variants);
    // validated as present objects — the game tolerates missing fields (falls back).
    presets: { map: { any: true } },
    tod: { array: 'object' },
  },
  humanoid: {
    gait: {
      strideLen: num(0.1, 3), walkSpeed: num(0.1, 10), thighAmp: num(0, 90), shinFlex: num(0, 120),
      armAmp: num(0, 90), hipBob: num(0, 0.5), hipDrop: num(0, 0.5), hipShift: num(0, 0.5),
    },
    animator: { crossfade: num(0, 3) },
    skeleton: { armAngle: num(0, 90) },
  },
  world: {
    clock: {
      startHour: num(0, 23), speed: num(0.01, 240),
      dawnStart: num(0, 24), dayStart: num(0, 24), duskStart: num(0, 24), nightStart: num(0, 24),
    },
  },
  gameplay: {
    bed: {
      startTrust: num(0, 100), startArousal: num(0, 100),
      willing: {
        arousal: num(0, 2), horniness: num(0, 2), trust: num(0, 2), openness: num(0, 2),
        tension: num(0, 2), fear: num(0, 2), base: num(0, 100), perTier: num(0, 50),
      },
      climaxTier: num(0, 7), climaxPleasure: num(0, 100), climaxArousal: num(0, 100), safewordGap: num(0, 100),
    },
  },
  llm: {
    connection: { baseUrl: { type: 'string' }, apiKeyFile: { type: 'string' } },
    models: { function: { type: 'string' }, draft: { type: 'string' } },
    sampling: { topP: num(0, 1), topK: num(0, 500), minP: num(0, 1), repeatPenalty: num(0, 3) },
    budgets: { normal: num(1, 32000), heated: num(1, 32000), rewrite: num(1, 32000) },
    reasoning: { startTag: { type: 'string' }, endTag: { type: 'string' } },
    ttlSeconds: num(1, 604800),
    stopStrings: { array: 'string' },
    structured: { temperature: num(0, 2), maxTokens: num(1, 8192) },
    interceptors: { timing: { type: 'boolean' }, retry: num(0, 10) },
  },
  voice: {
    voxtralDir: { type: 'string' }, binary: { type: 'string' }, gguf: { type: 'string' }, voicesDir: { type: 'string' },
    eulerSteps: num(1, 50), maxFrames: num(100, 20000), sampleRate: num(8000, 48000), port: num(1, 65535),
    cast: { map: { type: 'string' } },
    userVoicesDir: { type: 'string' }, userDialogueDir: { type: 'string' },
  },
};

function checkNode(node, val, path, errs) {
  if (val === undefined) return;
  if (node.any) return;   // permissive escape for complex free-form data (e.g. lighting presets)
  // scalar leaf
  if (node.type) {
    if (node.type === 'number' && typeof val !== 'number') return errs.push(`${path}: expected number, got ${typeof val}`);
    if (node.type === 'string' && typeof val !== 'string') return errs.push(`${path}: expected string`);
    if (node.type === 'boolean' && typeof val !== 'boolean') return errs.push(`${path}: expected boolean`);
    if (typeof val === 'number') {
      if (node.min !== undefined && val < node.min) errs.push(`${path}: ${val} < min ${node.min}`);
      if (node.max !== undefined && val > node.max) errs.push(`${path}: ${val} > max ${node.max}`);
    }
    if (node.enum && !node.enum.includes(val)) errs.push(`${path}: "${val}" not in [${node.enum.join(', ')}]`);
    return;
  }
  if (node.array) {
    if (!Array.isArray(val)) return errs.push(`${path}: expected array`);
    if (node.len !== undefined && val.length !== node.len) errs.push(`${path}: expected length ${node.len}, got ${val.length}`);
    val.forEach((v, i) => checkNode({ type: node.array }, v, `${path}[${i}]`, errs));
    return;
  }
  if (node.map) {
    if (typeof val !== 'object' || Array.isArray(val)) return errs.push(`${path}: expected object`);
    for (const [k, v] of Object.entries(val)) checkNode(node.map, v, `${path}.${k}`, errs);
    return;
  }
  // fixed-shape object
  if (typeof val !== 'object' || Array.isArray(val)) return errs.push(`${path}: expected object`);
  for (const [k, v] of Object.entries(val)) {
    if (!(k in node)) { errs.push(`${path}.${k}: unknown key`); continue; }
    checkNode(node[k], v, `${path}.${k}`, errs);
  }
}

/**
 * Validate a (partial) config group object. Returns [] if valid.
 * @param {string} group @param {any} obj
 * @returns {string[]}
 */
export function validateConfig(group, obj) {
  const schema = CONFIG_SCHEMA[group];
  if (!schema) return [`unknown config group "${group}"`];
  if (obj == null || typeof obj !== 'object') return [`${group}: root must be a mapping`];
  const errs = [];
  checkNode(schema, obj, group, errs);
  return errs;
}
