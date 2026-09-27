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
  assert.ok(s.uniforms.domeGain && s.uniforms.domeCap && s.uniforms.domeStrip, 'uniforms bound');
  assert.equal(m.customProgramCacheKey(), 'sky-dome');
});
