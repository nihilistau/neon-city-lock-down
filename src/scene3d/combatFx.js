// @ts-check
// Combat FX — tracers, muzzle flashes, and impact sparks. Pooled short-lived
// meshes added to the scene and faded out. Also backs world.particles(kind,pos)
// (previously undefined). Cosmetic only, so plain Math.random is fine here.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export class CombatFx {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    /** @type {{mesh:THREE.Mesh, life:number, max:number, kind:string, vel?:THREE.Vector3}[]} */
    this.active = [];
    // a unit cylinder along +Y with its base at the origin — scaled to tracer length
    this._tracerGeo = new THREE.CylinderGeometry(0.014, 0.006, 1, 6);
    this._tracerGeo.translate(0, 0.5, 0);
    this._quad = new THREE.PlaneGeometry(1, 1);
    this._baseMat = new THREE.MeshBasicMaterial({
      color: 0xffe08a, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
  }

  _mat(color) { const m = this._baseMat.clone(); if (color != null) m.color.setHex(color); return m; }

  /** A bright streak from → to (a bullet tracer). */
  tracer(from, to, color = 0xffe08a) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = Math.max(0.1, dir.length());
    const m = new THREE.Mesh(this._tracerGeo, this._mat(color));
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    m.scale.set(1, len, 1);
    this.scene.add(m);
    this.active.push({ mesh: m, life: 0.07, max: 0.07, kind: 'tracer' });
  }

  /** A brief flash at a weapon muzzle. */
  muzzleFlash(pos, color = 0xffd060) {
    const m = new THREE.Mesh(this._quad, this._mat(color));
    m.position.copy(pos);
    m.scale.setScalar(0.4);
    this.scene.add(m);
    this.active.push({ mesh: m, life: 0.06, max: 0.06, kind: 'flash' });
  }

  /** A burst of sparks at an impact point. kind: 'spark' | 'blood' | 'debris'. */
  impact(pos, kind = 'spark') {
    const n = kind === 'blood' ? 9 : 6;
    const color = kind === 'blood' ? 0x9a1226 : kind === 'debris' ? 0x9a8a70 : 0xffc070;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this._quad, this._mat(color));
      m.position.copy(pos);
      m.scale.setScalar(0.07);
      const vel = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).multiplyScalar(kind === 'blood' ? 1.8 : 2.6);
      this.scene.add(m);
      this.active.push({ mesh: m, life: 0.3 + Math.random() * 0.2, max: 0.5, kind: 'spark', vel });
    }
  }

  /** @param {number} dt @param {THREE.Camera} [camera] billboards face the camera */
  update(dt, camera) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        /** @type {any} */ (p.mesh.material).dispose?.();
        this.active.splice(i, 1);
        continue;
      }
      const a = Math.max(0, p.life / p.max);
      /** @type {any} */ (p.mesh.material).opacity = a;
      if (p.kind === 'spark') {
        p.mesh.position.addScaledVector(p.vel, dt);
        p.vel.y -= 7 * dt;
        p.mesh.scale.setScalar(0.07 * a + 0.01);
        if (camera) p.mesh.quaternion.copy(camera.quaternion);
      } else if (p.kind === 'flash') {
        p.mesh.scale.setScalar(0.4 * (0.6 + 0.6 * a));
        if (camera) p.mesh.quaternion.copy(camera.quaternion);
      }
    }
  }

  dispose() {
    for (const p of this.active) this.scene.remove(p.mesh);
    this.active.length = 0;
  }
}
