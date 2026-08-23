// @ts-check
// Procedural face: a curved decal patch over the skull carrying a 256² canvas
// (skin, brows, lids, mouth, blush) with alpha-cut eye holes, plus 3D eyeballs
// on the eye bones. Redraws are dirty-flagged and capped at ~15Hz.
//
// v0.3 pass — the canvas rig stays (256px + alpha-cut holes + real eyeballs is a
// genuinely good trick), but the four things that made it read as a painted mask
// are fixed here:
//   1. the patch is RELIEVED — a nose bridge and tip, brow ridge, cheeks, lips and
//      chin are displaced out of the sphere, so the face has silhouette;
//   2. its border tucks INTO the skull and fades to alpha 0, so there is no
//      rectangular plate rim floating off the cheek;
//   3. the eyeballs hang off the declared eyeL/eyeR bones (they were parented to
//      `head` and rotated as loose Groups — the bones were dead weight);
//   4. `jaw` — declared in skeleton.js since day one, driven by nothing — now
//      opens with the mouth (bodyBuilder tri-chains the chin mass onto it).
// Mouth shape comes from viseme targets rather than raw voice amplitude.
import * as THREE from 'three';
import { cfg } from '../core/config.js';

const _e = new THREE.Euler();

/**
 * Face patch geometry, in FRACTIONS OF BODY HEIGHT. Exported because
 * skeleton.js places the eyeL/eyeR bones at the eyeball centres derived from it
 * — the bone has to sit at the centre of rotation or gaze orbits the eyeball
 * around the skull instead of spinning it in its socket.
 */
export const FACE_PATCH = {
  r: 0.066,
  phiStart: Math.PI / 2 - 1.62 / 2, phiLen: 1.62,
  thetaStart: 0.62, thetaLen: 1.42,
  sx: 0.94, sy: 1.06, sz: 0.98,
  cx: 0, cy: 0.951, cz: 0.010,
  // Eyeball centre pushed in from the patch surface. Must exceed the eyeball
  // RADIUS (below) or the sphere intersects the decal and bulges out past the
  // painted lid line all around the hole — which it did at the old 0.010, giving
  // every character a slightly pop-eyed stare.
  eyeInset: 0.0165,
  eyeRadius: 0.0130,
};

/**
 * Personas that ship a face underpaint under assets/chars/<id>/face.jpg.
 * Anything not listed here uses the purely procedural face — which is every
 * hostile, every refugee, and VOX.
 */
export const FACE_ASSETS = new Set(['lola', 'aria', 'kai', 'player-f', 'player-m']);

// canvas-space layout (fractions of the 256² face patch). Canvas-left is the
// character's RIGHT (we look at the face from +Z), so LAYOUT.eyeL drives bone eyeR.
export const LAYOUT = {
  eyeL: { x: 0.34, y: 0.48 },
  eyeR: { x: 0.66, y: 0.48 },
  eyeRx: 0.072, eyeRy: 0.05,     // hole radii
  browY: 0.385,
  mouth: { x: 0.5, y: 0.725 },
  noseY: 0.615,
};

/**
 * Soft skin-toned wash over the bands where the identity underpaint paints its
 * OWN brows and mouth.
 *
 * The underpaint is a photo/render of a whole face, so it arrives with features
 * already on it. The procedural layer then draws brows, a nose and lips on top —
 * and those are the ANIMATED ones (visemes, blinks, expressions). Drawn together
 * you get two mouths and two sets of eyebrows, one of them frozen; that is the
 * first thing a viewer sees. Suppressing the procedural set instead is not an
 * option — the face would stop emoting entirely.
 *
 * So the underpaint keeps what it is good at (skin tone, cheekbones, jaw shading,
 * identity) and gives up the two regions the rig animates.
 * @param {CanvasRenderingContext2D} ctx @param {number} W @param {any} colors
 */
export function maskUnderFeatures(ctx, W, colors) {
  const wash = (cx, cy, rx, ry, alpha) => {
    const r = Math.max(rx, ry);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, colors.skin);
    g.addColorStop(0.6, colors.skin);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(1, ry / r);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  wash(W * 0.5, LAYOUT.browY * W + 2, W * 0.30, W * 0.055, 0.92);   // brow band
  wash(LAYOUT.mouth.x * W, LAYOUT.mouth.y * W, W * 0.17, W * 0.075, 0.94);  // mouth band
}

/** canvas (u,v) → patch surface point, in height fractions, relative to body origin */
export function patchSurface(u, v, out = new THREE.Vector3()) {
  const g = FACE_PATCH;
  const phi = g.phiStart + u * g.phiLen;
  const theta = g.thetaStart + v * g.thetaLen;
  return out.set(
    -g.r * Math.cos(phi) * Math.sin(theta) * g.sx,
    g.r * Math.cos(theta) * g.sy,
    g.r * Math.sin(phi) * Math.sin(theta) * g.sz
  ).add(new THREE.Vector3(g.cx, g.cy, g.cz));
}

/**
 * Eyeball centre for a bone side, in height fractions (bind/world space).
 * @param {'L'|'R'} side  bone side — L is the character's left (+x)
 */
export function eyeBallCentre(side, out = new THREE.Vector3()) {
  const key = side === 'L' ? 'eyeR' : 'eyeL';   // canvas-mirrored, see LAYOUT
  const g = FACE_PATCH;
  const centre = new THREE.Vector3(g.cx, g.cy, g.cz);
  patchSurface(LAYOUT[key].x, LAYOUT[key].y, out);
  const outward = out.clone().sub(centre).normalize();
  return out.addScaledVector(outward, -g.eyeInset);
}

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

/**
 * Viseme targets: `open` = jaw drop, `wide` = lip spread (negative = pursed),
 * `round` = lip rounding, `teeth` = show the upper teeth.
 * A small set is enough — the eye reads mouth OPENNESS and CLOSURE, and gets the
 * rest from the audio. What it will not forgive is a mouth that never closes,
 * which is exactly what mapping raw RMS to a single "open" value produces.
 */
const VISEMES = {
  rest: { open: 0.00, wide: 0.00, round: 0.00, teeth: 0 },
  AA: { open: 1.00, wide: 0.25, round: 0.00, teeth: 0 },   // father
  EE: { open: 0.42, wide: 1.00, round: 0.00, teeth: 0.35 }, // see
  IH: { open: 0.34, wide: 0.50, round: 0.00, teeth: 0 },   // sit
  OH: { open: 0.68, wide: -0.30, round: 0.75, teeth: 0 },   // go
  OO: { open: 0.26, wide: -0.65, round: 1.00, teeth: 0 },   // boot / w
  MM: { open: 0.00, wide: 0.10, round: 0.15, teeth: 0 },   // m / b / p closure
  FF: { open: 0.12, wide: 0.35, round: 0.00, teeth: 0.6 },  // f / v
  TH: { open: 0.22, wide: 0.40, round: 0.00, teeth: 0.5 },  // th / s / z
  LL: { open: 0.38, wide: 0.28, round: 0.00, teeth: 0.25 }, // l / n / d / t
};

/** letter → viseme, for `speak()` when a caller has the spoken text */
const LETTER_VISEME = {
  a: 'AA', e: 'EE', i: 'IH', o: 'OH', u: 'OO', y: 'IH',
  m: 'MM', b: 'MM', p: 'MM',
  f: 'FF', v: 'FF',
  s: 'TH', z: 'TH', c: 'TH', x: 'TH', j: 'TH',
  l: 'LL', n: 'LL', d: 'LL', t: 'LL', r: 'OH',
  w: 'OO', q: 'OO',
  g: 'IH', h: 'IH', k: 'IH',
};

/** amplitude-driven fallback sequences — a closure is forced every 5th step */
const LOUD_SEQ = ['AA', 'OH', 'EE', 'AA', 'MM', 'IH', 'AA', 'OO', 'EE', 'MM'];
const SOFT_SEQ = ['IH', 'LL', 'TH', 'EE', 'MM', 'FF', 'IH', 'LL', 'TH', 'MM'];

export class FaceRig {
  /**
   * @param {{ colors: {skin:string, hair:string, eyes:string, lips:string, brows?:string},
   *           body: {height:number}, face?: {browWeight?:number, lashes?:number} }} persona
   * @param {{ byName: Record<string, THREE.Bone>, joints: Record<string, THREE.Vector3> }} rig
   */
  constructor(persona, rig) {
    this.persona = persona;
    const h = persona.body.height;
    this._h = h;

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
    this._redrawHz = cfg('humanoid.face.redrawHz', 15);
    this._under = null;
    // Only fetch art we actually ship. Hostile ids are generated at spawn
    // (`hostile_0_4732`), refugees are `refugee`/`refugee2`, VOX is bodiless —
    // every one of them fired a 404, i.e. one per hostile per combat wave, on
    // the spawn hot path.
    const underUrl = persona.faceAsset
      || (FACE_ASSETS.has(persona.id) ? `/assets/chars/${persona.id}/face.jpg` : null);
    if (typeof Image !== 'undefined' && underUrl) {
      const img = new Image();
      img.onload = () => { this._under = img; this._dirty = true; };
      img.onerror = () => { this._under = null; };
      img.src = underUrl;
    }

    // viseme state
    this._vis = { ...VISEMES.rest };
    this._visTarget = VISEMES.rest;
    this._visHold = 0;
    this._visStep = 0;
    /** @type {{v:string, t:number}[]|null} scripted timeline from speak() */
    this._timeline = null;
    this._timelineT = 0;

    this._jaw = rig.byName.jaw || null;
    this._jawMax = THREE.MathUtils.degToRad(cfg('humanoid.face.jawOpenDeg', 14));
    this._eyeYaw = 0;
    this._eyePitch = 0;

    // --- canvas + decal patch. A canvas (u,v) maps to a surface point via
    // patchSurface(), so the eyeball bones sit EXACTLY behind their canvas holes.
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 256;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;

    const g = FACE_PATCH;
    const headWorld = rig.joints.head;
    this._centre = new THREE.Vector3(g.cx * h, g.cy * h, g.cz * h).sub(headWorld);

    const patch = new THREE.SphereGeometry(g.r * h, 30, 26,
      g.phiStart, g.phiLen, g.thetaStart, g.thetaLen);
    relieveFace(patch, h);
    const mat = new THREE.MeshStandardMaterial({
      map: this.tex,
      roughness: cfg('humanoid.skin.roughness', 0.62),
      // the border fades to alpha 0 (drawn in draw()) so the patch dissolves into
      // the skull instead of showing a plate edge — hence transparent + a low
      // alphaTest that still hard-cuts the eye holes.
      transparent: true, alphaTest: 0.04,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.decal = new THREE.Mesh(patch, mat);
    this.decal.scale.set(g.sx, g.sy, g.sz);
    this.decal.position.copy(this._centre);
    this.decal.castShadow = false;
    rig.byName.head.add(this.decal);

    // --- eyeballs, parented to the EYE BONES (which sit at the eyeball centres)
    this.eyes = {};
    this.eyeBones = {};
    for (const side of /** @type {('L'|'R')[]} */ (['L', 'R'])) {
      const bone = rig.byName['eye' + side];
      const centre = eyeBallCentre(side).multiplyScalar(h);
      const outward = centre.clone().sub(new THREE.Vector3(g.cx * h, g.cy * h, g.cz * h)).normalize();

      const group = new THREE.Group();
      // the bone IS the eyeball centre, so the visual group sits at its origin;
      // gaze rotates the bone, which spins the eye in place.
      group.position.set(0, 0, 0);
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(FACE_PATCH.eyeRadius * h, 14, 12),
        // A cornea is the glossiest thing on a character, so it is the FIRST
        // surface to blow past the bloom threshold (0.86) once scene.environment
        // carries neon sign cards — roughness 0.14 × 1.4 env gain turned both
        // eyes into flashing lamps that swept as the head turned. Keep the
        // reflection a small crisp catchlight: nothing on a body should bloom.
        new THREE.MeshStandardMaterial({
          // A sclera is wet, not chrome. At roughness 0.20 a near-white sphere put
          // a specular under the lounge lamp (95 candela, ~1m) hot enough to clear
          // the bloom threshold — and since the blink scheduler covers and uncovers
          // the eyes, that hot spot WINKED ON AND OFF. It read as literal blinking
          // lights on every head. Keep the catchlight soft, dim and off-white.
          color: cfg('humanoid.eye.sclera', 0xdedad2),
          roughness: cfg('humanoid.eye.roughness', 0.38),
          metalness: 0,
          envMapIntensity: cfg('humanoid.eye.envMapIntensity', 0.22),
        })
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
      iris.position.z = (FACE_PATCH.eyeRadius - 0.0004) * h;
      group.add(ball, iris);
      // orient +Z along the outward surface normal. setFromUnitVectors, not
      // lookAt: lookAt() works in WORLD space and would aim the eye at the point
      // one metre from the origin along `outward` instead of along the normal.
      // Bone axes are world-aligned at bind, so this rest tilt lives inside the bone.
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward);
      group.userData.irisCanvas = irisC;
      group.userData.irisTex = irisTex;
      bone.add(group);
      this.eyes[side] = group;
      this.eyeBones[side] = bone;
    }
    this._irisPupil = this.state.pupil;
    this.draw();
  }

  /** @param {Partial<typeof this.state>} partial */
  setExpression(partial) {
    Object.assign(this.state, partial);
    this._dirty = true;
  }

  /** Voice amplitude 0..1 → mouth ENERGY while speaking (shape comes from visemes). */
  setTalk(amp) {
    if (Math.abs(amp - this._talkAmp) > 0.06) this._dirty = true;
    this._talkAmp = amp;
    if (amp <= 0.01) { this._timeline = null; this._timelineT = 0; }
  }

  /**
   * Drive the mouth from actual text. Optional — nothing in the pipeline hands
   * the face its line yet, so setTalk()'s amplitude-driven sequencer is what
   * normally runs; wire `speak(text, seconds)` in beside a TTS start for real
   * phoneme timing.
   * @param {string} text @param {number} durationSec
   */
  speak(text, durationSec) {
    const seq = [];
    let prev = '';
    for (const ch of String(text).toLowerCase()) {
      const v = LETTER_VISEME[ch];
      if (!v) { if (seq.length && seq[seq.length - 1] !== 'rest') seq.push('rest'); prev = ''; continue; }
      if (v === prev) continue;   // collapse doubled letters
      seq.push(v);
      prev = v;
    }
    if (!seq.length || !(durationSec > 0)) { this._timeline = null; return; }
    const step = durationSec / seq.length;
    this._timeline = seq.map((v, i) => ({ v, t: i * step }));
    this._timelineT = 0;
  }

  /**
   * @param {number} dt seconds
   * @param {boolean} [visible] false when the body is hidden (first-person player);
   *        skips every canvas redraw and re-upload for a body nobody can see.
   */
  update(dt, visible = true) {
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

    // eye gaze — rotate the EYE BONES (world-aligned at bind, so x = pitch,
    // y = yaw). Written after the animator's relax pass each frame, so its
    // ease-to-identity on unclipped bones can't fight this.
    const k = Math.min(1, dt * 14);
    this._eyeYaw += (this.state.gaze.x * 0.5 - this._eyeYaw) * k;
    this._eyePitch += (-this.state.gaze.y * 0.32 - this._eyePitch) * k;
    for (const side of ['L', 'R']) {
      const bone = this.eyeBones[side];
      if (bone) bone.quaternion.setFromEuler(_e.set(this._eyePitch, this._eyeYaw, 0, 'XYZ'));
    }

    // mouth shape easing
    const target = MOUTHS[this.state.mouth] || MOUTHS.neutral;
    const cur = this._mouthCur;
    const mk = Math.min(1, dt * 10);
    for (const key of ['w', 'curve', 'open', 'pout']) {
      const t = target[key] ?? 0;
      if (Math.abs(cur[key] - t) > 0.003) { cur[key] += (t - cur[key]) * mk; this._dirty = true; }
    }
    cur.skew = target.skew ?? 0;
    cur.teeth = target.teeth ?? 0;

    this._advanceVisemes(dt);

    // jaw bone: the chin mass is tri-chained onto it in bodyBuilder, so this is
    // real 3D mouth opening on top of the painted one.
    if (this._jaw) {
      const openness = Math.min(1, cur.open + this.state.mouthOpen + this._vis.open * this._talkGain());
      this._jaw.quaternion.setFromEuler(_e.set(openness * this._jawMax, 0, 0, 'XYZ'));
    }

    if (!visible) { this._sinceDraw = 0; return; }
    this._sinceDraw += dt;
    if (this._dirty && this._sinceDraw > 1 / this._redrawHz) this.draw();
  }

  /** how strongly the viseme shape rides on top of the expression mouth */
  _talkGain() { return Math.min(1, 0.35 + this._talkAmp * 0.9); }

  /**
   * Advance the viseme target. A scripted timeline (speak()) wins; otherwise the
   * amplitude sequencer walks a fixed pattern that includes lip CLOSURES, which
   * is what separates "talking" from "jaw flapping to an envelope".
   * @param {number} dt
   */
  _advanceVisemes(dt) {
    let next = VISEMES.rest;
    if (this._timeline) {
      this._timelineT += dt;
      const tl = this._timeline;
      let i = 0;
      while (i + 1 < tl.length && tl[i + 1].t <= this._timelineT) i++;
      if (this._timelineT > tl[tl.length - 1].t + 0.2) this._timeline = null;
      else next = VISEMES[tl[i].v] || VISEMES.rest;
    } else if (this._talkAmp > 0.04) {
      this._visHold -= dt;
      if (this._visHold <= 0) {
        this._visStep++;
        const seq = this._talkAmp > 0.45 ? LOUD_SEQ : SOFT_SEQ;
        this._visTarget = VISEMES[seq[this._visStep % seq.length]];
        // shorter holds when loud — louder speech is faster speech
        this._visHold = 0.055 + 0.085 * (1 - Math.min(1, this._talkAmp));
      }
      next = this._visTarget;
    } else {
      this._visTarget = VISEMES.rest;
    }
    const kk = Math.min(1, dt * 22);
    for (const key of ['open', 'wide', 'round', 'teeth']) {
      const d = (next[key] ?? 0) - this._vis[key];
      if (Math.abs(d) > 0.004) { this._vis[key] += d * kk; this._dirty = true; }
    }
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

    if (this._under) {
      ctx.globalAlpha = 0.88;
      ctx.drawImage(this._under, W * -0.06, W * -0.08, W * 1.12, W * 1.16);
      ctx.globalAlpha = 1;
      maskUnderFeatures(ctx, W, colors);
    }

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

    // nose: the patch is now displaced into a real bridge + tip, so the painted
    // pass is only the shading that sells it
    ctx.strokeStyle = 'rgba(60,30,35,0.20)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 4, LAYOUT.noseY * W - 20);
    ctx.quadraticCurveTo(W / 2 - 6, LAYOUT.noseY * W, W / 2 - 1, LAYOUT.noseY * W + 2);
    ctx.stroke();
    for (const dx of [-5, 5]) {
      ctx.beginPath();
      ctx.ellipse(W / 2 + dx, LAYOUT.noseY * W + 4, 2.2, 1.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(60,30,35,0.30)';
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

    // mouth: expression shape × viseme
    const mc = this._mouthCur, vis = this._vis, gain = this._talkGain();
    const open = Math.min(1, mc.open + s.mouthOpen + vis.open * gain);
    const mx = LAYOUT.mouth.x * W + mc.skew * 6;
    const my = LAYOUT.mouth.y * W;
    const round = vis.round * gain;
    const w = mc.w * W * (1 - 0.25 * mc.pout) * (1 + 0.26 * vis.wide * gain - 0.34 * round);
    const curve = mc.curve * 14;
    const openPx = open * 15 + (mc.pout + round * 0.6) * 3;
    const teeth = Math.max(mc.teeth, vis.teeth * gain);

    ctx.fillStyle = colors.lips;
    ctx.beginPath();
    ctx.moveTo(mx - w, my - curve * 0.4 + mc.skew * 3);
    ctx.quadraticCurveTo(mx, my - 4 - curve - round * 3, mx + w, my - curve * 0.4 - mc.skew * 3);
    ctx.quadraticCurveTo(mx, my + 6 + openPx + curve * 0.3, mx - w, my - curve * 0.4 + mc.skew * 3);
    ctx.fill();
    if (open > 0.12) {
      ctx.fillStyle = 'rgba(35,10,18,0.9)';
      ctx.beginPath();
      ctx.ellipse(mx, my + 2 + openPx * 0.35, w * 0.62, openPx * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      if (teeth > 0.05) {
        ctx.fillStyle = `rgba(245,240,235,${0.5 + 0.45 * teeth})`;
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

    // border fade: erase alpha toward the edges so the patch dissolves into the
    // skull instead of ending in a hard plate rim (relieveFace() also tucks the
    // border geometry inward so the fade happens BELOW the skull surface).
    ctx.globalCompositeOperation = 'destination-out';
    const feather = 0.13 * W;
    const edges = [
      [0, 0, feather, 0], [W, 0, W - feather, 0],
      [0, 0, 0, feather], [0, W, 0, W - feather],
    ];
    for (const [x0, y0, x1, y1] of edges) {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, W);
    }
    ctx.globalCompositeOperation = 'source-over';

    this.tex.needsUpdate = true;

    // Iris redraw + GPU re-upload ONLY on a pupil change. This used to run for
    // both eyes on every draw (up to 15Hz × every actor, including the invisible
    // first-person player body) despite a comment claiming otherwise — two 64²
    // canvas repaints and two texture uploads per actor per redraw, for pixels
    // that were almost always identical.
    if (Math.abs(s.pupil - this._irisPupil) > 0.01) {
      this._irisPupil = s.pupil;
      for (const side of ['L', 'R']) {
        const g = this.eyes[side];
        this._drawIris(g.userData.irisCanvas, this.persona.colors.eyes, s.pupil);
        g.userData.irisTex.needsUpdate = true;
      }
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
    // Catchlight. The iris is a MeshBasicMaterial, i.e. UNLIT — whatever is
    // painted here renders at full value regardless of the room, so a pure-white
    // dot sails past the 0.86 bloom threshold and flares as the eye tracks.
    const cl = cfg('humanoid.eye.catchlight', 0.55);
    ctx.fillStyle = `rgba(255,255,255,${cl})`;
    ctx.beginPath(); ctx.arc(cx + W * 0.12, cx - W * 0.14, W * 0.06, 0, Math.PI * 2); ctx.fill();
  }
}

/** unit gaussian bump */
function bump(x, mu, sigma) {
  const d = (x - mu) / sigma;
  return Math.exp(-0.5 * d * d);
}

/**
 * Displace the face patch out of its sphere into an actual face: nose bridge and
 * tip, brow ridge, cheekbones, lips, chin, recessed eye sockets — and tuck the
 * BORDER inward so the (alpha-faded) patch edge sinks under the skull.
 *
 * The patch's uv IS its canvas coordinate — SphereGeometry writes uv.y = 1 - v,
 * so canvas-y = 1 - uv.y — which is why every feature here can be positioned in
 * the same LAYOUT space the 2D pass paints in.
 * @param {THREE.BufferGeometry} geo @param {number} h body height
 */
export function relieveFace(geo, h) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  const scale = cfg('humanoid.face.relief', 1);
  const tuck = cfg('humanoid.face.borderTuck', 0.014);
  for (let i = 0; i < pos.count; i++) {
    const cu = uv.getX(i), cv = 1 - uv.getY(i);
    const dx = cu - 0.5, adx = Math.abs(dx);
    let d = 0;
    // nose: a ridge down the midline that swells into the tip
    d += 0.0062 * bump(dx, 0, 0.048) * bump(cv, 0.545, 0.105);
    d += 0.0048 * bump(dx, 0, 0.055) * bump(cv, 0.618, 0.030);
    // brow ridge over each eye
    d += 0.0034 * bump(cv, 0.395, 0.032) * bump(adx, 0.145, 0.080);
    // cheekbones
    d += 0.0032 * bump(cv, 0.585, 0.085) * bump(adx, 0.235, 0.085);
    // lips
    d += 0.0034 * bump(cv, LAYOUT.mouth.y, 0.040) * bump(dx, 0, 0.078);
    // chin
    d += 0.0030 * bump(cv, 0.885, 0.055) * bump(dx, 0, 0.085);
    // eye sockets sit back under the brow
    d -= 0.0030 * bump(cv, 0.470, 0.045) * (bump(adx, 0.160, 0.060));
    d *= scale;
    // border tuck — pull the rim under the skull surface
    const edge = Math.min(cu, 1 - cu, cv, 1 - cv);
    d -= tuck * (1 - Math.min(1, edge / 0.11));

    pos.setXYZ(i,
      pos.getX(i) + nrm.getX(i) * d * h,
      pos.getY(i) + nrm.getY(i) * d * h,
      pos.getZ(i) + nrm.getZ(i) * d * h);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
