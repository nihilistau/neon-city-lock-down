// @ts-check
// Combat FX — tracers, muzzle flashes, and impact sparks. Pooled short-lived
// meshes added to the scene and faded out. Also backs world.particles(kind,pos)
// (previously undefined). Cosmetic only, so plain Math.random is fine here.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
/** scratch for tracer direction — consumed within tracer(), never retained */
const _v = new THREE.Vector3();

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
    // Pools. Each particle needs its OWN material (opacity is animated per
    // particle), but it does not need a NEW one: impact() was cloning 6-9
    // materials per hit and disposing every one of them 0.3s later, so a
    // firefight churned hundreds of materials — and every clone is a fresh
    // uniform set the renderer has to track. Recycling instead keeps the count
    // at the high-water mark of simultaneously-live particles.
    /** @type {THREE.MeshBasicMaterial[]} */
    this._matPool = [];
    /** @type {Map<THREE.BufferGeometry, THREE.Mesh[]>} */
    this._meshPool = new Map();
  }

  /** @param {number} [color] */
  _mat(color) {
    const m = this._matPool.pop() || /** @type {THREE.MeshBasicMaterial} */ (this._baseMat.clone());
    if (color != null) m.color.setHex(color);
    m.opacity = 1;
    return m;
  }

  /** @param {THREE.BufferGeometry} geo @param {number} [color] */
  _mesh(geo, color) {
    const free = this._meshPool.get(geo);
    const m = (free && free.pop()) || new THREE.Mesh(geo, this._baseMat);
    m.material = this._mat(color);
    m.scale.set(1, 1, 1);
    m.quaternion.identity();
    this.scene.add(m);
    return m;
  }

  /** Return a spent particle's mesh + material to their pools. @param {THREE.Mesh} m */
  _recycle(m) {
    this.scene.remove(m);
    const mat = /** @type {THREE.MeshBasicMaterial} */ (m.material);
    // bounded so a pathological fight can't grow the pools without limit
    if (this._matPool.length < 128) this._matPool.push(mat); else mat.dispose();
    let free = this._meshPool.get(m.geometry);
    if (!free) this._meshPool.set(m.geometry, (free = []));
    if (free.length < 128) free.push(m);
  }

  /** A bright streak from → to (a bullet tracer). */
  tracer(from, to, color = 0xffe08a) {
    const dir = _v.subVectors(to, from);
    const len = Math.max(0.1, dir.length());
    const m = this._mesh(this._tracerGeo, color);
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    m.scale.set(1, len, 1);
    this.active.push({ mesh: m, life: 0.07, max: 0.07, kind: 'tracer' });
  }

  /** A brief flash at a weapon muzzle. */
  muzzleFlash(pos, color = 0xffd060) {
    const m = this._mesh(this._quad, color);
    m.position.copy(pos);
    m.scale.setScalar(0.4);
    this.active.push({ mesh: m, life: 0.06, max: 0.06, kind: 'flash' });
  }

  /** A burst of sparks at an impact point. kind: 'spark' | 'blood' | 'debris'. */
  impact(pos, kind = 'spark') {
    const n = kind === 'blood' ? 9 : 6;
    const color = kind === 'blood' ? 0x9a1226 : kind === 'debris' ? 0x9a8a70 : 0xffc070;
    for (let i = 0; i < n; i++) {
      const m = this._mesh(this._quad, color);
      m.position.copy(pos);
      m.scale.setScalar(0.07);
      // `vel` is retained for the particle's lifetime, so it genuinely needs
      // its own vector — unlike the throwaway temporaries above.
      const vel = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).multiplyScalar(kind === 'blood' ? 1.8 : 2.6);
      this.active.push({ mesh: m, life: 0.3 + Math.random() * 0.2, max: 0.5, kind: 'spark', vel });
    }
  }

  /** @param {number} dt @param {THREE.Camera} [camera] billboards face the camera */
  update(dt, camera) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        this._recycle(p.mesh);
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
    for (const p of this.active) {
      this.scene.remove(p.mesh);
      /** @type {any} */ (p.mesh.material).dispose?.();   // in-flight, never reached the pool
    }
    this.active.length = 0;
    for (const m of this._matPool) m.dispose();
    this._matPool.length = 0;
    this._meshPool.clear();
    this._baseMat.dispose();
    this._tracerGeo.dispose();
    this._quad.dispose();
  }
}
