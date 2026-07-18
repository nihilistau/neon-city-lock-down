// @ts-check
// Programmatic humanoid skeleton. Bind pose = A-pose, identity bone rotations,
// so every bone's local axes are world-aligned at bind — pose data stays intuitive
// (rotation.x tips forward, .y twists, .z tilts sideways for every bone).
import * as THREE from 'three';

/** Bone name → index. Order matters: parents precede children. */
export const BONES = [
  'root', 'hips', 'spine1', 'spine2', 'chest', 'neck', 'head', 'jaw',
  'eyeL', 'eyeR', 'breastL', 'breastR',
  'clavL', 'clavR', 'armL', 'armR', 'foreL', 'foreR', 'handL', 'handR',
  'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR', 'toeL', 'toeR',
  'hair1', 'hair2', 'hair3',
];
/** @type {Record<string, number>} */
export const BONE_INDEX = Object.fromEntries(BONES.map((n, i) => [n, i]));

const PARENTS = {
  root: null, hips: 'root', spine1: 'hips', spine2: 'spine1', chest: 'spine2',
  neck: 'chest', head: 'neck', jaw: 'head', eyeL: 'head', eyeR: 'head',
  breastL: 'chest', breastR: 'chest',
  clavL: 'chest', clavR: 'chest', armL: 'clavL', armR: 'clavR',
  foreL: 'armL', foreR: 'armR', handL: 'foreL', handR: 'foreR',
  thighL: 'hips', thighR: 'hips', shinL: 'thighL', shinR: 'thighR',
  footL: 'shinL', footR: 'shinR', toeL: 'footL', toeR: 'footR',
  hair1: 'head', hair2: 'hair1', hair3: 'hair2',
};

/**
 * @typedef {Object} BodyParams
 * @property {number} height    total height in meters
 * @property {number} shoulderW shoulder joint span
 * @property {number} hipW      hip joint span
 * @property {number} bust      breast scale, 0 = flat
 * @property {number} waist     waist radius scale
 * @property {number} hips      hip/glute flare scale
 * @property {number} build     limb girth scale
 */

/** A-pose arm angle from vertical. */
export const ARM_ANGLE = THREE.MathUtils.degToRad(42);

/**
 * Compute bind-pose joint positions (world space) from proportions.
 * @param {BodyParams} b
 */
export function computeJoints(b) {
  const h = b.height;
  const sx = b.shoulderW / 2;
  const hx = b.hipW / 2;
  const upperArmLen = 0.162 * h, forearmLen = 0.148 * h, handLen = 0.10 * h;
  const armDir = new THREE.Vector3(Math.sin(ARM_ANGLE), -Math.cos(ARM_ANGLE), 0);

  const shoulderL = new THREE.Vector3(sx, 0.833 * h, 0);
  const elbowL = shoulderL.clone().addScaledVector(armDir, upperArmLen);
  const wristL = elbowL.clone().addScaledVector(armDir, forearmLen);
  const fingerL = wristL.clone().addScaledVector(armDir, handLen);

  /** @type {Record<string, THREE.Vector3>} */
  const j = {
    root: new THREE.Vector3(0, 0, 0),
    hips: new THREE.Vector3(0, 0.578 * h, 0),
    spine1: new THREE.Vector3(0, 0.638 * h, 0),
    spine2: new THREE.Vector3(0, 0.706 * h, 0),
    chest: new THREE.Vector3(0, 0.768 * h, 0),
    neck: new THREE.Vector3(0, 0.862 * h, 0),
    head: new THREE.Vector3(0, 0.908 * h, 0.01 * h),
    jaw: new THREE.Vector3(0, 0.916 * h, 0.02 * h),
    eyeL: new THREE.Vector3(0.0195 * h, 0.948 * h, 0.048 * h),
    eyeR: new THREE.Vector3(-0.0195 * h, 0.948 * h, 0.048 * h),
    breastL: new THREE.Vector3(0.040 * h, 0.782 * h, 0.052 * h),
    breastR: new THREE.Vector3(-0.040 * h, 0.782 * h, 0.052 * h),
    clavL: new THREE.Vector3(0.02 * h, 0.828 * h, 0),
    clavR: new THREE.Vector3(-0.02 * h, 0.828 * h, 0),
    armL: shoulderL,
    armR: new THREE.Vector3(-shoulderL.x, shoulderL.y, 0),
    foreL: elbowL,
    foreR: new THREE.Vector3(-elbowL.x, elbowL.y, elbowL.z),
    handL: wristL,
    handR: new THREE.Vector3(-wristL.x, wristL.y, wristL.z),
    fingerL, // not a bone — used by builders for hand extents
    fingerR: new THREE.Vector3(-fingerL.x, fingerL.y, fingerL.z),
    thighL: new THREE.Vector3(hx, 0.552 * h, 0),
    thighR: new THREE.Vector3(-hx, 0.552 * h, 0),
    shinL: new THREE.Vector3(hx * 1.05, 0.300 * h, 0.004 * h),
    shinR: new THREE.Vector3(-hx * 1.05, 0.300 * h, 0.004 * h),
    footL: new THREE.Vector3(hx * 1.1, 0.052 * h, -0.01 * h),
    footR: new THREE.Vector3(-hx * 1.1, 0.052 * h, -0.01 * h),
    toeL: new THREE.Vector3(hx * 1.1, 0.018 * h, 0.075 * h),
    toeR: new THREE.Vector3(-hx * 1.1, 0.018 * h, 0.075 * h),
    hair1: new THREE.Vector3(0, 0.94 * h, -0.045 * h),
    hair2: new THREE.Vector3(0, 0.86 * h, -0.062 * h),
    hair3: new THREE.Vector3(0, 0.78 * h, -0.058 * h),
  };
  return j;
}

/**
 * Build the THREE skeleton.
 * @param {BodyParams} body
 * @returns {{ bones: THREE.Bone[], byName: Record<string, THREE.Bone>,
 *             skeleton: THREE.Skeleton, joints: Record<string, THREE.Vector3> }}
 */
export function buildSkeleton(body) {
  const joints = computeJoints(body);
  /** @type {THREE.Bone[]} */
  const bones = [];
  /** @type {Record<string, THREE.Bone>} */
  const byName = {};

  for (const name of BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    const parentName = PARENTS[name];
    const world = joints[name];
    if (parentName) {
      const parentWorld = joints[parentName];
      bone.position.copy(world).sub(parentWorld);
      byName[parentName].add(bone);
    } else {
      bone.position.copy(world);
    }
    bones.push(bone);
    byName[name] = bone;
  }

  // Compute bind-pose bone world matrices NOW (root bone is unparented, so its
  // subtree resolves to the pure bind pose), then build the skeleton so its
  // boneInverses are the correct BIND-POSE inverses. Every SkinnedMesh then binds
  // with an explicit identity bindMatrix (see body/outfit builders) so
  // Skeleton.calculateInverses() is NEVER re-run on the live, posed skeleton —
  // that re-run was corrupting every mesh's skinning on a clothes change.
  bones[0].updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  return { bones, byName, skeleton, joints };
}
