// @ts-check
// Situational camera director. When the rig is in 'auto' mode this owns the
// camera and frames whatever matters right now — a firefight, whoever's
// speaking, a fresh event — cutting between shots by priority and easing within
// a shot. It mirrors how the audio conductor reacts to the same bus topics.
// Manual control always wins: the rig only calls tick() in 'auto' mode, and any
// C-toggle / orbit / first-person drops out of it.
import * as THREE from 'three';
import { on } from '../core/bus.js';
import { cfg } from '../core/config.js';

const HEAD = new THREE.Vector3();
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
// The composers return { eye, look }; tick() consumes both immediately (one
// lerp each) and never retains them, so two dedicated scratch vectors replace
// the ~5 clone()/new Vector3() the composers used to allocate every tick.
// They are kept separate from A/B/C/HEAD so a composer can use those as
// intermediates without stomping the frame it is building.
const EYE = new THREE.Vector3();
const LOOK = new THREE.Vector3();
const FRAME = { eye: EYE, look: LOOK };

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
    const sp = (t) => cfg(`camera.director.shots.${t}.priority`, { dialogue: 3, action: 6, event: 4 }[t]);
    const st = (t) => cfg(`camera.director.shots.${t}.ttl`, { dialogue: 4.5, action: 1e9, event: 4 }[t]);
    on('chat.reply', ({ speaker }) => this._push('dialogue', sp('dialogue'), st('dialogue'), { speaker }));
    on('combat.started', () => this._push('action', sp('action'), st('action'), {}));
    on('combat.resolved', () => { this._pop('action'); this._shake = 0; });
    on('player.health', () => { if (this._top()?.type === 'action') this._shake = cfg('camera.director.shakeOnHit', 0.5); });
    on('event.fired', () => this._push('event', sp('event'), st('event'), {}));
    on('bedgame.started', () => { this._suspended = true; });
    on('bedgame.ended', () => { this._suspended = false; });
  }

  /** Shot types with a `_compose_<type>` implementation — the valid `[[cam:x]]` set. */
  static SHOT_TYPES = ['dialogue', 'action', 'event', 'establishing'];

  /**
   * Request a shot from a dialogue stage-direction (`[[cam:establishing]]`).
   * Ignores unknown types rather than composing a missing frame.
   * @param {string} type
   * @param {Object} [data]
   */
  requestShot(type, data = {}) {
    if (!CameraDirector.SHOT_TYPES.includes(type)) return;
    const priority = cfg(`camera.director.shots.${type}.priority`, 5);
    const ttl = cfg(`camera.director.shots.${type}.ttl`, 4.5);
    this._push(type, priority, ttl, data);
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
    const k = cut ? 1 : 1 - Math.pow(cfg('camera.director.easeBase', 0.0008), dt);
    this._pos.lerp(frame.eye, k);
    this._look.lerp(frame.look, k);

    // handheld shake during action, decaying
    let px = 0, py = 0;
    if (this._shake > 0.001) {
      const s = this._shake * cfg('camera.director.shakeAmp', 0.06);
      px = Math.sin(this._t * 47) * s; py = Math.cos(this._t * 41) * s;
      this._shake *= Math.pow(cfg('camera.director.shakeDecay', 0.06), dt);
    }
    this.camera.position.set(this._pos.x + px, this._pos.y + py, this._pos.z);
    this.camera.lookAt(this._look);
  }

  // ── shot composers → { eye, look } ──

  /** @param {any} char @param {THREE.Vector3} [out] written in place, not allocated */
  _headOf(char, out = HEAD) {
    const h = char.actor?.rig?.byName?.head;
    if (h) return h.getWorldPosition(out);
    return out.copy(char.actor.root.position).setY(1.5);
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
    const radius = cfg('camera.director.establishing.radius', 4.2);
    const a = this._t * cfg('camera.director.establishing.speed', 0.12);
    EYE.set(c.x + Math.cos(a) * radius, cfg('camera.director.establishing.height', 2.6), c.z + Math.sin(a) * radius);
    LOOK.copy(c);
    return FRAME;
  }

  /** over-the-shoulder 2-shot of the speaker + the guest */
  _compose_dialogue(shot) {
    const char = this.d.cast()[shot.data.speaker];
    if (!char) return this._compose_establishing();
    const head = this._headOf(char, HEAD);
    const player = this.d.playerMarker.position;
    // dir from guest → speaker on the floor plane
    const dir = A.subVectors(head, player); dir.y = 0;
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    dir.normalize();
    // eye: behind & above the guest, offset to one side for a 3/4 framing
    const side = B.set(-dir.z, 0, dir.x).multiplyScalar(0.7);
    EYE.copy(player).addScaledVector(dir, -1.1).add(side); EYE.y = 1.72;
    LOOK.copy(head).addScaledVector(dir, 0.1); LOOK.y = head.y - 0.06;
    return FRAME;
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
    const perp = C.set(-axis.z, 0, axis.x)
      .multiplyScalar(span * cfg('camera.director.action.spanFactor', 0.9) + cfg('camera.director.action.spanPad', 1.5));
    EYE.copy(mid).add(perp); EYE.y = cfg('camera.director.action.eyeY', 2.2);
    LOOK.copy(mid);
    return FRAME;
  }

  /** brief wide of the room when an event fires, then it expires back to normal */
  _compose_event() {
    const est = this._compose_establishing();
    est.eye.y = cfg('camera.director.event.eyeY', 3.1);
    return est;
  }
}
