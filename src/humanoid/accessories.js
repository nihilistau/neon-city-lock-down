// @ts-check
// Silhouette extras parented to bones: shoes, holster, earrings, glasses, hostile kit.
//
// EVERYTHING WORN ON THE HEAD IS DERIVED, NOT TUNED.
// These offsets used to be hand-picked fractions of body height, chosen by eye
// against a head whose shape is defined somewhere else entirely — so they drifted
// as the face and skull were rebuilt. Measured against the real geometry, Kai's
// glasses sat 0.037h below his eyes (6.5cm) and 2.5x too far apart, and Aria's
// earrings sat 0.029h below and 0.026h in front of her ears, i.e. floating beside
// the jaw. Both now come from the SAME sources the face and hair use — face.js
// owns the eye positions, bodyBuilder owns the skull ellipsoid — so a change to
// either moves the accessories with it instead of silently stranding them.
import * as THREE from 'three';
import { eyeBallCentre, FACE_PATCH } from './face.js';
import { SCALP } from './bodyBuilder.js';

/** Head bone origin, in fractions of body height. Mirrors skeleton.js `j.head`. */
const HEAD_BONE = { y: 0.908, z: 0.01 };

/** Eyeball centre in the HEAD BONE's local frame, in height fractions. */
function eyeLocal(side) {
  const e = eyeBallCentre(side);
  return { x: e.x, y: e.y - HEAD_BONE.y, z: e.z - HEAD_BONE.z };
}

/**
 * A point on the skull surface, in the head bone's local frame.
 * @param {number} dy height above the skull's centre, in height fractions
 * @param {number} dz depth from the skull's centre (negative = behind)
 */
function scalpSide(dy, dz) {
  const ry = dy / SCALP.ay, rz = dz / SCALP.az;
  const rem = Math.max(0, 1 - ry * ry - rz * rz);
  return {
    x: SCALP.ax * Math.sqrt(rem),
    y: SCALP.cy + dy - HEAD_BONE.y,
    z: SCALP.cz + dz - HEAD_BONE.z,
  };
}

function mat(color, extras = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, ...extras });
}

function add(bone, mesh) {
  if (!bone) return;
  bone.add(mesh);
}

/** @param {import('./actor3d.js').Actor3D} actor @param {any} persona */
export function attachAccessories(actor, persona) {
  const bones = actor.rig?.byName || {};
  const h = persona.body?.height || 1.7;
  addShoes(bones, h, persona);
  const id = persona.id || '';
  if (id === 'lola' || persona.kit === 'holster') addHolster(bones, h);
  if (id === 'aria' || persona.kit === 'earrings') addEarrings(bones, h);
  if (id === 'kai' || persona.kit === 'glasses') addGlasses(bones, h);
  if (persona.kit === 'hoodie') addHoodie(bones, h);
  if (persona.kit === 'visor') addVisor(bones, h);
  if (persona.kit === 'backpack') addBackpack(bones, h);
}

function addShoes(bones, h, persona) {
  const col = persona.colors?.hair ? 0x111318 : 0x1a1420;
  for (const side of ['L', 'R']) {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.085 * h, 0.045 * h, 0.16 * h), mat(col, { roughness: 0.4 }));
    shoe.position.set(0, -0.02 * h, 0.03 * h);
    add(bones['foot' + side], shoe);
  }
}

function addHolster(bones, h) {
  const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.07 * h, 0.11 * h, 0.04 * h), mat(0x1a1218, { roughness: 0.7 }));
  pouch.position.set(0.12 * h, 0.02 * h, 0.02 * h);
  add(bones.hips, pouch);
}

function addEarrings(bones, h) {
  const g = new THREE.SphereGeometry(0.008 * h, 8, 8);
  const m = mat(0xc9a6e8, { metalness: 0.7, roughness: 0.25, emissive: 0x4a2a6a, emissiveIntensity: 0.4 });
  // the lobe: a little below and behind the skull's centre, ON its surface
  const ear = scalpSide(-0.012, -0.010);
  for (const side of [-1, 1]) {
    const e = new THREE.Mesh(g, m);
    e.position.set(side * ear.x * h, ear.y * h, ear.z * h);
    add(bones.head, e);
  }
}

function addGlasses(bones, h) {
  const m = mat(0x111, { metalness: 0.8, roughness: 0.2 });
  const L = eyeLocal('L'), R = eyeLocal('R');
  // lens plane sits just clear of the face patch, not at the eyeball centre
  const lensZ = (L.z + R.z) / 2 + FACE_PATCH.eyeInset + 0.006;
  const y = (L.y + R.y) / 2;
  // rim radius from the eye separation so the lenses frame the eyes they cover
  const halfSpan = Math.abs(L.x - R.x) / 2;
  const rimR = Math.max(0.016, halfSpan * 0.95);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(rimR * h, 0.003 * h, 6, 14), m);
  const rim2 = rim.clone();
  rim.position.set(L.x * h, y * h, lensZ * h);
  rim2.position.set(R.x * h, y * h, lensZ * h);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 * h, 0.003 * h, 0.003 * h), m);
  bridge.position.set(0, y * h, lensZ * h);
  add(bones.head, rim);
  add(bones.head, rim2);
  add(bones.head, bridge);
}

function addHoodie(bones, h) {
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.09 * h, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    mat(0x1a2430, { roughness: 0.85, side: THREE.DoubleSide }));
  hood.position.set(0, (SCALP.cy - HEAD_BONE.y) * h, (SCALP.cz - HEAD_BONE.z) * h);
  add(bones.head, hood);
}

function addVisor(bones, h) {
  const vis = new THREE.Mesh(new THREE.BoxGeometry(0.14 * h, 0.04 * h, 0.02 * h),
    mat(0x39e6ff, { metalness: 0.6, roughness: 0.15, emissive: 0x39e6ff, emissiveIntensity: 0.7 }));
  const eye = eyeLocal('L');
  vis.position.set(0, eye.y * h, (eye.z + FACE_PATCH.eyeInset + 0.008) * h);
  add(bones.head, vis);
}

function addBackpack(bones, h) {
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.16 * h, 0.22 * h, 0.1 * h), mat(0x2a2418, { roughness: 0.8 }));
  pack.position.set(0, 0.08 * h, -0.12 * h);
  add(bones.chest, pack);
}
