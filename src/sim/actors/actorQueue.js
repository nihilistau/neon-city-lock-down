// @ts-check
// THE command spine. Every character movement/pose/expression — from AI,
// dialogue stage directions, events, cutscenes, or Director tools — goes
// through here. Single writer to the Actor3D. Gate-tier-tagged commands are
// checked before acceptance (wired to gates.js in P1.3+).
import * as THREE from 'three';
import { emit } from '../../core/bus.js';
import { findPath, zoneAt, travelMinutes, elevatorPos } from './nav.js';
import { feed } from '../../core/log.js';

const WALK_SPEED = 1.22;      // m/s
const ARRIVE_DIST = 0.14;

/**
 * @typedef {Object} Command
 * @property {string} type  goto|sit|stand|playClip|face|look|turn|wait|call
 * @property {any[]} [args]
 * @property {string} [gateTier]
 */

export class ActorQueue {
  /**
   * @param {import('../../humanoid/actor3d.js').Actor3D} actor
   * @param {import('../../scene3d/tower/zoneBuilder.js').World3D} world
   * @param {{ gateCheck?: (tier:string) => {allowed:boolean, reason?:string} }} [hooks]
   */
  constructor(actor, world, hooks = {}) {
    this.actor = actor;
    this.world = world;
    this.hooks = hooks;
    /** @type {Command[]} */
    this.queue = [];
    /** @type {Command|null} */
    this.current = null;
    this._path = null;      // active goto path
    this._waitT = 0;
    this.seatedAt = null;   // socket ref while sitting
    this.zone = zoneAt(actor.root.position.x, actor.root.position.z) ?? 'lounge';
  }

  get busy() { return !!this.current || this.queue.length > 0; }

  /** @param {Command} cmd */
  push(cmd) {
    if (cmd.gateTier && this.hooks.gateCheck) {
      const res = this.hooks.gateCheck(cmd.gateTier);
      if (!res.allowed) {
        emit('actor.refused', { id: this.actor.id, cmd, reason: res.reason });
        return false;
      }
    }
    this.queue.push(cmd);
    return true;
  }

  /** Flush everything and run this next (events, combat, director override). */
  pushPriority(cmd) {
    this.queue.length = 0;
    this._finishCurrent();
    return this.push(cmd);
  }

  clear() {
    this.queue.length = 0;
    this._finishCurrent();
  }

  _finishCurrent() {
    this.current = null;
    this._path = null;
    this._waitT = 0;
  }

  /** convenience builders */
  goto(zone, waypoint) { return this.push({ type: 'goto', args: [zone, waypoint] }); }
  gotoSocket(socketRef) { return this.push({ type: 'gotoSocket', args: [socketRef] }); }
  sit(socketRef) { this.gotoSocket(socketRef); return this.push({ type: 'sit', args: [socketRef] }); }
  stand() { return this.push({ type: 'stand', args: [] }); }
  playClip(id, fade, holdSec) { return this.push({ type: 'playClip', args: [id, fade, holdSec] }); }
  face(expr) { return this.push({ type: 'face', args: [expr] }); }
  look(target) { return this.push({ type: 'look', args: [target] }); }
  wait(sec) { return this.push({ type: 'wait', args: [sec] }); }
  /** call an arbitrary function when reached in queue order */
  call(fn) { return this.push({ type: 'call', args: [fn] }); }

  /** @param {number} dt seconds */
  update(dt) {
    if (!this.current) {
      this.current = this.queue.shift() ?? null;
      if (!this.current) return;
      this._start(this.current);
    }
    const done = this._step(this.current, dt);
    if (done) this._finishCurrent();

    // track zone presence
    const z = zoneAt(this.actor.root.position.x, this.actor.root.position.z);
    if (z && z !== this.zone) {
      const from = this.zone;
      this.zone = z;
      emit('zone.entered', { id: this.actor.id, zone: z, from });
    }
  }

  /** @param {Command} cmd */
  _start(cmd) {
    const a = this.actor;
    switch (cmd.type) {
      case 'goto': {
        if (this.seatedAt) this._standUp();
        const [zone, waypoint] = cmd.args;
        const p = a.root.position;
        this._path = findPath({ x: p.x, z: p.z }, zone, waypoint).map((pt) =>
          Array.isArray(pt) ? new THREE.Vector3(pt[0], 0, pt[1]) : pt);
        a.playClip('walk', 0.25);
        break;
      }
      case 'gotoSocket': {
        if (this.seatedAt) this._standUp();
        const socket = this.world.getSocket(cmd.args[0]);
        if (!socket) { this._path = []; break; }
        const world = socket.getWorldPosition(new THREE.Vector3());
        // approach point: 0.45m in front of the socket's facing
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(
          socket.getWorldQuaternion(new THREE.Quaternion()));
        const approach = world.clone().addScaledVector(fwd, 0.45);
        approach.y = 0;
        this._path = [approach];
        a.playClip('walk', 0.25);
        break;
      }
      case 'sit': {
        const socket = this.world.getSocket(cmd.args[0]);
        if (!socket) break;
        const world = socket.getWorldPosition(new THREE.Vector3());
        const yaw = new THREE.Euler().setFromQuaternion(
          socket.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
        a.root.position.set(world.x, 0, world.z);
        a.faceYaw(yaw + Math.PI); // sit sockets face outward; body faces the same way
        a.playClip('sit_relaxed', 0.45);
        this.seatedAt = cmd.args[0];
        this._waitT = 0.5; // settle time
        break;
      }
      case 'stand':
        if (this.seatedAt) this._standUp();
        this._waitT = 0.3;
        break;
      case 'playClip':
        a.playClip(cmd.args[0], cmd.args[1] ?? 0.3);
        this._waitT = cmd.args[2] ?? 0;
        break;
      case 'face':
        a.face.setExpression(cmd.args[0]);
        break;
      case 'look':
        a.lookAt(cmd.args[0]);
        break;
      case 'turn':
        a.faceYaw(cmd.args[0]);
        this._waitT = 0.3;
        break;
      case 'wait':
        this._waitT = cmd.args[0];
        break;
      case 'call':
        try { cmd.args[0](); } catch (err) { console.error('[actorQueue] call failed', err); }
        break;
    }
  }

  _standUp() {
    const a = this.actor;
    this.seatedAt = null;
    a.playClip(a.persona.personality.idleClip || 'idle_stand', 0.4);
    // step forward off the seat
    const fwd = new THREE.Vector3(0, 0, 0.45).applyEuler(a.root.rotation);
    a.root.position.add(fwd);
  }

  /**
   * @param {Command} cmd @param {number} dt
   * @returns {boolean} finished
   */
  _step(cmd, dt) {
    const a = this.actor;
    switch (cmd.type) {
      case 'goto':
      case 'gotoSocket': {
        if (!this._path || this._path.length === 0) {
          if (cmd.type === 'goto') a.playClip(a.persona.personality.idleClip || 'idle_stand', 0.35);
          return true;
        }
        const target = this._path[0];
        // transit marker: ride the elevator (off-screen wait, then teleport)
        if (target.transit) {
          if (this._transitT == null) {
            const mins = travelMinutes(target.transit.fromFloor, target.transit.toFloor);
            this._transitT = Math.max(2.5, mins * 1.0); // real seconds ≈ game minutes at 1×
            a.playClip('idle_stand', 0.3);
            a.root.visible = false;                     // inside the car
            feed(`${a.persona.name} takes the elevator.`, 'info');
          }
          this._transitT -= dt;
          if (this._transitT <= 0) {
            this._transitT = null;
            const dest = elevatorPos(target.transit.toFloor);
            a.snapTo(dest[0], dest[1]);
            a.root.visible = true;
            this._lastTransitFloor = target.transit.toFloor;
            this._path.shift();
            a.playClip('walk', 0.25);
          }
          return false;
        }
        const p = a.root.position;
        const dx = target.x - p.x, dz = target.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist < ARRIVE_DIST) {
          this._path.shift();
          return false;
        }
        const step = Math.min(dist, WALK_SPEED * dt);
        p.x += (dx / dist) * step;
        p.z += (dz / dist) * step;
        a.faceYaw(Math.atan2(dx, dz));
        return false;
      }
      default:
        if (this._waitT > 0) { this._waitT -= dt; return this._waitT <= 0; }
        return true;
    }
  }
}
