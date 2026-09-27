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
