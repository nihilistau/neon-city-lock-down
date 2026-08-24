// @ts-check
// The floor-height contract from src/scene3d/tower/zoneBuilder.js `_slab()`:
// actors are pinned to y = 0 (Actor3D.snapTo) and there is NO step-up logic
// anywhere, so the walkable TOP of every slab must be at 0 — a raised finish
// buries the cast by the difference (v0.4 shipped fl27 +0.08, ground +0.04 and
// the fl40 dais +0.14, past the ankle), and a sunken one leaves them hovering.
//
// This builds every floor for real. three.js geometry needs no WebGL — only a
// canvas for the procedural textures, which jsdom + a recording 2D context
// supplies. No renderer is created, so nothing here needs a GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { FLOORS } from '../../data/zones.js';

/** a 2D context that answers every call texGen makes, without a real canvas */
function fakeCtx(canvas) {
  const image = (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
  return {
    canvas, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '',
    textAlign: '', textBaseline: '', lineCap: '', lineJoin: '', shadowBlur: 0, shadowColor: '',
    fillRect() {}, strokeRect() {}, clearRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, ellipse() {}, rect() {},
    bezierCurveTo() {}, quadraticCurveTo() {}, save() {}, restore() {},
    translate() {}, rotate() {}, scale() {}, clip() {}, setTransform() {},
    drawImage() {}, fillText() {}, strokeText() {},
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    getImageData: (x, y, w, h) => image(w, h),
    createImageData: (w, h) => image(w, h),
    putImageData() {},
  };
}

/** build the whole tower once, recording every slab the builder lays */
async function buildTower() {
  const dom = new JSDOM('<!doctype html><body></body>');
  const g = /** @type {any} */ (globalThis);
  g.window = dom.window;
  g.document = dom.window.document;
  g.HTMLElement = dom.window.HTMLElement;
  g.Image = dom.window.Image;
  dom.window.HTMLCanvasElement.prototype.getContext = function () { return /** @type {any} */ (fakeCtx(this)); };

  const { World3D } = await import('../../src/scene3d/tower/zoneBuilder.js');

  /** @type {{floor:string, top:number, y:number, height:number, area:number}[]} */
  const slabs = [];
  const realSlab = World3D.prototype._slab;
  World3D.prototype._slab = function (group, rect, tex, y) {
    const mesh = realSlab.call(this, group, rect, tex, y);
    const height = mesh.geometry.parameters.height;
    slabs.push({
      floor: group.name.replace(/^floor_/, ''),
      y: mesh.position.y,
      height,
      top: mesh.position.y + height / 2,
      area: (rect.x[1] - rect.x[0]) * (rect.z[1] - rect.z[0]),
    });
    return mesh;
  };

  const stage = { scene: new THREE.Scene() };
  const rng = { next: () => 0.5, chance: () => false, int: (a) => a, pick: (a) => a[0], range: (a) => a };
  try {
    const world = new World3D(/** @type {any} */ (stage), /** @type {any} */ (rng));
    return { world, slabs, World3D };
  } finally {
    World3D.prototype._slab = realSlab;
  }
}

const built = await buildTower();

test('every floor in the tower is actually built', () => {
  assert.deepEqual(Object.keys(built.world.floorGroups).sort(), Object.keys(FLOORS).sort());
  for (const id of Object.keys(FLOORS)) {
    assert.ok(built.slabs.some((s) => s.floor === id), `${id} has no floor slab at all`);
  }
  assert.ok(built.slabs.length >= Object.keys(FLOORS).length);
});

test('no slab top rises above y=0 — the cast would be buried to that depth', () => {
  for (const s of built.slabs) {
    assert.ok(s.top <= 1e-9,
      `${s.floor}: a slab top at ${s.top.toFixed(3)} buries every actor by ${(s.top * 100).toFixed(1)}cm`);
  }
});

test('no slab top sinks more than the 2cm base offset — the cast would hover', () => {
  // _roomShell lays its base at -0.12 (top -0.02) deliberately, so a floor's own
  // finish layer can sit flush at 0 without z-fighting. Anything lower than that
  // is a hole the actors stand over.
  for (const s of built.slabs) {
    assert.ok(s.top >= -0.02 - 1e-9,
      `${s.floor}: a slab top at ${s.top.toFixed(3)} leaves actors floating ${(-s.top * 100).toFixed(1)}cm up`);
  }
});

test('the walkable surface of each floor is within a step of y=0', () => {
  for (const id of Object.keys(FLOORS)) {
    const mine = built.slabs.filter((s) => s.floor === id);
    // the widest slab on a floor is the one the cast actually walks on
    const walkable = mine.reduce((a, b) => (b.area > a.area ? b : a));
    assert.ok(Math.abs(walkable.top) <= 0.02 + 1e-9,
      `${id}: the main surface sits at ${walkable.top.toFixed(3)}, not flush with y=0`);
    assert.equal(walkable.height, 0.2, `${id}: slabs are 0.2 thick by contract`);
  }
});

test('the default slab y IS the contract, and a raised one really would break it', () => {
  // Measure the builder directly, so the tests above are known to be measuring
  // the mesh rather than a constant: the default lays a top at exactly 0, and
  // the v0.4-style raised finish (y = -0.02) lays one 8cm into everybody's shins.
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial();
  const rect = { x: [-5, 5], z: [-5, 5] };
  const slab = built.World3D.prototype._slab.call({}, group, rect, mat);
  const top = (m) => m.position.y + m.geometry.parameters.height / 2;
  assert.equal(top(slab), 0, 'the default slab must put its walkable top at exactly y=0');
  assert.equal(slab.geometry.parameters.width, 10);
  assert.equal(slab.geometry.parameters.depth, 10);
  assert.equal(slab.receiveShadow, true);
  assert.ok(group.children.includes(slab), 'the slab is added to the floor group');

  const raised = built.World3D.prototype._slab.call({}, group, rect, mat, -0.02);
  assert.ok(top(raised) > 0, 'a raised finish must be detectable as above y=0');
  assert.ok(Math.abs(top(raised) - 0.08) < 1e-9, 'and by exactly how much: 8cm');
});
