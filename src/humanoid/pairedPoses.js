// @ts-check
// Paired poses: two characters anchored to furniture sockets with role clips
// sharing a phase clock. Contact is baked FK-style into the role clips; runtime
// IK refinement is a Phase 4 deepening. Gate tiers are enforced by the queue.
import { emit } from '../core/bus.js';

/**
 * @typedef {Object} PairedPoseDef
 * @property {string} id
 * @property {string} furnitureId  world furniture that carries the role sockets
 * @property {{socket:string, clip:string}[]} roles [roleA, roleB]
 * @property {import('../core/types.js').GateTier} [gateTier] required intimacy gate
 * @property {boolean} [faceEachOther]
 */

/** @type {Record<string, PairedPoseDef>} */
export const PAIRED_POSES = {
  couch_together: {
    id: 'couch_together',
    furnitureId: 'couch',
    roles: [
      { socket: 'seat0', clip: 'sit_relaxed' },
      { socket: 'seat1', clip: 'sit_lean_partner' },
    ],
    faceEachOther: true,
  },
  couch_close: {
    id: 'couch_close',
    furnitureId: 'couch',
    gateTier: 'light_touch',
    roles: [
      { socket: 'seat0', clip: 'sit_relaxed' },
      { socket: 'seat1', clip: 'sit_lean_partner' },
    ],
    faceEachOther: true,
  },
};

/**
 * Start a paired pose between two characters. Each character walks to their
 * socket via their own queue; the pair command is gate-checked on the initiator.
 * @param {string} poseId
 * @param {import('../chars/character.js').Character} a role 0
 * @param {import('../chars/character.js').Character} b role 1
 * @returns {boolean} accepted
 */
export function startPairedPose(poseId, a, b) {
  const def = PAIRED_POSES[poseId];
  if (!def) return false;

  // gate check on both participants for tiered poses
  if (def.gateTier) {
    if (!a.gateCheck(def.gateTier).allowed) return false;
    if (!b.gateCheck(def.gateTier).allowed) return false;
  }

  // hold both brains FIRST (the engage handler may clear queues), then stage
  emit('pose.paired', { pose: poseId, a: a.id, b: b.id, holdMinutes: 45 });

  const [ra, rb] = def.roles;
  a.queue.clear(); b.queue.clear();
  a.queue.sit(`${def.furnitureId}.${ra.socket}`);
  a.queue.playClip(ra.clip, 0.5);
  b.queue.sit(`${def.furnitureId}.${rb.socket}`);
  b.queue.playClip(rb.clip, 0.5);
  if (def.faceEachOther) {
    a.queue.look(b.actor.root);
    b.queue.look(a.actor.root);
  }
  // share a phase clock so pingpong sways stay synchronized
  const t0 = 0.0;
  a.queue.call(() => { a.actor.animator.clipTime = t0; });
  b.queue.call(() => { b.actor.animator.clipTime = t0; });
  // tail-wait keeps the queues visibly busy as a second line of defence
  a.queue.wait(60);
  b.queue.wait(60);
  return true;
}

/** Release a paired pose: clears both queues back to autonomy. */
export function endPairedPose(a, b) {
  a.queue.clear(); b.queue.clear();
  a.queue.stand(); b.queue.stand();
  a.queue.look(null); b.queue.look(null);
  emit('pose.unpaired', { a: a.id, b: b.id });
}
