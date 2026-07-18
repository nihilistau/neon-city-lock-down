// @ts-check
// Outfit layers: separate skinned meshes bound to the character's skeleton,
// toggled per outfit state. Recipes are parametric primitives skinned with the
// same chain logic as the body, sized slightly proud of the skin.
import * as THREE from 'three';
import { mergeGeometries, chainSkin, rigidSkin, latheGeo, limbGeo } from '../util/geo.js';
import { BONE_INDEX } from './skeleton.js';

/**
 * Piece generators. Each returns bind-pose geometry with skinning attributes.
 * @type {Record<string, (b:any, j:any, opts:any) => THREE.BufferGeometry>}
 */
const PIECES = {
  /** fitted top: chest→waist cover */
  top(b, j, opts) {
    const h = b.height;
    const geo = latheGeo([
      [0.615 * h, 0.080 * h * b.waist],
      [0.672 * h, 0.081 * h],
      [0.730 * h, 0.092 * h],
      [0.790 * h, 0.101 * h * (0.92 + 0.22 * b.bust)],
      [0.826 * h, 0.064 * h],
    ], 0.84, 16);
    chainSkin(geo, [
      { bone: BONE_INDEX.spine1, from: 0.60 * h, to: 0.70 * h },
      { bone: BONE_INDEX.spine2, from: 0.70 * h, to: 0.762 * h },
      { bone: BONE_INDEX.chest, from: 0.762 * h, to: 0.85 * h },
    ], 0.03 * h);
    return geo;
  },
  /** dress: chest → above knee, flared */
  dress(b, j, opts) {
    const h = b.height;
    const hem = opts.hem ?? 0.36; // fraction of height
    const geo = latheGeo([
      [hem * h, 0.135 * h * b.hips],
      [0.50 * h, 0.115 * h * b.hips],
      [0.578 * h, 0.100 * h * b.hips],
      [0.625 * h, 0.080 * h * b.waist],
      [0.672 * h, 0.081 * h],
      [0.730 * h, 0.092 * h],
      [0.790 * h, 0.101 * h * (0.92 + 0.22 * b.bust)],
      [0.822 * h, 0.062 * h],
    ], 0.84, 18);
    chainSkin(geo, [
      { bone: BONE_INDEX.hips, from: hem * h - 0.05, to: 0.635 * h },
      { bone: BONE_INDEX.spine1, from: 0.635 * h, to: 0.70 * h },
      { bone: BONE_INDEX.spine2, from: 0.70 * h, to: 0.762 * h },
      { bone: BONE_INDEX.chest, from: 0.762 * h, to: 0.85 * h },
    ], 0.03 * h);
    return geo;
  },
  /** shorts: hips → upper thigh */
  shorts(b, j) {
    const h = b.height;
    const parts = [];
    const waist = latheGeo([
      [0.50 * h, 0.108 * h * b.hips],
      [0.545 * h, 0.103 * h * b.hips],
      [0.578 * h, 0.098 * h * b.hips],
      [0.61 * h, 0.082 * h * b.waist],
    ], 0.78, 14);
    chainSkin(waist, [{ bone: BONE_INDEX.hips, from: 0.46 * h, to: 0.63 * h }], 0.03 * h);
    parts.push(waist);
    for (const side of ['L', 'R']) {
      const hip = j['thigh' + side];
      const knee = j['shin' + side];
      const dir = knee.clone().sub(hip).normalize();
      const end = hip.clone().addScaledVector(dir, 0.10 * h);
      const leg = limbGeo(hip, end, 0.062 * h, 0.058 * h, 10);
      rigidSkin(leg, BONE_INDEX['thigh' + side]);
      parts.push(leg);
    }
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  },
  /** open jacket shell over the torso + upper arms */
  jacket(b, j) {
    const h = b.height;
    const parts = [];
    const shell = latheGeo([
      [0.60 * h, 0.098 * h * b.waist],
      [0.70 * h, 0.104 * h],
      [0.79 * h, 0.112 * h * (0.95 + 0.2 * b.bust)],
      [0.83 * h, 0.075 * h],
    ], 0.86, 16);
    chainSkin(shell, [
      { bone: BONE_INDEX.spine1, from: 0.58 * h, to: 0.70 * h },
      { bone: BONE_INDEX.spine2, from: 0.70 * h, to: 0.762 * h },
      { bone: BONE_INDEX.chest, from: 0.762 * h, to: 0.86 * h },
    ], 0.03 * h);
    parts.push(shell);
    // sleeves: upper arm cover
    const { ARM_ANGLE } = { ARM_ANGLE: Math.PI / 180 * 42 };
    for (const side of ['L', 'R']) {
      const sh = j['arm' + side], el = j['fore' + side];
      const dir = el.clone().sub(sh).normalize();
      const end = sh.clone().addScaledVector(dir, 0.75 * el.clone().sub(sh).length());
      const sleeve = limbGeo(sh, end, 0.045 * h * b.build, 0.038 * h * b.build, 8);
      rigidSkin(sleeve, BONE_INDEX['arm' + side]);
      parts.push(sleeve);
    }
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  },

  /** loose robe: shoulders → mid-thigh, draped */
  robe(b, j) {
    const h = b.height;
    const geo = latheGeo([
      [0.42 * h, 0.135 * h * b.hips],
      [0.52 * h, 0.120 * h],
      [0.60 * h, 0.108 * h],
      [0.70 * h, 0.112 * h],
      [0.79 * h, 0.118 * h * (0.95 + 0.2 * b.bust)],
      [0.84 * h, 0.085 * h],
      [0.86 * h, 0.05 * h],
    ], 0.88, 16);
    chainSkin(geo, [
      { bone: BONE_INDEX.hips, from: 0.40 * h, to: 0.635 * h },
      { bone: BONE_INDEX.spine1, from: 0.635 * h, to: 0.70 * h },
      { bone: BONE_INDEX.spine2, from: 0.70 * h, to: 0.762 * h },
      { bone: BONE_INDEX.chest, from: 0.762 * h, to: 0.87 * h },
    ], 0.035 * h);
    return geo;
  },

  /** towel wrap: chest → mid-thigh, snug */
  towel(b, j) {
    const h = b.height;
    const geo = latheGeo([
      [0.46 * h, 0.108 * h * b.hips],
      [0.55 * h, 0.100 * h * b.hips],
      [0.63 * h, 0.088 * h * b.waist],
      [0.72 * h, 0.092 * h],
      [0.785 * h, 0.100 * h * (0.95 + 0.2 * b.bust)],
      [0.805 * h, 0.07 * h],
    ], 0.82, 14);
    chainSkin(geo, [
      { bone: BONE_INDEX.hips, from: 0.44 * h, to: 0.635 * h },
      { bone: BONE_INDEX.spine1, from: 0.635 * h, to: 0.70 * h },
      { bone: BONE_INDEX.spine2, from: 0.70 * h, to: 0.762 * h },
      { bone: BONE_INDEX.chest, from: 0.762 * h, to: 0.81 * h },
    ], 0.03 * h);
    return geo;
  },

  /** thigh-high leggings */
  leggings(b, j) {
    const h = b.height;
    const parts = [];
    for (const side of ['L', 'R']) {
      const hip = j['thigh' + side], knee = j['shin' + side], ankle = j['foot' + side];
      const thighLen = knee.clone().sub(hip).length();
      const fullLen = ankle.clone().sub(hip).length();
      const legDir = ankle.clone().sub(hip).normalize();
      const leg = limbGeo(hip, ankle, 0.064 * h * b.build, 0.027 * h, 10);
      const along = (x, y, z) => new THREE.Vector3(x, y, z).sub(hip).dot(legDir);
      chainSkin(leg, [
        { bone: BONE_INDEX['thigh' + side], from: -0.05, to: thighLen },
        { bone: BONE_INDEX['shin' + side], from: thighLen, to: fullLen + 0.02 },
      ], 0.035 * h, along);
      parts.push(leg);
    }
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  },
};

/**
 * Build one outfit layer set for a persona.
 * @param {any} persona
 * @param {{skeleton:THREE.Skeleton, joints:any}} rig
 * @param {{pieces: {piece:string, color:string, metalness?:number, roughness?:number, opts?:any}[]}} recipe
 * @returns {THREE.SkinnedMesh[]}
 */
export function buildOutfit(persona, rig, recipe) {
  const meshes = [];
  for (const p of recipe.pieces) {
    const gen = PIECES[p.piece];
    if (!gen) throw new Error(`unknown outfit piece: ${p.piece}`);
    const geo = gen(persona.body, rig.joints, p.opts || {});
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(p.color),
      roughness: p.roughness ?? 0.75,
      metalness: p.metalness ?? 0.05,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.castShadow = true;
    mesh.bind(rig.skeleton);
    mesh.frustumCulled = false;
    meshes.push(mesh);
  }
  return meshes;
}
