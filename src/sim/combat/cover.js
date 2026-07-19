// @ts-check
// PURE cover math over AABBs (works with THREE.Box3 or plain {min,max} objects
// carrying .x/.y/.z). Furniture at cover height (couch backs, bar counters,
// crates, cars) shields whoever crouches close behind it.
//
// Cover only counts when the defender is CLOSE behind the obstacle (within
// NEAR_M of the intersection) — standing in the open behind a distant couch
// does nothing.

// Cover tuning — live from config/combat.yaml (combat.cover) via cfg(); falls back
// to the baked defaults, so Node unit tests (which never load config) use defaults.
// Read per-call so edits hot-reload like the rest of combat.
import { CONFIG_DEFAULTS } from '../../../data/configDefaults.js';
import { cfg } from '../../core/config.js';
const coverCfg = () => cfg('combat.cover', CONFIG_DEFAULTS.combat.cover);

/** does the 2D segment (x0,z0)→(x1,z1) cross the box's XZ rectangle? slab test */
function segmentHitsBoxXZ(x0, z0, x1, z1, box) {
  const dx = x1 - x0, dz = z1 - z0;
  let tmin = 0, tmax = 1;
  for (const [d, o, lo, hi] of [[dx, x0, box.min.x, box.max.x], [dz, z0, box.min.z, box.max.z]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin; // param of first entry along the segment
}

/**
 * Cover value 0..1 for a defender at `pos` being attacked from `from`.
 * @param {{x:number,z:number}} pos defender
 * @param {{x:number,z:number}} from attacker
 * @param {Array<{min:{x:number,y:number,z:number}, max:{x:number,y:number,z:number}}>} colliders
 */
export function coverBetween(pos, from, colliders) {
  let best = 0;
  const C = coverCfg();
  const segLen = Math.hypot(from.x - pos.x, from.z - pos.z);
  if (segLen < 0.01) return 0;
  for (const box of colliders) {
    const top = box.max.y;
    if (top < C.minTop || top > C.maxTop) continue;
    // segment defender → attacker; entry param measured FROM the defender side
    const t = segmentHitsBoxXZ(pos.x, pos.z, from.x, from.z, box);
    if (t == null) continue;
    const distToObstacle = t * segLen;
    if (distToObstacle > C.nearM) continue;   // obstacle too far ahead to duck behind
    const quality = top >= C.tallAt ? C.qualityTall : C.qualityLow;
    if (quality > best) best = quality;
  }
  return best;
}

/**
 * Pick a spot to take cover in: just behind an obstacle, on the far side from
 * the threat. Returns {x, z, quality} or null.
 * @param {Array<{min:any, max:any}>} colliders
 * @param {{x:number,z:number}} threat  where the danger comes from
 * @param {{x:number,z:number}} near    prefer cover close to this point
 * @param {(x:number, z:number) => boolean} [walkable] optional validity check
 */
export function findCoverSpot(colliders, threat, near, walkable) {
  let best = null, bestScore = -Infinity;
  const C = coverCfg();
  for (const box of colliders) {
    const top = box.max.y;
    if (top < C.minTop || top > C.maxTop) continue;
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const halfX = (box.max.x - box.min.x) / 2, halfZ = (box.max.z - box.min.z) / 2;
    let dx = cx - threat.x, dz = cz - threat.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    // stand just past the box on the away-from-threat side
    const px = cx + dx * (Math.abs(dx) * halfX + Math.abs(dz) * halfX + C.offset);
    const pz = cz + dz * (Math.abs(dz) * halfZ + Math.abs(dx) * halfZ + C.offset);
    if (walkable && !walkable(px, pz)) continue;
    const quality = top >= C.tallAt ? C.qualityTall : C.qualityLow;
    const distNear = Math.hypot(px - near.x, pz - near.z);
    if (distNear > C.maxRange) continue;
    const score = quality * 10 - distNear;
    if (score > bestScore) { bestScore = score; best = { x: px, z: pz, quality }; }
  }
  return best;
}
