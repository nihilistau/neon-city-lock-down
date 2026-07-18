// @ts-check
// VOX has no body — the tower IS its body. These stubs duck-type the Actor3D and
// ActorQueue surfaces that Character and the dialogue engine touch, so VOX can
// be a full cast member (stats, gates stay locked, memory, chat) without a puppet.
import * as THREE from 'three';

export class VoxActorStub {
  /** @param {any} persona */
  constructor(persona) {
    this.persona = persona;
    this.id = persona.id;
    this.root = new THREE.Object3D();          // "position" = wherever the player is
    this.root.name = 'vox_presence';
    this.face = {
      state: {}, _talkAmp: 0,
      setExpression() { }, setTalk(amp) { this._talkAmp = amp; },
      update() { },
    };
    this.animator = { current: { id: 'omnipresent' }, tempo: 1, speed: 0 };
    this.rig = { byName: {} };
  }
  faceYaw() { }
  snapTo() { }
  lookAt() { }
  playClip() { }
  setTempo() { }
  setRim() { }
  update() { }
  dispose() { }
}

export class VoxQueueStub {
  constructor() {
    this.queue = [];
    this.current = null;
    this.seatedAt = null;
    this.zone = 'everywhere';
    this.hooks = {};
  }
  get busy() { return false; }
  push() { return true; }
  pushPriority() { return true; }
  clear() { }
  goto() { } gotoSocket() { } sit() { } stand() { } playClip() { }
  face() { } look() { } wait() { } call(fn) { try { fn?.(); } catch { } }
  update() { }
}
