// @ts-check
// Procedural face: a curved decal patch over the skull carrying a 256² canvas
// (skin, brows, lids, mouth, blush) with alpha-cut eye holes, plus 3D eyeballs
// parented to the eye bones. Redraws are dirty-flagged and capped at ~15Hz.
import * as THREE from 'three';

// canvas-space layout (fractions of the 256² face patch)
const LAYOUT = {
  eyeL: { x: 0.34, y: 0.48 },    // canvas-left = character's right; symmetric anyway
  eyeR: { x: 0.66, y: 0.48 },
  eyeRx: 0.072, eyeRy: 0.05,     // hole radii
  browY: 0.385,
  mouth: { x: 0.5, y: 0.725 },
  noseY: 0.615,
};

const MOUTHS = {
  neutral: { w: 0.085, curve: 0.06, open: 0, pout: 0 },
  smile: { w: 0.105, curve: 0.55, open: 0.05, pout: 0 },
  grin: { w: 0.115, curve: 0.65, open: 0.35, pout: 0 },
  smirk: { w: 0.095, curve: 0.35, open: 0, pout: 0, skew: 0.5 },
  frown: { w: 0.09, curve: -0.4, open: 0, pout: 0.2 },
  pout: { w: 0.075, curve: -0.1, open: 0.08, pout: 1 },
  open: { w: 0.09, curve: 0.1, open: 0.8, pout: 0 },
  grit: { w: 0.11, curve: -0.15, open: 0.25, pout: 0, teeth: 1 },
};

export class FaceRig {
  /**
   * @param {{ colors: {skin:string, hair:string, eyes:string, lips:string, brows?:string},
   *           body: {height:number}, face?: {browWeight?:number, lashes?:number} }} persona
   * @param {{ byName: Record<string, THREE.Bone>, joints: Record<string, THREE.Vector3> }} rig
   */
  constructor(persona, rig) {
    this.persona = persona;
    const h = persona.body.height;

    // expression state (written by animator/dialogue, read by draw)
    this.state = {
      browAngle: 0,   // -1 angry .. +1 sad-tilt
      browRaise: 0,   // -1 lowered .. +1 raised
      lids: 0,        // 0 open .. 1 closed
      mouth: 'neutral',
      mouthOpen: 0,   // extra openness (talking)
      blush: 0,
      pupil: 0.35,    // dilation 0..1
      gaze: { x: 0, y: 0 },
    };
    this._mouthCur = { ...MOUTHS.neutral, skew: 0, teeth: 0 };
    this._talkAmp = 0;
    this._blinkT = 0;
    this._nextBlink = 2 + Math.random() * 3;
    this._blinkPhase = -1; // <0 idle, 0..1 during blink
    this._dirty = true;
    this._sinceDraw = 0;

    // --- canvas + decal patch. The patch is a partial sphere; a canvas (u,v)
    // maps to a surface point via `surfacePoint()` so the 3D eyeballs can be
    // placed EXACTLY behind their canvas eye-holes (guaranteed alignment).
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 256;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;

    const geom = {
      r: 0.066 * h,
      phiStart: Math.PI / 2 - 1.62 / 2, phiLen: 1.62,
      thetaStart: 0.62, thetaLen: 1.42,
      scale: new THREE.Vector3(0.94, 1.06, 0.98),
    };
    this._geom = geom;
    const headWorld = rig.joints.head;
    // sphere center in head-local space
    this._center = new THREE.Vector3(0, 0.951 * h, 0.010 * h).sub(headWorld);

    const patch = new THREE.SphereGeometry(geom.r, 28, 24,
      geom.phiStart, geom.phiLen, geom.thetaStart, geom.thetaLen);
    const mat = new THREE.MeshStandardMaterial({
      map: this.tex, roughness: 0.55, alphaTest: 0.5,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.decal = new THREE.Mesh(patch, mat);
    this.decal.scale.copy(geom.scale);
    this.decal.position.copy(this._center);
    rig.byName.head.add(this.decal);

    // --- eyeballs, placed at the canvas eye-hole surface points
    this.eyes = {};
    for (const [side, layoutKey] of [['L', 'eyeL'], ['R', 'eyeR']]) {
      const p = this._surfacePoint(LAYOUT[layoutKey].x, LAYOUT[layoutKey].y);
      const group = new THREE.Group();
      group.position.copy(p);
      // sit the eyeball slightly inside the surface so lids overlap its rim
      const inward = p.clone().sub(this._center).normalize();
      group.position.addScaledVector(inward, -0.010 * h);
      this._eyeFwd = inward; // shared forward for both (approx)

      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.0135 * h, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0xf6f4f0, roughness: 0.18 })
      );
      const irisC = document.createElement('canvas');
      irisC.width = irisC.height = 64;
      this._drawIris(irisC, persona.colors.eyes, this.state.pupil);
      const irisTex = new THREE.CanvasTexture(irisC);
      irisTex.colorSpace = THREE.SRGBColorSpace;
      const iris = new THREE.Mesh(
        new THREE.CircleGeometry(0.0088 * h, 20),
        new THREE.MeshBasicMaterial({ map: irisTex, transparent: true })
      );
      iris.position.z = 0.0132 * h;
      group.add(ball, iris);
      // orient group so +Z faces outward along the surface normal
      group.lookAt(group.position.clone().add(inward));
      group.userData.rest = group.rotation.clone();
      group.userData.irisCanvas = irisC;
      group.userData.irisTex = irisTex;
      rig.byName.head.add(group);
      this.eyes[side] = group;
    }
    this.draw();
  }

  /**
   * Map a canvas (u,v) in [0,1] to a point on the decal surface, in head-local space.
   * Mirrors three.js SphereGeometry parameterization.
   * @param {number} u @param {number} v
   */
  _surfacePoint(u, v) {
    const g = this._geom;
    const phi = g.phiStart + u * g.phiLen;
    const theta = g.thetaStart + v * g.thetaLen;
    const p = new THREE.Vector3(
      -g.r * Math.cos(phi) * Math.sin(theta),
      g.r * Math.cos(theta),
      g.r * Math.sin(phi) * Math.sin(theta)
    );
    p.multiply(g.scale).add(this._center);
    return p;
  }

  /** @param {Partial<typeof this.state>} partial */
  setExpression(partial) {
    Object.assign(this.state, partial);
    this._dirty = true;
  }

  /** Voice amplitude 0..1 → mouth motion while speaking. */
  setTalk(amp) {
    if (Math.abs(amp - this._talkAmp) > 0.06) this._dirty = true;
    this._talkAmp = amp;
  }

  /** @param {number} dt seconds */
  update(dt) {
    // blink scheduler
    this._blinkT += dt;
    if (this._blinkPhase < 0 && this._blinkT > this._nextBlink) {
      this._blinkPhase = 0;
    }
    if (this._blinkPhase >= 0) {
      this._blinkPhase += dt / 0.14;
      this._dirty = true;
      if (this._blinkPhase >= 1) {
        this._blinkPhase = -1;
        this._blinkT = 0;
        this._nextBlink = 2 + Math.random() * 4;
      }
    }
    // eye gaze (offset from rest orientation)
    for (const side of ['L', 'R']) {
      const g = this.eyes[side];
      const rest = g.userData.rest;
      const ty = rest.y + this.state.gaze.x * 0.5;
      const tx = rest.x - this.state.gaze.y * 0.32;
      g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, ty, Math.min(1, dt * 14));
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, tx, Math.min(1, dt * 14));
    }
    // mouth shape easing
    const target = MOUTHS[this.state.mouth] || MOUTHS.neutral;
    const cur = this._mouthCur;
    const k = Math.min(1, dt * 10);
    for (const key of ['w', 'curve', 'open', 'pout']) {
      const t = target[key] ?? 0;
      if (Math.abs(cur[key] - t) > 0.003) { cur[key] += (t - cur[key]) * k; this._dirty = true; }
    }
    cur.skew = target.skew ?? 0;
    cur.teeth = target.teeth ?? 0;

    this._sinceDraw += dt;
    if (this._dirty && this._sinceDraw > 1 / 15) this.draw();
  }

  _lidAmount() {
    let lids = this.state.lids;
    if (this._blinkPhase >= 0) {
      const p = this._blinkPhase;
      lids = Math.max(lids, p < 0.5 ? p * 2 : (1 - p) * 2);
    }
    return lids;
  }

  draw() {
    this._dirty = false;
    this._sinceDraw = 0;
    const ctx = this.canvas.getContext('2d');
    const W = 256, s = this.state, colors = this.persona.colors;

    // base skin
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = colors.skin;
    ctx.fillRect(0, 0, W, W);
    // soft cheek/forehead modelling
    const shade = ctx.createRadialGradient(W / 2, W * 0.5, W * 0.2, W / 2, W * 0.55, W * 0.62);
    shade.addColorStop(0, 'rgba(255,255,255,0.05)');
    shade.addColorStop(1, 'rgba(30,10,20,0.10)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, W);

    // blush
    if (s.blush > 0.02) {
      for (const ex of [LAYOUT.eyeL.x, LAYOUT.eyeR.x]) {
        const g = ctx.createRadialGradient(ex * W, 0.56 * W, 2, ex * W, 0.56 * W, 0.09 * W);
        g.addColorStop(0, `rgba(235,90,110,${0.38 * s.blush})`);
        g.addColorStop(1, 'rgba(235,90,110,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, W);
      }
    }

    // nose hint
    ctx.strokeStyle = 'rgba(60,30,35,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 3, LAYOUT.noseY * W - 14);
    ctx.quadraticCurveTo(W / 2 - 5, LAYOUT.noseY * W, W / 2 - 1, LAYOUT.noseY * W + 2);
    ctx.stroke();
    for (const dx of [-5, 5]) {
      ctx.beginPath();
      ctx.ellipse(W / 2 + dx, LAYOUT.noseY * W + 4, 2.2, 1.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(60,30,35,0.28)';
      ctx.fill();
    }

    // eye holes (alpha cut so 3D eyeballs show through)
    const lids = this._lidAmount();
    for (const eye of [LAYOUT.eyeL, LAYOUT.eyeR]) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      const openRy = LAYOUT.eyeRy * (1 - lids);
      ctx.ellipse(eye.x * W, eye.y * W, LAYOUT.eyeRx * W, Math.max(0.001, openRy) * W, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      // lash line / liner
      ctx.strokeStyle = 'rgba(25,12,18,0.85)';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.ellipse(eye.x * W, eye.y * W, LAYOUT.eyeRx * W, Math.max(0.004, openRy) * W, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
      // lower lid subtle
      ctx.strokeStyle = 'rgba(60,30,35,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(eye.x * W, eye.y * W, LAYOUT.eyeRx * W * 0.9, Math.max(0.004, openRy) * W, 0, 0, Math.PI);
      ctx.stroke();
    }

    // brows
    const browCol = colors.brows || 'rgba(30,18,22,0.9)';
    ctx.strokeStyle = browCol;
    ctx.lineWidth = 5 * (this.persona.face?.browWeight ?? 1);
    ctx.lineCap = 'round';
    for (const [ex, m] of [[LAYOUT.eyeL.x, 1], [LAYOUT.eyeR.x, -1]]) {
      const bx = ex * W, by = (LAYOUT.browY - s.browRaise * 0.03) * W;
      const tilt = s.browAngle * 8 * m; // inner end up/down
      ctx.beginPath();
      ctx.moveTo(bx - 20 * m, by + tilt);            // inner
      ctx.quadraticCurveTo(bx + 2 * m, by - 7 - s.browRaise * 4, bx + 22 * m, by + 2 - tilt * 0.3);
      ctx.stroke();
    }

    // mouth
    const mc = this._mouthCur;
    const open = Math.min(1, mc.open + s.mouthOpen + this._talkAmp * 0.85);
    const mx = LAYOUT.mouth.x * W + mc.skew * 6;
    const my = LAYOUT.mouth.y * W;
    const w = mc.w * W * (1 - 0.25 * mc.pout);
    const curve = mc.curve * 14;
    const openPx = open * 15 + mc.pout * 3;

    ctx.fillStyle = colors.lips;
    ctx.beginPath();
    ctx.moveTo(mx - w, my - curve * 0.4 + mc.skew * 3);
    ctx.quadraticCurveTo(mx, my - 4 - curve, mx + w, my - curve * 0.4 - mc.skew * 3);
    ctx.quadraticCurveTo(mx, my + 6 + openPx + curve * 0.3, mx - w, my - curve * 0.4 + mc.skew * 3);
    ctx.fill();
    if (open > 0.12) {
      ctx.fillStyle = 'rgba(35,10,18,0.9)';
      ctx.beginPath();
      ctx.ellipse(mx, my + 2 + openPx * 0.35, w * 0.62, openPx * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      if (mc.teeth > 0) {
        ctx.fillStyle = 'rgba(245,240,235,0.95)';
        ctx.fillRect(mx - w * 0.5, my - 1 + curve * -0.2, w, 3.5);
      }
    }
    // lip highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(mx - w * 0.5, my + 3 + openPx);
    ctx.quadraticCurveTo(mx, my + 6 + openPx, mx + w * 0.5, my + 3 + openPx);
    ctx.stroke();

    this.tex.needsUpdate = true;

    // pupil dilation redraw (cheap, only when state changed)
    for (const side of ['L', 'R']) {
      const g = this.eyes[side];
      this._drawIris(g.userData.irisCanvas, this.persona.colors.eyes, s.pupil);
      g.userData.irisTex.needsUpdate = true;
    }
  }

  _drawIris(c, eyeColor, pupil) {
    const ctx = c.getContext('2d');
    const W = c.width, cx = W / 2;
    ctx.clearRect(0, 0, W, W);
    const g = ctx.createRadialGradient(cx, cx, 2, cx, cx, W * 0.48);
    g.addColorStop(0, eyeColor);
    g.addColorStop(0.85, eyeColor);
    g.addColorStop(1, 'rgba(10,8,12,0.9)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cx, W * 0.48, 0, Math.PI * 2); ctx.fill();
    // pupil
    ctx.fillStyle = '#0a0710';
    ctx.beginPath(); ctx.arc(cx, cx, W * (0.13 + 0.14 * pupil), 0, Math.PI * 2); ctx.fill();
    // catchlight
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(cx + W * 0.12, cx - W * 0.14, W * 0.07, 0, Math.PI * 2); ctx.fill();
  }
}
