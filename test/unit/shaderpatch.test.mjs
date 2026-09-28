// @ts-check
// onBeforeCompile patches find their anchors by #include name. three renames
// chunks between releases, and a missing anchor makes String.replace a silent
// no-op: the material compiles, the effect never appears. So the patches are
// run against r185's REAL shader sources here, not stand-in strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { patchWindowOffsets } from '../../src/scene3d/materials/cityWindows.js';

/** @param {string} lib */
const shaderOf = (lib) => ({ uniforms: {}, vertexShader: THREE.ShaderLib[lib].vertexShader, fragmentShader: THREE.ShaderLib[lib].fragmentShader });

test('the window-offset patch lands in the r185 standard vertex shader', () => {
  const m = patchWindowOffsets(new THREE.MeshStandardMaterial());
  const s = shaderOf('standard');
  m.onBeforeCompile(/** @type {any} */ (s), /** @type {any} */ (null));
  assert.match(s.vertexShader, /attribute vec2 aWinOffset;/);
  assert.match(s.vertexShader, /vEmissiveMapUv \+= aWinOffset;/);
  assert.equal(m.customProgramCacheKey(), 'city-window-offsets');
});

test('the sky-dome exposure patch lands in the r185 basic fragment shader', async () => {
  const { skyDomeMaterial } = await import('../../src/scene3d/materials/skyDome.js');
  const m = skyDomeMaterial(new THREE.Texture());
  const s = shaderOf('basic');
  m.onBeforeCompile(/** @type {any} */ (s), /** @type {any} */ (null));
  assert.match(s.fragmentShader, /uniform float domeGain;/);
  assert.match(s.fragmentShader, /diffuseColor\.rgb \*= domeGain;/);
  assert.doesNotMatch(s.fragmentShader, /#include <map_fragment>/, 'the stock sample is replaced by the folded one');
  assert.match(s.fragmentShader, /texture2D\( map, domeUv \)|texture2D\(map, domeUv\)/);
  assert.match(s.fragmentShader, /vec3 softKneeClamp\(/, 'the lamp-core soft clamp is defined');
  assert.match(s.fragmentShader, /diffuseColor\.rgb = softKneeClamp\(/, '... and applied');
  assert.ok(s.uniforms.domeGain && s.uniforms.domeCap && s.uniforms.domeStrip, 'uniforms bound');
  assert.equal(m.customProgramCacheKey(), 'sky-dome');
});

test('the reflection boost lands on the specular IBL lobe only, in the r185 standard shader', async () => {
  const { patchReflectBoost } = await import('../../src/scene3d/materials/reflectBoost.js');
  const m = patchReflectBoost(new THREE.MeshStandardMaterial(), 2.5);
  const s = shaderOf('physical');
  m.onBeforeCompile(/** @type {any} */ (s), /** @type {any} */ (null));
  assert.match(s.fragmentShader, /uniform float reflectBoost;/);
  assert.match(s.fragmentShader, /return envMapColor\.rgb \* envMapIntensity \* reflectBoost;/, 'radiance boosted');
  assert.match(s.fragmentShader, /return PI \* envMapColor\.rgb \* envMapIntensity;/, 'irradiance (diffuse IBL) untouched');
  assert.equal(s.uniforms.reflectBoost.value, 2.5);
  assert.equal(m.customProgramCacheKey(), 'reflect-boost');
});

// Material.clone()/copy() carry no instance onBeforeCompile/customProgramCacheKey,
// and interactive props + the picker's hover glow clone their materials: a
// clone must come back with the patch re-applied, or it silently drops it.
test('every patch survives clone() — and a clone of a clone', async () => {
  const { patchReflectBoost } = await import('../../src/scene3d/materials/reflectBoost.js');
  const { skyDomeMaterial } = await import('../../src/scene3d/materials/skyDome.js');
  const cases = [
    [patchReflectBoost(new THREE.MeshStandardMaterial(), 1.7), 'reflect-boost', 'physical', (s) => assert.equal(s.uniforms.reflectBoost.value, 1.7)],
    [patchWindowOffsets(new THREE.MeshStandardMaterial()), 'city-window-offsets', 'standard', (s) => assert.match(s.vertexShader, /aWinOffset/)],
    [skyDomeMaterial(new THREE.Texture()), 'sky-dome', 'basic', (s) => assert.ok(s.uniforms.domeGain)],
  ];
  for (const [m, key, lib, check] of cases) {
    for (const c of [m.clone(), m.clone().clone()]) {
      assert.notEqual(c, m);
      assert.equal(c.customProgramCacheKey(), key);
      const s = shaderOf(lib);
      c.onBeforeCompile(/** @type {any} */ (s), /** @type {any} */ (null));
      check(s);
    }
  }
});

import { applyRainOnGlass, RAIN_GLASS_UNIFORMS } from '../../src/scene3d/materials/rainGlass.js';

test('the rain-on-glass patch lands in the r185 standard shaders and shares one set of uniforms', () => {
  const a = applyRainOnGlass(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.18 }));
  const b = applyRainOnGlass(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.18 }));
  const sa = shaderOf('standard');
  const sb = shaderOf('standard');
  a.onBeforeCompile(/** @type {any} */ (sa), /** @type {any} */ (null));
  b.onBeforeCompile(/** @type {any} */ (sb), /** @type {any} */ (null));
  assert.match(sa.vertexShader, /vRainP = \( modelMatrix \* vec4\( transformed, 1\.0 \) \)\.xyz;/);
  assert.match(sa.fragmentShader, /vec3 rainDrops\(/);
  assert.match(sa.fragmentShader, /float rainCover/);
  assert.match(sa.fragmentShader, /normal = normalize\( normal \+/);
  assert.equal(sa.uniforms.uRain, RAIN_GLASS_UNIFORMS.uRain);
  assert.equal(sb.uniforms.uRainTime, sa.uniforms.uRainTime, 'one uniform object drives every pane');
  assert.equal(a.customProgramCacheKey(), 'rain-on-glass');
});

// The curtain wall is reflect-boosted glass (Task 19). Rain goes on top of that
// patch: replacing onBeforeCompile outright would silently drop the boost.
test('rain on glass composes with the reflection boost — both land, and clones keep both', async () => {
  const { patchReflectBoost } = await import('../../src/scene3d/materials/reflectBoost.js');
  const m = applyRainOnGlass(patchReflectBoost(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.18 }), 2.5));
  for (const c of [m, m.clone(), m.clone().clone()]) {
    const s = shaderOf('standard');
    c.onBeforeCompile(/** @type {any} */ (s), /** @type {any} */ (null));
    assert.match(s.fragmentShader, /return envMapColor\.rgb \* envMapIntensity \* reflectBoost;/, 'boost kept');
    assert.match(s.fragmentShader, /vec3 rainDrops\(/, 'rain added');
    assert.match(s.vertexShader, /vRainP = /);
    assert.equal(s.uniforms.reflectBoost.value, 2.5);
    assert.equal(s.uniforms.uRain, RAIN_GLASS_UNIFORMS.uRain);
    assert.equal(c.customProgramCacheKey(), 'reflect-boost|rain-on-glass');
    assert.equal((s.fragmentShader.match(/vec3 rainDrops\(/g) || []).length, 1, 'a clone patches once, not twice');
    assert.equal((s.fragmentShader.match(/uniform float reflectBoost;/g) || []).length, 1);
  }
});

// applyRainOnGlass must be idempotent: interiorGlassMat/glassMat call sites and
// any future stacking code may end up calling it twice on the same material
// (e.g. re-running a builder path); a second call must not inject the shader
// chunks or uniforms again.
test('applying rain twice is idempotent — single injection', () => {
  const m = applyRainOnGlass(applyRainOnGlass(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.18 })));
  const s = shaderOf('standard');
  m.onBeforeCompile(/** @type {any} */ (s), /** @type {any} */ (null));
  assert.equal((s.fragmentShader.match(/vec3 rainDrops\(/g) || []).length, 1, 'only one rainDrops definition');
  assert.equal((s.vertexShader.match(/vRainP = \(/g) || []).length, 1, 'only one vertex injection');
  assert.equal(m.customProgramCacheKey(), 'rain-on-glass', 'cache key not doubled');
});

test('the rain-on-glass cache key is built once as a plain closure', () => {
  const m = applyRainOnGlass(new THREE.MeshStandardMaterial());
  const k1 = m.customProgramCacheKey();
  const k2 = m.customProgramCacheKey();
  assert.equal(k1, k2);
  assert.equal(k1, 'rain-on-glass');
});
