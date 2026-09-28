// @ts-check
// src/scene3d/envMath.js — the pure half of the beta.1 environment work.
// The env crossfade is the one that matters most: PMREM maps cannot be blended,
// so a lighting preset change used to hard-cut every reflection in the room in
// one frame. Dipping environmentIntensity to 0 and swapping at the bottom hides
// the cut — but only if the swap really happens at the bottom and the
// intensity really comes back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dipAndSwap, retargetDip, softKnee, windowOffsets, rainLayout, rainCount, RAIN_BASE, RAIN_MAX } from '../../src/scene3d/envMath.js';

const seq = (vals) => { let i = 0; return { next: () => vals[i++ % vals.length] }; };

test('dipAndSwap: full at the ends, zero at the bottom, swap exactly in the second half', () => {
  assert.deepEqual(dipAndSwap(0, 0.6), { k: 1, swap: false, done: false });
  const bottom = dipAndSwap(0.3, 0.6);
  assert.ok(Math.abs(bottom.k) < 1e-9);
  assert.equal(bottom.swap, true);
  assert.equal(dipAndSwap(0.2999, 0.6).swap, false);
  assert.deepEqual(dipAndSwap(0.6, 0.6), { k: 1, swap: true, done: true });
  assert.deepEqual(dipAndSwap(5, 0.6), { k: 1, swap: true, done: true });
});

test('dipAndSwap: down monotonically, then up monotonically', () => {
  let prev = 1;
  for (let t = 0; t <= 0.3; t += 0.01) { const { k } = dipAndSwap(t, 0.6); assert.ok(k <= prev + 1e-12); prev = k; }
  prev = 0;
  for (let t = 0.3; t < 0.6; t += 0.01) { const { k } = dipAndSwap(t, 0.6); assert.ok(k >= prev - 1e-12); prev = k; }
});

test('dipAndSwap: a zero duration is an immediate swap', () => {
  assert.deepEqual(dipAndSwap(0, 0), { k: 1, swap: true, done: true });
});

test('windowOffsets: one xy per tower, on the window grid, deterministic', () => {
  const a = windowOffsets(80, seq([0.01, 0.2, 0.51, 0.99]));
  assert.equal(a.length, 160);
  for (const v of a) {
    assert.ok(v >= 0 && v < 1);
    assert.equal(v * 8, Math.round(v * 8), 'snapped to 1/8 so window columns stay aligned');
  }
  assert.deepEqual([...windowOffsets(4, seq([0.3, 0.7]))], [...windowOffsets(4, seq([0.3, 0.7]))]);
});

test('rainLayout: every drop inside its volume', () => {
  const vol = { x: /** @type {[number,number]} */ ([-16, 30]), y: /** @type {[number,number]} */ ([0, 18]), z: /** @type {[number,number]} */ ([5, 40]) };
  const p = rainLayout(200, vol, seq([0, 0.25, 0.5, 0.75, 0.999]));
  assert.equal(p.length, 600);
  for (let i = 0; i < 200; i++) {
    assert.ok(p[i * 3] >= -16 && p[i * 3] < 30);
    assert.ok(p[i * 3 + 1] >= 0 && p[i * 3 + 1] < 18);
    assert.ok(p[i * 3 + 2] >= 5 && p[i * 3 + 2] < 40);
  }
});

test('rainCount scales with density and clamps', () => {
  assert.equal(rainCount(1), RAIN_BASE);
  assert.equal(rainCount(0.5), RAIN_BASE / 2);
  assert.equal(rainCount(0), 0);
  assert.equal(rainCount(-1), 0);
  assert.equal(rainCount(99), RAIN_MAX);
});

test('every lighting preset grades the IBL and the sky; a blackout darkens the sky', async () => {
  const { LIGHTING_PRESETS } = await import('../../data/lightingPresets.js');
  for (const [id, p] of Object.entries(LIGHTING_PRESETS)) {
    assert.ok(p.ibl, `${id} has no ibl block`);
    for (const k of ['envIntensity', 'rotation', 'skyTint', 'skyExposure']) assert.equal(typeof p.ibl[k], 'number', `${id}.ibl.${k}`);
  }
  assert.ok(LIGHTING_PRESETS.blackout_emergency.ibl.skyExposure < LIGHTING_PRESETS.neon_night.ibl.skyExposure);
});

test('retargetDip: a preset change mid-dip never pops the environment intensity', () => {
  const dur = 0.6;
  assert.deepEqual(retargetDip(null, 'a', dur), { t: 0, dur, id: 'a', swapped: false }, 'no dip: start one');
  // still going down: keep the time, just aim the swap at the new preset
  const down = retargetDip({ t: 0.1, dur, id: 'a', swapped: false }, 'b', dur);
  assert.deepEqual(down, { t: 0.1, dur, id: 'b', swapped: false });
  // already swapped and rising: mirror the time so it heads down again from the same k
  for (const t of [0.3, 0.35, 0.45, 0.59]) {
    const before = dipAndSwap(t, dur).k;
    const up = retargetDip({ t, dur, id: 'a', swapped: true }, 'b', dur);
    assert.equal(up.id, 'b');
    assert.equal(up.swapped, false, 'the new map still has to be swapped in');
    assert.ok(Math.abs(dipAndSwap(up.t, up.dur).k - before) < 1e-9, `k continuous at t=${t}`);
  }
});

test('softKnee: identity below the knee, smooth through it, never reaches the cap', () => {
  for (const p of [0, 0.3, 1]) assert.equal(softKnee(p, 1, 3), p);
  const e = 1e-4;
  const slope = (softKnee(1 + e, 1, 3) - softKnee(1, 1, 3)) / e;
  assert.ok(Math.abs(slope - 1) < 1e-3, 'slope 1 at the knee: no visible kink');
  let prev = 1;
  for (const p of [1.5, 2, 4, 20]) {
    const q = softKnee(p, 1, 3);
    assert.ok(q > prev && q < 3, `monotonic and under the cap at ${p}`);
    prev = q;
  }
  assert.ok(softKnee(20000, 1, 3) <= 3, 'a street-lamp core lands on the cap, not past it');
});

test('RainStreaks: one instanced draw, count from density, bounded by its volume', async () => {
  const { RainStreaks } = await import('../../src/scene3d/rain.js');
  const vol = { x: /** @type {[number,number]} */ ([-12, 12]), y: /** @type {[number,number]} */ ([0, 14]), z: /** @type {[number,number]} */ ([-10, 10]) };
  const rain = new RainStreaks(vol, seq([0.1, 0.5, 0.9]), { density: 1 });
  assert.equal(rain.mesh.geometry.isInstancedBufferGeometry, true);
  assert.equal(rain.mesh.geometry.instanceCount, RAIN_BASE);
  assert.equal(rain.mesh.geometry.getAttribute('offset').count, RAIN_MAX);
  rain.setDensity(0.5);
  assert.equal(rain.mesh.geometry.instanceCount, RAIN_BASE / 2);
  rain.setDensity(0);
  assert.equal(rain.mesh.visible, false);
  const THREE = await import('three');
  // the shader wraps every drop inside the volume, so a far corner must be inside the bound
  assert.ok(rain.mesh.geometry.boundingSphere.containsPoint(new THREE.Vector3(12, 14, 10)));
  assert.ok(rain.mesh.geometry.boundingSphere.containsPoint(new THREE.Vector3(-12, 0, -10)));
});

test('the tower builder no longer uses Math.random (rain was the last one)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../src/scene3d/tower/zoneBuilder.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Math\.random/);
});
