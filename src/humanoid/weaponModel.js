// @ts-check
// Procedural weapon meshes attached to a character's right hand bone. Small,
// low-poly, dark metal with a cyan emissive muzzle. The `muzzle`-named child
// marks the barrel tip (world position usable for tracer origins).
import * as THREE from 'three';

function mats() {
  return {
    metal: new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.5, metalness: 0.75 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.8, metalness: 0.2 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x39e6ff, emissiveIntensity: 0.7 }),
  };
}

/**
 * @param {string} key  'sidearm' | 'smg' | 'pipe' | 'shiv' | 'fists'
 * @returns {THREE.Group}  weapon in hand-local space (barrel toward +Z)
 */
export function buildWeapon(key) {
  const g = new THREE.Group();
  g.name = `weapon_${key}`;
  const m = mats();
  const box = (w, h, d, mat, x, y, z) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, y, z); b.castShadow = true; return b;
  };

  if (key === 'sidearm') {
    const grip = box(0.032, 0.088, 0.045, m.grip, 0, -0.042, -0.005); grip.rotation.x = 0.22; g.add(grip);
    g.add(box(0.034, 0.042, 0.15, m.metal, 0, 0.012, 0.06));       // slide/barrel
    const mz = box(0.02, 0.02, 0.012, m.glow, 0, 0.012, 0.135); mz.name = 'muzzle'; g.add(mz);
  } else if (key === 'smg') {
    g.add(box(0.04, 0.05, 0.24, m.metal, 0, 0.012, 0.08));         // receiver
    const grip = box(0.03, 0.088, 0.045, m.grip, 0, -0.04, 0.01); grip.rotation.x = 0.18; g.add(grip);
    g.add(box(0.026, 0.08, 0.03, m.grip, 0, -0.05, 0.07));         // magazine
    const mz = box(0.02, 0.02, 0.012, m.glow, 0, 0.012, 0.205); mz.name = 'muzzle'; g.add(mz);
  } else if (key === 'pipe') {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.4, 8), m.metal);
    p.rotation.x = Math.PI / 2; p.position.z = 0.12; p.castShadow = true; g.add(p);
  } else if (key === 'shiv') {
    g.add(box(0.012, 0.007, 0.11, m.metal, 0, 0, 0.07));           // blade
    g.add(box(0.02, 0.02, 0.04, m.grip, 0, 0, 0.01));              // handle
  }
  // 'fists' → empty group
  return g;
}
