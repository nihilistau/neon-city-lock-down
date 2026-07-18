// @ts-check
// Room-graph navigation across the tower. Same-floor zones connect via optional
// `via` corridors; floors connect through the elevator (a transit hop). All
// returned points are WORLD coordinates (floor offset applied).
import { ZONES, FLOORS } from '../../../data/zones.js';

/** @param {number} x @param {number} z @returns {string|null} zone id containing WORLD point */
export function zoneAt(x, z) {
  for (const zone of Object.values(ZONES)) {
    const o = FLOORS[zone.floor].offsetX;
    const { bounds } = zone;
    if (x >= bounds.x[0] + o && x <= bounds.x[1] + o && z >= bounds.z[0] && z <= bounds.z[1]) return zone.id;
  }
  return null;
}

/** @param {string} zoneId */
export function floorOf(zoneId) { return ZONES[zoneId]?.floor ?? 'penthouse'; }

/**
 * WORLD position of a zone waypoint.
 * @param {string} zoneId @param {string} [waypoint]
 * @returns {[number, number]}
 */
export function waypointPos(zoneId, waypoint) {
  const zone = ZONES[zoneId];
  if (!zone) throw new Error(`unknown zone: ${zoneId}`);
  const o = FLOORS[zone.floor].offsetX;
  const p = (waypoint && zone.waypoints[waypoint]) || zone.anchor;
  return [p[0] + o, p[1]];
}

/** WORLD elevator lobby point of a floor. @param {string} floorId @returns {[number,number]} */
export function elevatorPos(floorId) {
  const f = FLOORS[floorId];
  return [f.elevator[0] + f.offsetX + 0.0, f.elevator[1] + 1.2]; // stand just in front of the doors
}

/** game-minutes to ride between two floors */
export function travelMinutes(fromFloor, toFloor) {
  return 1 + Math.abs((FLOORS[fromFloor]?.travel ?? 0) - (FLOORS[toFloor]?.travel ?? 0));
}

/** BFS route across the zone adjacency graph. @returns {string[]|null} zone id path */
function zoneRoute(fromId, toId) {
  if (fromId === toId) return [fromId];
  const queue = [[fromId]];
  const seen = new Set([fromId]);
  while (queue.length) {
    const path = queue.shift();
    const last = path[path.length - 1];
    for (const next of Object.keys(ZONES[last].adjacent)) {
      if (seen.has(next)) continue;
      const newPath = [...path, next];
      if (next === toId) return newPath;
      seen.add(next);
      queue.push(newPath);
    }
  }
  return null;
}

/**
 * Build a walkable path from a WORLD position to a zone waypoint. Same-floor
 * legs are point lists; a cross-floor journey returns segments split by a
 * transit marker the ActorQueue turns into an elevator ride.
 * @param {{x:number, z:number}} from current position
 * @param {string} toZone @param {string} [toWaypoint]
 * @returns {Array<[number,number] | {transit: {fromFloor:string, toFloor:string}}>}
 */
export function findPath(from, toZone, toWaypoint) {
  const startZone = zoneAt(from.x, from.z);
  const startFloor = startZone ? ZONES[startZone].floor : nearestFloor(from.x);
  const destFloor = ZONES[toZone].floor;
  const target = waypointPos(toZone, toWaypoint);

  if (startFloor === destFloor) {
    const route = startZone ? zoneRoute(startZone, toZone) : null;
    /** @type {any[]} */
    const pts = [];
    const o = FLOORS[destFloor].offsetX;
    if (route) {
      for (let i = 0; i < route.length - 1; i++) {
        const edge = ZONES[route[i]].adjacent[route[i + 1]];
        if (edge?.via) for (const v of edge.via) pts.push([v[0] + o, v[1]]);
      }
    }
    pts.push(target);
    return pts;
  }

  // cross-floor: walk to this floor's elevator, transit, walk from dest elevator
  /** @type {any[]} */
  const pts = [];
  const lobbyA = elevatorPos(startFloor);
  // route to the elevator through the zone graph if we know our zone
  if (startZone) {
    const elevZone = zoneAt(lobbyA[0], lobbyA[1]);
    if (elevZone && elevZone !== startZone) {
      const route = zoneRoute(startZone, elevZone);
      const o = FLOORS[startFloor].offsetX;
      if (route) for (let i = 0; i < route.length - 1; i++) {
        const edge = ZONES[route[i]].adjacent[route[i + 1]];
        if (edge?.via) for (const v of edge.via) pts.push([v[0] + o, v[1]]);
      }
    }
  }
  pts.push(lobbyA);
  pts.push({ transit: { fromFloor: startFloor, toFloor: destFloor } });
  pts.push(elevatorPos(destFloor));
  pts.push(target);
  return pts;
}

/** best-effort floor from a world X (floors are 200 apart) */
function nearestFloor(x) {
  let best = 'penthouse', bestD = Infinity;
  for (const f of Object.values(FLOORS)) {
    const d = Math.abs(x - f.offsetX);
    if (d < bestD) { bestD = d; best = f.id; }
  }
  return best;
}
