// @ts-check
// Geometry + skin-weight invariants for the procedural avatars.
//
// These are the only automated eyes on the avatar rebuild: the mesh is generated
// at runtime from persona numbers, so a bad ring profile or an off-by-one in a
// swept limb shows up as a hole, an inside-out normal or a candy-wrapped elbow
// that nobody sees until the game is running. Each test below encodes a property
// that was actually broken at some point during the v0.3 pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  stackGeo, tubeGeo, shellGeo, chainSkin, chainSkinScalars, blendBoneInfluence,
  rigidSkin, mergeGeometries, weldGeometry, smooth01, MAX_INFLUENCES,
} from '../../src/util/geo.js';
import { BONES, buildSkeleton } from '../../src/humanoid/skeleton.js';
import { buildBodyGeometry, trunkRings, sampleTrunk, legOuterX, breastLobe } from '../../src/humanoid/bodyBuilder.js';
import { buildOutfit } from '../../src/humanoid/outfitBuilder.js';
import { eyeBallCentre, FACE_PATCH } from '../../src/humanoid/face.js';
import { OUTFITS, DEFAULT_OUTFIT } from '../../data/outfits.js';
import { lola } from '../../data/cast/lola.js';
import { aria } from '../../data/cast/aria.js';
import { kai } from '../../data/cast/kai.js';

const CAST = [lola, aria, kai];

/* ───────────────────────────── helpers ─────────────────────────────────── */

/** @param {THREE.BufferGeometry} geo */
function skinStats(geo) {
  const pos = geo.getAttribute('position');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  let worstSumErr = 0, maxInfluences = 0, badBone = 0, nonFinite = 0;
  for (let i = 0; i < pos.count; i++) {
    let sum = 0, used = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (!Number.isFinite(w)) { nonFinite++; continue; }
      sum += w;
      if (w > 1e-5) {
        used++;
        const b = si.getComponent(i, k);
        if (!Number.isInteger(b) || b < 0 || b >= BONES.length) badBone++;
      }
    }
    worstSumErr = Math.max(worstSumErr, Math.abs(sum - 1));
    maxInfluences = Math.max(maxInfluences, used);
  }
  return { worstSumErr, maxInfluences, badBone, nonFinite, verts: pos.count };
}

/** Edge-manifold report: boundary = edge used by one triangle, nonManifold = >2. */
function edgeStats(geo) {
  const idx = geo.getIndex();
  /** @type {Map<string, number>} */
  const edges = new Map();
  let degenerate = 0;
  for (let i = 0; i < idx.count; i += 3) {
    const t = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) { degenerate++; continue; }
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0;
  for (const n of edges.values()) { if (n === 1) boundary++; else if (n > 2) nonManifold++; }
  return { boundary, nonManifold, degenerate, edges: edges.size };
}

/**
 * Signed volume of a closed mesh (divergence theorem). Positive means every
 * triangle winds OUTWARD; an inside-out shell gives a negative volume. This is
 * the right test where a "does the normal point away from the centroid?"
 * heuristic is not: the body is many closed shells (torso, two arms, ten fingers,
 * two legs, two feet) and a finger's normals legitimately point back toward the
 * body's centre of mass.
 */
function signedVolume(geo, indices) {
  const pos = geo.getAttribute('position');
  const idx = indices || geo.getIndex().array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(pos, idx[i]);
    b.fromBufferAttribute(pos, idx[i + 1]);
    c.fromBufferAttribute(pos, idx[i + 2]);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
}

/** Split an indexed geometry into vertex-connected components' index arrays. */
function components(geo) {
  const idx = geo.getIndex().array;
  const n = geo.getAttribute('position').count;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (x, y) => { const a = find(x), b = find(y); if (a !== b) parent[a] = b; };
  for (let i = 0; i < idx.length; i += 3) { union(idx[i], idx[i + 1]); union(idx[i + 1], idx[i + 2]); }
  /** @type {Map<number, number[]>} */
  const groups = new Map();
  for (let i = 0; i < idx.length; i += 3) {
    const root = find(idx[i]);
    let g = groups.get(root);
    if (!g) groups.set(root, g = []);
    g.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  return [...groups.values()];
}

/* ───────────────────────────── geo primitives ──────────────────────────── */

test('smooth01 is a clamped hermite: 0, 0.5 at the midpoint, 1', () => {
  assert.equal(smooth01(-3), 0);
  assert.equal(smooth01(0), 0);
  assert.equal(smooth01(0.5), 0.5);
  assert.equal(smooth01(1), 1);
  assert.equal(smooth01(9), 1);
  // monotone and symmetric about the midpoint
  assert.ok(smooth01(0.25) < 0.5 && smooth01(0.75) > 0.5);
  assert.ok(Math.abs(smooth01(0.25) + smooth01(0.75) - 1) < 1e-12);
});

test('stackGeo and tubeGeo produce closed, outward-facing surfaces', () => {
  const stack = stackGeo([{ y: 0, rx: 0.2 }, { y: 0.5, rx: 0.25, rz: 0.15 }, { y: 1, rx: 0.1 }], 14);
  const se = edgeStats(stack.geo);
  assert.equal(se.boundary, 0, 'a capped stack must be closed');
  assert.equal(se.nonManifold, 0);
  assert.equal(se.degenerate, 0);
  assert.ok(signedVolume(stack.geo) > 0, 'stackGeo winding must face outward');

  const tube = tubeGeo(
    [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.2, 0.5, 0), new THREE.Vector3(0.25, 0, 0.1)],
    [{ rx: 0.1 }, { rx: 0.08, rz: 0.06 }, { rx: 0.04 }], 12,
    { capStart: true, capEnd: true });
  const te = edgeStats(tube.geo);
  assert.equal(te.boundary, 0, 'a capped tube must be closed');
  assert.equal(te.nonManifold, 0);
  assert.ok(signedVolume(tube.geo) > 0, 'tubeGeo winding must face outward');
});

test('tubeGeo reports arc length monotonically along the path', () => {
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -2, 0)];
  const t = tubeGeo(pts, [{ rx: 0.1 }, { rx: 0.1 }, { rx: 0.1 }], 8);
  assert.equal(t.total, 2);
  // ring r shares one arc value; rings ascend
  assert.equal(t.arc[0], 0);
  assert.ok(Math.abs(t.arc[8] - 1) < 1e-6);
  assert.ok(Math.abs(t.arc[16] - 2) < 1e-6);
});

test('shellGeo is closed and has an inner surface (the visible hem)', () => {
  const outer = [{ y: 0.6, rx: 0.10 }, { y: 0.8, rx: 0.12 }];
  const inner = [{ y: 0.6, rx: 0.09 }, { y: 0.8, rx: 0.11 }];
  const geo = shellGeo(outer, inner, 12);
  const e = edgeStats(geo);
  assert.equal(e.boundary, 0, 'a garment shell must be closed at both hems');
  assert.equal(e.nonManifold, 0);
  // a shell encloses only the FABRIC, so its volume is positive but far smaller
  // than the solid it wraps — that is what makes a hem visible
  const solid = shellGeo(outer, outer.map((r) => ({ ...r, rx: 1e-4 })), 12);
  const v = signedVolume(geo);
  assert.ok(v > 0, 'shell must wind outward');
  assert.ok(v < signedVolume(solid) * 0.35, 'shell must be hollow, not solid');
});

test('mergeGeometries zero-fills attributes a part is missing', () => {
  // regression: the old merge skipped absent attributes entirely, which shifted
  // every LATER part's attribute stream against its positions
  const a = new THREE.BufferGeometry();
  a.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  a.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  a.setIndex([0, 1, 2]);
  const b = new THREE.BufferGeometry();   // no uv
  b.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1]), 3));
  b.setIndex([0, 1, 2]);

  const merged = mergeGeometries([b, a]);
  assert.equal(merged.getAttribute('position').count, 6);
  assert.equal(merged.getAttribute('uv').count, 6, 'uv must be padded to the vertex count');
  // a's uvs must still line up with a's positions (which now start at index 3)
  assert.equal(merged.getAttribute('uv').getX(4), 1);
});

/* ───────────────────────────── skinning ────────────────────────────────── */

test('chainSkin blends smoothly and never exceeds 4 influences', () => {
  const geo = new THREE.BufferGeometry();
  const ys = [];
  for (let i = 0; i <= 200; i++) ys.push(0, i / 200, 0);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ys), 3));
  chainSkin(geo, [
    { bone: 1, from: 0, to: 0.4 },
    { bone: 2, from: 0.4, to: 0.5 },   // deliberately SHORTER than 2·band
    { bone: 3, from: 0.5, to: 1 },
  ], 0.08);

  const s = skinStats(geo);
  assert.ok(s.worstSumErr < 1e-5, `weights must sum to 1 (worst err ${s.worstSumErr})`);
  assert.ok(s.maxInfluences <= MAX_INFLUENCES);
  assert.equal(s.badBone, 0);
  assert.equal(s.nonFinite, 0);

  // a segment shorter than the blend band MUST pick up a third influence — that
  // is precisely the case (wrist, neck) the old 2-influence chainSkin could not
  // represent, and why elbows candy-wrapped
  assert.equal(s.maxInfluences, 3);

  // the blend is C1: no step larger than a smooth ramp would give
  const sw = geo.getAttribute('skinWeight');
  const si = geo.getAttribute('skinIndex');
  const wOf = (i, bone) => {
    for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bone) return sw.getComponent(i, k);
    return 0;
  };
  let maxStep = 0;
  for (let i = 1; i <= 200; i++) maxStep = Math.max(maxStep, Math.abs(wOf(i, 1) - wOf(i - 1, 1)));
  assert.ok(maxStep < 0.05, `weight must change gradually, saw a ${maxStep} jump`);
  // exactly 50/50 at a boundary
  const at = (y) => Math.round(y * 200);
  assert.ok(Math.abs(wOf(at(0.4), 1) - 0.5) < 0.02, 'boundary should be an even split');
});

test('blendBoneInfluence mixes a bone in without breaking normalisation', () => {
  const geo = new THREE.BufferGeometry();
  const p = [];
  for (let i = 0; i <= 50; i++) p.push(i / 50, 0, 0);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
  rigidSkin(geo, 4);
  blendBoneInfluence(geo, 14, (x) => x);          // ramp 0 → 1 across the strip

  const s = skinStats(geo);
  assert.ok(s.worstSumErr < 1e-5);
  assert.ok(s.maxInfluences <= MAX_INFLUENCES);
  const sw = geo.getAttribute('skinWeight');
  const si = geo.getAttribute('skinIndex');
  const wOf = (i, bone) => {
    for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bone) return sw.getComponent(i, k);
    return 0;
  };
  assert.ok(wOf(0, 4) > 0.99, 'untouched end keeps the original bone');
  assert.ok(wOf(50, 14) > 0.99, 'fully blended end follows the new bone');
  assert.ok(Math.abs(wOf(25, 14) - 0.5) < 0.02, 'halfway is a half share');
});

test('chainSkinScalars degenerates safely when nothing claims a vertex', () => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
  // scalar sits far outside every segment
  chainSkinScalars(geo, [999], [{ bone: 7, from: 0, to: 1 }], 0.01);
  const s = skinStats(geo);
  assert.equal(s.nonFinite, 0);
  assert.ok(s.worstSumErr < 1e-6, 'must still normalise rather than emit zero weights');
});

test('weldGeometry drops the degenerate triangles collapsing creates', () => {
  const geo = new THREE.BufferGeometry();
  // two coincident vertices + one distinct → after welding the triangle is a line
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0,
  ]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const out = weldGeometry(geo, 1e-3);
  assert.equal(out.getAttribute('position').count, 3, 'coincident verts weld');
  assert.equal(out.getIndex().count, 3, 'the collapsed triangle is dropped');
});

/* ───────────────────────────── the body ────────────────────────────────── */

test('the skeleton is still 31 bones with parents before children', () => {
  assert.equal(BONES.length, 31);
  const rig = buildSkeleton(lola.body);
  assert.equal(rig.bones.length, 31);
  const seen = new Set();
  for (const bone of rig.bones) {
    if (bone.parent && bone.parent.type === 'Bone') {
      assert.ok(seen.has(bone.parent.name), `${bone.name} precedes its parent ${bone.parent.name}`);
    }
    seen.add(bone.name);
  }
});

test('eye bones sit AT the eyeball centres derived from the face patch', () => {
  // if these drift apart, gaze orbits the eyeball around the skull
  const rig = buildSkeleton(lola.body);
  for (const side of ['L', 'R']) {
    const want = eyeBallCentre(/** @type {'L'|'R'} */(side)).multiplyScalar(lola.body.height);
    assert.ok(rig.joints['eye' + side].distanceTo(want) < 1e-9);
  }
  // and the eyeball must be fully BEHIND the decal or it bulges past the lids
  assert.ok(FACE_PATCH.eyeInset > FACE_PATCH.eyeRadius,
    'eyeInset must exceed eyeRadius so the sphere cannot intersect the face patch');
});

for (const persona of CAST) {
  test(`body mesh for ${persona.id}: welded, watertight, sanely skinned`, () => {
    const rig = buildSkeleton(persona.body);
    const geo = buildBodyGeometry(persona.body, rig.joints);

    const s = skinStats(geo);
    assert.ok(s.worstSumErr < 1e-5, `skin weights must sum to 1 (worst ${s.worstSumErr})`);
    assert.ok(s.maxInfluences <= MAX_INFLUENCES, `≤4 influences, saw ${s.maxInfluences}`);
    assert.equal(s.badBone, 0, 'every influence must name a real bone');
    assert.equal(s.nonFinite, 0);

    const e = edgeStats(geo);
    assert.equal(e.nonManifold, 0, 'no edge may be shared by 3+ triangles');
    assert.equal(e.degenerate, 0, 'no zero-area triangles survive the weld');
    assert.equal(e.boundary, 0, 'the body must be closed — every limb is capped');

    // every closed shell (torso, arms, fingers, thumbs, legs, feet) must wind
    // outward: one inverted part renders as a black hole in the silhouette
    const parts = components(geo);
    assert.ok(parts.length >= 15, `expected the limb/finger shells, found ${parts.length}`);
    for (const part of parts) {
      assert.ok(signedVolume(geo, part) > 0, 'an inside-out component slipped through');
    }
  });

  test(`body proportions for ${persona.id} track the persona params`, () => {
    const h = persona.body.height;
    const rig = buildSkeleton(persona.body);
    const geo = buildBodyGeometry(persona.body, rig.joints);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    // feet on the floor, crown at ~height (the skull tops out a touch over 1.0h)
    assert.ok(bb.min.y >= 0 && bb.min.y < 0.02 * h, `feet at the floor, got ${bb.min.y}`);
    assert.ok(bb.max.y > 0.98 * h && bb.max.y < 1.05 * h, `crown near height, got ${bb.max.y}`);
    // the head is a narrowing of the same surface, not a detached ball: there
    // must be geometry at every height through the neck
    const pos = geo.getAttribute('position');
    for (const yf of [0.86, 0.875, 0.89, 0.905, 0.92]) {
      let found = 0;
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - yf * h) < 0.006 * h) found++;
      assert.ok(found > 0, `no geometry at y=${yf}h — the neck is not continuous`);
    }
  });

  test(`body params actually move ${persona.id}'s mesh`, () => {
    const rig = buildSkeleton(persona.body);
    const base = buildBodyGeometry(persona.body, rig.joints);
    base.computeBoundingBox();
    const wide = { ...persona.body, hips: persona.body.hips * 1.5, build: persona.body.build * 1.4 };
    const g2 = buildBodyGeometry(wide, buildSkeleton(wide).joints);
    assert.ok(signedVolume(g2) > signedVolume(base) * 1.15,
      'raising hips/build must add real volume');
    const tall = { ...persona.body, height: persona.body.height * 1.1 };
    const g3 = buildBodyGeometry(tall, buildSkeleton(tall).joints);
    g3.computeBoundingBox();
    assert.ok(g3.boundingBox.max.y > base.boundingBox.max.y * 1.08, 'height must scale the mesh');
    assert.equal(base.getAttribute('position').count, g2.getAttribute('position').count,
      'topology must not depend on the parameters');
  });
}

test('trunk sampling is monotone between rings and matches the ring values', () => {
  const rings = trunkRings(lola.body);
  for (const r of rings) {
    const s = sampleTrunk(rings, r.y);
    assert.ok(Math.abs(s.rx - r.rx) < 1e-9, 'sampling AT a ring returns that ring');
  }
  // outside the stack it clamps rather than extrapolating to nonsense
  assert.equal(sampleTrunk(rings, -5).rx, rings[0].rx);
  assert.equal(sampleTrunk(rings, 99).rx, rings[rings.length - 1].rx);
});

test('legOuterX covers the thigh top and is zero above the leg', () => {
  const b = lola.body, h = b.height;
  assert.equal(legOuterX(b, 0.8 * h), 0, 'no leg at chest height');
  const atHip = legOuterX(b, 0.552 * h);
  assert.ok(atHip > b.hipW / 2, 'the thigh flares past its own joint');
  assert.ok(atHip > sampleTrunk(trunkRings(b), 0.552 * h).rx,
    'the thigh top is wider than the pelvis — this is why skirts need coverLegs');
});

/* ───────────────────────────── outfits ─────────────────────────────────── */

test('every character in OUTFITS has a default outfit and buildable recipes', () => {
  for (const id of Object.keys(OUTFITS)) {
    assert.ok(DEFAULT_OUTFIT[id], `${id} has outfit recipes but no DEFAULT_OUTFIT`);
    assert.ok(OUTFITS[id][DEFAULT_OUTFIT[id]], `${id}'s default outfit is not a real state`);
  }
  // Kai has always had the full outfit matrix; he just never had a Wardrobe built
  assert.equal(Object.keys(OUTFITS.kai).length, 8);
});

for (const persona of CAST) {
  test(`every outfit state builds for ${persona.id} with valid skinning`, () => {
    const rig = buildSkeleton(persona.body);
    for (const [id, recipe] of Object.entries(OUTFITS[persona.id])) {
      const meshes = buildOutfit(persona, rig, recipe);
      assert.equal(meshes.length, recipe.pieces.length, `${id}: one mesh per piece`);
      for (const m of meshes) {
        const s = skinStats(m.geometry);
        assert.ok(s.worstSumErr < 1e-5, `${id}: weights must sum to 1`);
        assert.ok(s.maxInfluences <= MAX_INFLUENCES, `${id}: ≤4 influences`);
        assert.equal(s.badBone, 0, `${id}: real bones only`);
        assert.equal(s.nonFinite, 0, `${id}: no NaN weights`);
        // identity bindMatrix — re-running calculateInverses() on the live posed
        // skeleton corrupted every mesh sharing it (see skeleton.js)
        assert.ok(m.bindMatrix.equals(new THREE.Matrix4()), `${id}: bindMatrix must be identity`);
        assert.equal(m.skeleton, rig.skeleton, `${id}: must share the character skeleton`);
      }
    }
  });
}

test('garments clear the skin they cover', () => {
  // the old recipes lathed their own profiles and had no idea what shape they
  // were covering, so a large bust clipped `top` and the calf clipped `leggings`
  for (const persona of CAST) {
    const b = persona.body, h = b.height;
    const rig = buildSkeleton(b);
    const rings = trunkRings(b);
    for (const [id, recipe] of Object.entries(OUTFITS[persona.id])) {
      const torso = recipe.pieces.filter((p) => ['top', 'dress', 'robe', 'towel'].includes(p.piece));
      if (!torso.length) continue;
      for (const m of buildOutfit(persona, rig, { pieces: torso })) {
        const pos = m.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i);
          if (y < 0.62 * h || y > 0.80 * h) continue;    // torso band only
          const s = sampleTrunk(rings, y);
          const q = ((pos.getX(i) - s.cx) / s.rx) ** 2 + ((pos.getZ(i) - s.cz) / s.rz) ** 2;
          assert.ok(q >= 0.98,
            `${persona.id}/${id}: garment vertex sinks into the torso at y=${(y / h).toFixed(3)}h (q=${q.toFixed(3)})`);
        }
      }
    }
  }
});

test('a bust is contained by its top rather than poking through the cup', () => {
  for (const persona of CAST) {
    const b = persona.body;
    const lobe = breastLobe(b, 1);
    if (!lobe) continue;
    const rig = buildSkeleton(b);
    const meshes = buildOutfit(persona, rig, { pieces: [{ piece: 'robe', color: '#888' }] });
    const pos = meshes[0].geometry.getAttribute('position');
    // sample the lobe equator, where a cup is tightest
    for (let a = 0; a < 24; a++) {
      const th = (a / 24) * Math.PI * 2;
      const px = lobe.cx + lobe.ax * Math.cos(th), pz = lobe.cz + lobe.az * Math.sin(th);
      const pr = Math.hypot(px, pz), pa = Math.atan2(pz, px);
      let best = -1;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i) - lobe.cy) > 0.012 * b.height) continue;
        let d = Math.abs(Math.atan2(pos.getZ(i), pos.getX(i)) - pa);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (d > 0.16) continue;
        best = Math.max(best, Math.hypot(pos.getX(i), pos.getZ(i)));
      }
      if (best < 0) continue;
      assert.ok(pr <= best, `${persona.id}: bust escapes the garment at θ=${th.toFixed(2)}`);
    }
  }
});
