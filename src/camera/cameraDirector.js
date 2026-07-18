// @ts-check
// Situational camera director. When the rig is in 'auto' mode this owns the
// camera and frames whatever matters right now — a firefight, whoever's
// speaking, a fresh event — cutting between shots by priority and easing within
// a shot. It mirrors how the audio conductor reacts to the same bus topics.
// Manual control always wins: the rig only calls tick() in 'auto' mode, and any
// C-toggle / orbit / first-person drops out of it.
import * as THREE from 'three';
import { on } from '../core/bus.js';

const HEAD = new THREE.Vector3();
const A = new THREE.Vector3();
const B = new THREE.Vector3();

export class CameraDirector {
  /**
   * @param {Object} deps
   * @param {import('../scene3d/stage.js').Stage} deps.stage
   * @param {() => Record<string, import('../chars/character.js').Character>} deps.cast
   * @param {() => any} deps.combat
   * @param {THREE.Object3D} deps.playerMarker
   */
  constructor(deps) {
    this.d = deps;
    this.camera = deps.stage.camera;
    /** @type {{type:string, priority:number, expiry:number, data:any}[]} */
    this.shots = [];
    this._t = 0;
    this._pos = this.camera.position.clone();
    this._look = new THREE.Vector3(-3.5, 1.1, 0);
    this._activeType = null;
    this._shake = 0;
    this._suspended = false;   // bed game is first-person; stand down
    this._subscribe();
  }

  _subscribe() {
    on('chat.reply', ({ speaker }) => this._push('dialogue', 3, 4.5, { speaker }));
    on('combat.started', () => this._push('action', 6, 1e9, {}));
    on('combat.resolved', () => { this._pop('action'); this._shake = 0; });
    on('player.health', () => { if (this._top()?.type === 'action') this._shake = 0.5; });
    on('event.fired', () => this._push('event', 4, 4, {}));
    on('bedgame.started', () => { this._suspended = true; });
    on('bedgame.ended', () => { this._suspended = false; });
  }

  /** Push (or refresh) a shot with a time-to-live in seconds. */
  _push(type, priority, ttl, data) {
    const existing = this.shots.find((s) => s.type === type);
    if (existing) { existing.expiry = this._t + ttl; existing.data = data; existing.priority = priority; }
    else this.shots.push({ type, priority, expiry: this._t + ttl, data });
  }
  _pop(type) { this.shots = this.shots.filter((s) => s.type !== type); }
  _top() {
    const live = this.shots.filter((s) => s.expiry > this._t);
    this.shots = live;
    if (!live.length) return null;
    return live.reduce((a, b) => (b.priority > a.priority ? b : a));
  }

  _present() {
    return Object.values(this.d.cast()).filter((c) => c.alive && c.present !== false && c.id !== 'vox');
  }

  /** @param {number} dt seconds */
  tick(dt) {
    this._t += dt;
    if (this._suspended) return;   // first-person bed scene owns the camera
    const shot = this._top();
    const type = shot?.type || 'establishing';
    const frame = this[`_compose_${type}`] ? this[`_compose_${type}`](shot, dt) : this._compose_establishing();
    if (!frame) return;

    // hard cut when the subject changes; smooth ease within a shot
    const cut = type !== this._activeType;
    this._activeType = type;
    const k = cut ? 1 : 1 - Math.pow(0.0008, dt);
    this._pos.lerp(frame.eye, k);
    this._look.lerp(frame.look, k);

    // handheld shake during action, decaying
    let px = 0, py = 0;
    if (this._shake > 0.001) {
      const s = this._shake * 0.06;
      px = Math.sin(this._t * 47) * s; py = Math.cos(this._t * 41) * s;
      this._shake *= Math.pow(0.06, dt);
    }
    this.camera.position.set(this._pos.x + px, this._pos.y + py, this._pos.z);
    this.camera.lookAt(this._look);
  }

  // ── shot composers → { eye, look } ──

  _headOf(char) {
    const h = char.actor?.rig?.byName?.head;
    if (h) return h.getWorldPosition(HEAD).clone();
    return char.actor.root.position.clone().setY(1.5);
  }

  /** slow orbit around the present cast's centroid (or the lounge) */
  _compose_establishing() {
    const cast = this._present();
    const c = A.set(0, 1.1, 0);
    if (cast.length) {
      c.set(0, 0, 0);
      for (const ch of cast) c.add(ch.actor.root.position);
      c.multiplyScalar(1 / cast.length); c.y = 1.15;
    } else { c.set(-3.5, 1.15, 0); }
    const a = this._t * 0.12;
    return {
      eye: B.set(c.x + Math.cos(a) * 4.2, 2.6, c.z + Math.sin(a) * 4.2).clone(),
      look: c.clone(),
    };
  }

  /** over-the-shoulder 2-shot of the speaker + the guest */
  _compose_dialogue(shot) {
    const char = this.d.cast()[shot.data.speaker];
    if (!char) return this._compose_establishing();
    const head = this._headOf(char);
    const player = this.d.playerMarker.position;
    // dir from guest → speaker on the floor plane
    const dir = A.subVectors(head, player); dir.y = 0;
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    dir.normalize();
    // eye: behind & above the guest, offset to one side for a 3/4 framing
    const side = B.set(-dir.z, 0, dir.x).multiplyScalar(0.7);
    const eye = player.clone().addScaledVector(dir, -1.1).add(side); eye.y = 1.72;
    const look = head.clone().addScaledVector(dir, 0.1); look.y = head.y - 0.06;
    return { eye, look };
  }

  /** track the player ↔ nearest living hostile */
  _compose_action(shot) {
    const combat = this.d.combat?.();
    const player = this.d.playerMarker.position;
    let target = player, minD = Infinity;
    const hostiles = combat?.hostiles?.filter((h) => h.hp > 0) || [];
    for (const h of hostiles) {
      const dd = h.actor.root.position.distanceToSquared(player);
      if (dd < minD) { minD = dd; target = h.actor.root.position; }
    }
    const mid = A.addVectors(player, target).multiplyScalar(0.5); mid.y = 1.2;
    const span = Math.max(3, player.distanceTo(target));
    // side-on tracking, pulled back to frame both
    const axis = B.subVectors(target, player); axis.y = 0;
    if (axis.lengthSq() < 0.01) axis.set(1, 0, 0);
    axis.normalize();
    const perp = new THREE.Vector3(-axis.z, 0, axis.x).multiplyScalar(span * 0.9 + 1.5);
    const eye = mid.clone().add(perp); eye.y = 2.2;
    return { eye, look: mid.clone() };
  }

  /** brief wide of the room when an event fires, then it expires back to normal */
  _compose_event() {
    const est = this._compose_establishing();
    est.eye.y = 3.1;
    return est;
  }
}
