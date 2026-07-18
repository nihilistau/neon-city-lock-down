// @ts-check
// Parametric skinned body mesh. Only the body is vertex-skinned; head accessories
// (face decal, eyes, hair) attach as children of bones and ride for free.
import * as THREE from 'three';
import { mergeGeometries, rigidSkin, chainSkin, limbGeo, latheGeo, ballGeo, weldGeometry } from '../util/geo.js';
import { BONE_INDEX, ARM_ANGLE } from './skeleton.js';

/** Skin color + roughness maps: subtle tonal variation for a softer, less-plastic
 *  read. Returns { map, roughnessMap } sharing one canvas pair. */
function skinMaps(tone) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = tone;
  ctx.fillRect(0, 0, size, size);
  // large soft blotches of warmth/cool so the flat tone breaks up under light
  const base = new THREE.Color(tone);
  for (let i = 0; i < 24; i++) {
    const warm = Math.random() < 0.5;
    const col = base.clone().offsetHSL(warm ? 0.01 : -0.01, 0.04, (Math.random() - 0.5) * 0.05);
    const g = ctx.createRadialGradient(
      Math.random() * size, Math.random() * size, 4,
      Math.random() * size, Math.random() * size, 30 + Math.random() * 60);
    g.addColorStop(0, `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},0.16)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // fine grain
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 8;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 2);

  // roughness map: brighter = rougher; skin varies subtly (shinier on high points)
  const rc = document.createElement('canvas');
  rc.width = rc.height = 128;
  const rctx = rc.getContext('2d');
  rctx.fillStyle = '#b8b8b8';
  rctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 40; i++) {
    rctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`;
    rctx.beginPath();
    rctx.arc(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 20, 0, Math.PI * 2);
    rctx.fill();
  }
  const roughnessMap = new THREE.CanvasTexture(rc);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(2, 2);
  return { map, roughnessMap };
}

/**
 * Build the skinned body geometry (bind-pose world space) for a persona.
 * @param {import('./skeleton.js').BodyParams} b
 * @param {Record<string, THREE.Vector3>} j joints
 * @returns {THREE.BufferGeometry}
 */
export function buildBodyGeometry(b, j) {
  const h = b.height;
  const parts = [];
  const B = BONE_INDEX;

  // ---- torso lathe (crotch → neck base), elliptical
  const hipR = 0.094 * h * b.hips;
  const waistR = 0.073 * h * b.waist;
  const bustR = 0.085 * h;
  const torso = latheGeo([
    [0.532 * h, hipR * 0.82],
    [0.560 * h, hipR * 0.97],
    [0.578 * h, hipR],
    [0.625 * h, waistR],
    [0.672 * h, waistR * 1.06],
    [0.730 * h, bustR],
    [0.790 * h, bustR * 0.94],
    [0.828 * h, 0.056 * h],
    [0.862 * h, 0.030 * h],
  ], 0.72, 18);
  chainSkin(torso, [
    { bone: B.hips, from: 0.50 * h, to: 0.635 * h },
    { bone: B.spine1, from: 0.635 * h, to: 0.70 * h },
    { bone: B.spine2, from: 0.70 * h, to: 0.762 * h },
    { bone: B.chest, from: 0.762 * h, to: 0.88 * h },
  ], 0.035 * h);
  parts.push(torso);

  // ---- glutes
  for (const side of [1, -1]) {
    const g = ballGeo(new THREE.Vector3(side * 0.042 * h, 0.556 * h, -0.045 * h),
      0.055 * h * b.hips, { x: 1, y: 0.92, z: 0.95 }, 12);
    rigidSkin(g, side > 0 ? B.thighL : B.thighR);
    parts.push(g);
  }

  // ---- breasts
  if (b.bust > 0.05) {
    for (const side of [1, -1]) {
      const g = ballGeo(new THREE.Vector3(side * 0.040 * h, 0.780 * h, 0.055 * h),
        0.034 * h * b.bust, { x: 1.05, y: 0.95, z: 0.9 }, 12);
      rigidSkin(g, side > 0 ? B.breastL : B.breastR);
      parts.push(g);
    }
  }

  // ---- neck
  const neck = limbGeo(new THREE.Vector3(0, 0.845 * h, 0.004 * h), new THREE.Vector3(0, 0.92 * h, 0.012 * h),
    0.030 * h, 0.033 * h, 10);
  chainSkin(neck, [
    { bone: B.neck, from: 0.82 * h, to: 0.895 * h },
    { bone: B.head, from: 0.895 * h, to: 0.95 * h },
  ], 0.02 * h);
  parts.push(neck);

  // ---- head + jaw hint (rigid to head; face/eyes/hair are bone children, not skinned)
  const skull = ballGeo(new THREE.Vector3(0, 0.950 * h, 0.006 * h), 0.062 * h, { x: 0.92, y: 1.1, z: 0.96 }, 16);
  rigidSkin(skull, B.head);
  parts.push(skull);
  const jaw = ballGeo(new THREE.Vector3(0, 0.912 * h, 0.020 * h), 0.045 * h, { x: 0.78, y: 0.66, z: 0.84 }, 12);
  rigidSkin(jaw, B.head);
  parts.push(jaw);

  // ---- arms (one tapered limb per side, split at elbow) + mitt hands
  const armDir = new THREE.Vector3(Math.sin(ARM_ANGLE), -Math.cos(ARM_ANGLE), 0);
  for (const side of ['L', 'R']) {
    const m = side === 'L' ? 1 : -1;
    const sh = j['arm' + side], el = j['fore' + side], wr = j['hand' + side], fg = j['finger' + side];
    const dir = armDir.clone(); dir.x *= m;

    // deltoid cap: overlaps the torso and the arm so the shoulder reads as one
    // rounded mass rather than a floating ball
    const cap = ballGeo(sh.clone().addScaledVector(dir, 0.008 * h), 0.044 * h * b.build,
      { x: 1.05, y: 1.1, z: 1.0 });
    rigidSkin(cap, B['arm' + side]);
    parts.push(cap);

    const upperLen = el.clone().sub(sh).length();
    const fullLen = wr.clone().sub(sh).length();
    const arm = limbGeo(sh, wr, 0.036 * h * b.build, 0.021 * h * b.build);
    const along = (x, y, z) => new THREE.Vector3(x, y, z).sub(sh).dot(dir);
    chainSkin(arm, [
      { bone: B['arm' + side], from: -0.05, to: upperLen },
      { bone: B['fore' + side], from: upperLen, to: fullLen + 0.02 },
    ], 0.028 * h, along);
    parts.push(arm);

    // elbow joint: a small sphere so bends stay rounded when posed
    const elbow = ballGeo(el, 0.026 * h * b.build, { x: 1, y: 1, z: 1 });
    rigidSkin(elbow, B['fore' + side]);
    parts.push(elbow);

    const handCenter = wr.clone().addScaledVector(dir, 0.045 * h);
    const hand = ballGeo(handCenter, 0.030 * h, { x: 0.82, y: 1.35, z: 0.6 });
    // orient the elongation along the arm: cheap — rotate about Z by ±ARM_ANGLE
    hand.translate(-handCenter.x, -handCenter.y, -handCenter.z);
    hand.rotateZ(m * -ARM_ANGLE);
    hand.translate(handCenter.x, handCenter.y, handCenter.z);
    rigidSkin(hand, B['hand' + side]);
    parts.push(hand);
  }

  // ---- legs (hip → ankle tapered, split at knee) + feet
  for (const side of ['L', 'R']) {
    const hip = j['thigh' + side], knee = j['shin' + side], ankle = j['foot' + side];
    const thighLen = knee.clone().sub(hip).length();
    const fullLen = ankle.clone().sub(hip).length();
    const legDir = ankle.clone().sub(hip).normalize();
    const leg = limbGeo(hip, ankle, 0.056 * h * b.build * (0.8 + 0.25 * b.hips), 0.022 * h * b.build);
    const along = (x, y, z) => new THREE.Vector3(x, y, z).sub(hip).dot(legDir);
    chainSkin(leg, [
      { bone: BONE_INDEX['thigh' + side], from: -0.06, to: thighLen },
      { bone: BONE_INDEX['shin' + side], from: thighLen, to: fullLen + 0.02 },
    ], 0.035 * h, along);
    parts.push(leg);

    // knee joint sphere for rounded bends
    const kneeBall = ballGeo(j['shin' + side], 0.034 * h * b.build, { x: 1, y: 1.05, z: 1 });
    rigidSkin(kneeBall, BONE_INDEX['shin' + side]);
    parts.push(kneeBall);

    const foot = ballGeo(new THREE.Vector3(hip.x, 0.028 * h, 0.03 * h), 0.032 * h,
      { x: 0.95, y: 0.62, z: 2.3 });
    rigidSkin(foot, BONE_INDEX['foot' + side]);
    parts.push(foot);
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  // weld coincident verts + smooth normals so limb/joint seams stop reading as
  // faceted ball-joints
  return weldGeometry(merged, 6e-4);
}

/**
 * Build the visual rig: skinned body mesh + bone-attached hair.
 * @param {{ colors: {skin:string, hair:string}, body: import('./skeleton.js').BodyParams, hairStyle: string }} persona
 * @param {{ byName: Record<string, THREE.Bone>, skeleton: THREE.Skeleton, bones: THREE.Bone[], joints: Record<string, THREE.Vector3> }} rig
 */
export function buildBody(persona, rig) {
  const geo = buildBodyGeometry(persona.body, rig.joints);
  const { map, roughnessMap } = skinMaps(persona.colors.skin);
  // Physical material with a soft sheen gives skin a subtle fresnel falloff at
  // grazing angles — the single biggest cue that reads as "skin" not "plastic".
  const mat = new THREE.MeshPhysicalMaterial({
    map, roughnessMap,
    roughness: 0.72, metalness: 0.0,
    sheen: 0.5,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color(persona.colors.skin).offsetHSL(0, 0.1, 0.08),
  });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.add(rig.bones[0]); // root bone
  mesh.bind(rig.skeleton);
  mesh.frustumCulled = false; // skinned bounds are wrong when posed; cheap cast anyway
  buildHair(persona, rig);
  return mesh;
}

/**
 * Hair recipes — a crown cap covering scalp + back, thin side locks and a swept
 * fringe that FRAME the face opening (which faces +Z). Nothing covers the front
 * of the face. Parented to head + hair bones.
 * @param {{ colors:{hair:string}, body: import('./skeleton.js').BodyParams, hairStyle: string }} persona
 */
export function buildHair(persona, rig) {
  const h = persona.body.height;
  const head = rig.byName.head;
  const headWorld = rig.joints.head;
  // Physical material with anisotropy + clearcoat gives hair a directional sheen
  // streak instead of a flat matte blob — the classic "hair highlight".
  const hairCol = new THREE.Color(persona.colors.hair);
  const mat = new THREE.MeshPhysicalMaterial({
    color: hairCol, roughness: 0.55, metalness: 0.15,
    clearcoat: 0.6, clearcoatRoughness: 0.35,
    sheen: 0.6, sheenColor: hairCol.clone().offsetHSL(0, 0, 0.25),
  });
  if ('anisotropy' in mat) { mat.anisotropy = 0.7; mat.anisotropyRotation = Math.PI / 2; }
  /** local pos relative to head bone */
  const local = (v) => v.clone().sub(headWorld);
  const style = persona.hairStyle;

  // crown cap: upper hemisphere pushed back off the forehead so the face shows.
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.069 * h, 28, 22, 0, Math.PI * 2, 0, Math.PI * 0.56),
    mat
  );
  cap.scale.set(1.0, 1.18, 1.06);
  cap.position.copy(local(new THREE.Vector3(0, 0.949 * h, -0.006 * h)));
  cap.castShadow = true;
  head.add(cap);

  // back of the skull filled in (behind the ears, doesn't touch the face)
  const backCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.066 * h, 24, 18, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.4),
    mat
  );
  backCap.scale.set(1.02, 1.0, 1.06);
  backCap.position.copy(local(new THREE.Vector3(0, 0.945 * h, -0.020 * h)));
  head.add(backCap);

  // swept fringe: thin curved slab above the brow, tilted back so it caps the forehead
  const fringe = new THREE.Mesh(
    new THREE.SphereGeometry(0.064 * h, 24, 10, Math.PI * 0.2, Math.PI * 0.6, 0, Math.PI * 0.22),
    mat
  );
  fringe.scale.set(1.02, 1.0, 1.12);
  fringe.position.copy(local(new THREE.Vector3(0, 0.951 * h, 0.006 * h)));
  head.add(fringe);

  // side locks: thin, set wide and slightly back, framing the cheeks
  const sideLen = style === 'long' ? 0.12 * h : (style === 'bob' ? 0.075 * h : 0.05 * h);
  for (const m of [1, -1]) {
    const side = new THREE.Mesh(
      new THREE.BoxGeometry(0.013 * h, sideLen, 0.05 * h),
      mat
    );
    side.position.copy(local(new THREE.Vector3(
      m * 0.061 * h, 0.945 * h - sideLen * 0.42, -0.006 * h)));
    side.rotation.z = m * 0.07;
    side.rotation.x = -0.12;
    head.add(side);
  }

  if (style === 'bob') {
    // rounded back volume sitting behind the neck line
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.058 * h, 14, 12), mat);
    back.scale.set(1.05, 0.9, 0.7);
    back.position.copy(local(new THREE.Vector3(0, 0.905 * h, -0.05 * h)));
    head.add(back);
  }
  if (style === 'long') {
    // flowing panels on the hair-bone chain (secondary motion later)
    const segs = [
      { bone: 'hair1', size: [0.10, 0.10, 0.03], at: new THREE.Vector3(0, 0.90 * h, -0.05 * h) },
      { bone: 'hair2', size: [0.088, 0.10, 0.026], at: new THREE.Vector3(0, 0.82 * h, -0.056 * h) },
      { bone: 'hair3', size: [0.066, 0.10, 0.02], at: new THREE.Vector3(0, 0.74 * h, -0.05 * h) },
    ];
    for (const s of segs) {
      const bone = rig.byName[s.bone];
      const boneWorld = rig.joints[s.bone];
      const panel = new THREE.Mesh(new THREE.BoxGeometry(s.size[0] * h, s.size[1] * h, s.size[2] * h), mat);
      panel.position.copy(s.at.clone().sub(boneWorld));
      bone.add(panel);
    }
  }
}
