// @ts-check
// Outfit coverage: no band of skin between a top and its bottoms, and no outfit
// that leaves the hips or upper thighs bare.
//
// v0.6 reviews caught a visible skin band at the hip on Aria's top + shorts and on
// every top + leggings kit (Kai, the hostiles): the top's hem and the bottom's
// waistband were defined independently, leggings had NO trunk band at all (they
// started on the thigh), and shorts overlapped the top by 0.003·h — half a
// centimetre, gone the moment the spine bends. This checks the recipes against the
// builder's own layout (outfitLayout — the same numbers the geometry is swept
// from), so a recipe or a builder constant can't reopen the gap silently.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSkeleton } from '../../src/humanoid/skeleton.js';
import { buildOutfit, outfitLayout, TUCK_OVERLAP } from '../../src/humanoid/outfitBuilder.js';
import { trunkRings, sampleTrunk } from '../../src/humanoid/bodyBuilder.js';
import { OUTFITS } from '../../data/outfits.js';
import { lola } from '../../data/cast/lola.js';
import { aria } from '../../data/cast/aria.js';
import { kai } from '../../data/cast/kai.js';

/** body-height fractions for the regions that must always be covered */
const PELVIS_LO = 0.518;      // the pelvis cap (lowest trunk ring) — the crotch
const TORSO_HI = 0.80;        // up to the chest line
const THIGH_TOP = 0.590;      // where the body's own leg tube starts (LEG_STATIONS[0])
const THIGH_LO = 0.40;        // lower thigh: nothing shorter than this reads as dressed
const EPS = 1e-9;

/** union of [lo,hi] intervals covers [a,b] with no gap */
function covers(intervals, a, b) {
  const iv = intervals.filter(Boolean).slice().sort((p, q) => p[0] - q[0]);
  let reach = a;
  for (const [lo, hi] of iv) {
    if (lo > reach + EPS) break;
    reach = Math.max(reach, hi);
    if (reach >= b - EPS) return true;
  }
  return reach >= b - EPS;
}

const everyOutfit = () => Object.entries(OUTFITS).flatMap(([who, states]) =>
  Object.entries(states).map(([state, recipe]) => ({ who, state, recipe, L: outfitLayout(recipe) })));

test('every outfit covers the whole torso and pelvis without a gap', () => {
  for (const { who, state, L } of everyOutfit()) {
    const trunk = L.map((l) => l.trunk);
    assert.ok(covers(trunk, PELVIS_LO, TORSO_HI),
      `${who}/${state}: skin shows on the trunk between ${PELVIS_LO}h and ${TORSO_HI}h ` +
      `(layers: ${L.map((l) => `${l.piece}${JSON.stringify(l.trunk)}`).join(' ')})`);
  }
});

test('every outfit covers the thighs from the hip to below mid-thigh', () => {
  for (const { who, state, L } of everyOutfit()) {
    const legs = L.map((l) => l.legs);
    assert.ok(covers(legs, THIGH_LO, THIGH_TOP),
      `${who}/${state}: the upper thigh is bare between ${THIGH_LO}h and ${THIGH_TOP}h ` +
      `(legs: ${L.map((l) => `${l.piece}${JSON.stringify(l.legs)}`).join(' ')})`);
  }
});

test('a top always overlaps its bottoms by at least TUCK_OVERLAP', () => {
  assert.ok(TUCK_OVERLAP >= 0.017 && TUCK_OVERLAP <= 0.025, 'the tuck is ~3–4 cm on a 1.7 m body');
  for (const { who, state, L } of everyOutfit()) {
    const tops = L.filter((l) => l.role === 'top');
    const bottoms = L.filter((l) => l.role === 'bottom');
    for (const t of tops) {
      for (const bt of bottoms) {
        assert.ok(bt.trunk, `${who}/${state}: ${bt.piece} worn under a top has no waistband`);
        const overlap = bt.trunk[1] - t.trunk[0];
        assert.ok(overlap >= TUCK_OVERLAP - EPS,
          `${who}/${state}: ${t.piece} hem ${t.trunk[0]}h overlaps ${bt.piece} waist ${bt.trunk[1]}h by only ${overlap.toFixed(4)}h`);
      }
    }
  }
});

test('overlapping trunk layers nest instead of z-fighting', () => {
  // every trunk band is the same body sample pushed out by `clear`, with its inner
  // surface at clear − thick; two bands that share heights must not share radii
  for (const { who, state, L } of everyOutfit()) {
    const trunk = L.filter((l) => l.trunk);
    for (let i = 0; i < trunk.length; i++) {
      for (let k = i + 1; k < trunk.length; k++) {
        const a = trunk[i], b = trunk[k];
        const lo = Math.max(a.trunk[0], b.trunk[0]), hi = Math.min(a.trunk[1], b.trunk[1]);
        if (hi <= lo) continue;
        const [under, over] = a.clear <= b.clear ? [a, b] : [b, a];
        assert.ok(over.clear - over.thick > under.clear + EPS,
          `${who}/${state}: ${over.piece} (inner ${(over.clear - over.thick).toFixed(4)}h) cuts into ` +
          `${under.piece} (outer ${under.clear.toFixed(4)}h) between ${lo}h and ${hi}h`);
      }
    }
  }
});

test('a bottom\'s leg tubes run all the way up the body\'s own thigh', () => {
  // the thighs flare well past the pelvis (hipW is the joint span), so at the
  // outer hip the silhouette IS the top of the leg tube, which the body starts at
  // LEG_STATIONS[0] = 0.590h. The first R9 pass tucked the waist and still showed
  // skin there: garment legs began at the 0.552h station, the waistband is only
  // as wide as the pelvis, and the body's thigh top stood bare between them.
  for (const persona of [lola, aria, kai]) {
    const b = persona.body, h = b.height;
    const rig = buildSkeleton(b);
    const rings = trunkRings(b);
    for (const [state, recipe] of Object.entries(OUTFITS[persona.id])) {
      const L = outfitLayout(recipe);
      buildOutfit(persona, rig, recipe).forEach((m, i) => {
        // under a one-piece the skirt covers the thigh top (and a leg tube
        // reaching it would share the skirt's surface)
        if (L[i].role !== 'bottom' || L.some((l) => l.role === 'onepiece')) return;
        const pos = m.geometry.getAttribute('position');
        let top = -Infinity;
        for (let v = 0; v < pos.count; v++) {
          const y = pos.getY(v);
          // outside the widest the waistband gets → a leg-tube vertex
          if (Math.abs(pos.getX(v)) > sampleTrunk(rings, y).rx + 3 * L[i].clear * h) top = Math.max(top, y);
        }
        assert.ok(top >= THIGH_TOP * h,
          `${persona.id}/${state}: ${L[i].piece} legs stop at ${(top / h).toFixed(4)}h, the body's thigh starts at ${THIGH_TOP}h`);
      });
    }
  }
});

test('the built geometry matches the layout it was swept from', () => {
  // outfitLayout is only worth testing if the meshes actually use it
  for (const persona of [lola, aria, kai]) {
    const h = persona.body.height;
    const rig = buildSkeleton(persona.body);
    for (const [state, recipe] of Object.entries(OUTFITS[persona.id])) {
      const L = outfitLayout(recipe);
      const meshes = buildOutfit(persona, rig, recipe);
      meshes.forEach((m, i) => {
        const l = L[i];
        if (l.role !== 'top') return;
        const pos = m.geometry.getAttribute('position');
        let minY = Infinity;
        for (let v = 0; v < pos.count; v++) minY = Math.min(minY, pos.getY(v));
        assert.ok(Math.abs(minY / h - l.trunk[0]) < 1e-4,
          `${persona.id}/${state}: top hem built at ${(minY / h).toFixed(4)}h, layout says ${l.trunk[0]}h`);
      });
    }
  }
});
