// @ts-check
// Silhouette extras parented to bones: shoes, holster, earrings, glasses, hostile kit.
import * as THREE from 'three';

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
  for (const x of [-1, 1]) {
    const e = new THREE.Mesh(g, m);
    e.position.set(x * 0.072 * h, 0.01 * h, 0.01 * h);
    add(bones.head, e);
  }
}

function addGlasses(bones, h) {
  const m = mat(0x111, { metalness: 0.8, roughness: 0.2 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.022 * h, 0.003 * h, 6, 12), m);
  const rim2 = rim.clone();
  rim.position.set(-0.028 * h, 0.02 * h, 0.068 * h);
  rim2.position.set(0.028 * h, 0.02 * h, 0.068 * h);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.02 * h, 0.003 * h, 0.003 * h), m);
  bridge.position.set(0, 0.02 * h, 0.068 * h);
  add(bones.head, rim);
  add(bones.head, rim2);
  add(bones.head, bridge);
}

function addHoodie(bones, h) {
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.09 * h, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    mat(0x1a2430, { roughness: 0.85, side: THREE.DoubleSide }));
  hood.position.set(0, 0.02 * h, -0.01 * h);
  add(bones.head, hood);
}

function addVisor(bones, h) {
  const vis = new THREE.Mesh(new THREE.BoxGeometry(0.14 * h, 0.04 * h, 0.02 * h),
    mat(0x39e6ff, { metalness: 0.6, roughness: 0.15, emissive: 0x39e6ff, emissiveIntensity: 0.7 }));
  vis.position.set(0, 0.03 * h, 0.07 * h);
  add(bones.head, vis);
}

function addBackpack(bones, h) {
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.16 * h, 0.22 * h, 0.1 * h), mat(0x2a2418, { roughness: 0.8 }));
  pack.position.set(0, 0.08 * h, -0.12 * h);
  add(bones.chest, pack);
}
