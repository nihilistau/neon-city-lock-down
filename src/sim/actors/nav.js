// @ts-check
// Room-graph navigation. Zones on one floor connect via optional `via` corridors
// (e.g. the balcony door). Paths are polylines of world points.
import { ZONES } from '../../../data/zones.js';

/** @param {number} x @param {number} z @returns {string|null} zone id containing point */
export function zoneAt(x, z) {
  for (const zone of Object.values(ZONES)) {
    const { bounds } = zone;
    if (x >= bounds.x[0] && x <= bounds.x[1] && z >= bounds.z[0] && z <= bounds.z[1]) return zone.id;
  }
  return null;
}

/**
 * World position of a zone waypoint.
 * @param {string} zoneId @param {string} [waypoint]
 * @returns {[number, number]}
 */
export function waypointPos(zoneId, waypoint) {
  const zone = ZONES[zoneId];
  if (!zone) throw new Error(`unknown zone: ${zoneId}`);
  if (waypoint && zone.waypoints[waypoint]) return zone.waypoints[waypoint];
  return zone.anchor;
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
 * Build a walkable polyline from a world position to a zone waypoint.
 * @param {{x:number, z:number}} from current position
 * @param {string} toZone @param {string} [toWaypoint]
 * @returns {[number, number][]} points (excluding start)
 */
export function findPath(from, toZone, toWaypoint) {
  const startZone = zoneAt(from.x, from.z) ?? 'lounge';
  const route = zoneRoute(startZone, toZone);
  const target = waypointPos(toZone, toWaypoint);
  if (!route) return [target];

  /** @type {[number, number][]} */
  const pts = [];
  for (let i = 0; i < route.length - 1; i++) {
    const edge = ZONES[route[i]].adjacent[route[i + 1]];
    if (edge?.via) for (const v of edge.via) pts.push(v);
  }
  pts.push(target);
  // drop leading points that are behind us (already passed)
  return pts;
}
