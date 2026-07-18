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
};

function checkNode(node, val, path, errs) {
  if (val === undefined) return;
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
