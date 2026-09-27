// @ts-check
// src/scene3d/env.js caches one PMREM render target per preset. Disposing only
// its .texture freed the texture but left the render target's framebuffers
// alive, so every HDRI switch leaked a cube's worth of GPU memory per preset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EnvBuilder } from '../../src/scene3d/env.js';

function fakeBuilder() {
  const env = new EnvBuilder(/** @type {any} */ ({ compile() {}, compileAsync: async () => {} }));
  const made = [];
  env.pmrem = /** @type {any} */ ({
    fromScene: () => {
      const rt = { disposed: 0, texture: new THREE.Texture(), dispose() { this.disposed++; } };
      made.push(rt);
      return rt;
    },
    dispose() {},
  });
  return { env, made };
}

test('an HDRI swap disposes every cached render target, not just its texture', () => {
  const { env, made } = fakeBuilder();
  const a = env.get('neon_night');
  assert.equal(env.get('neon_night'), a, 'cached per preset');
  env.get('blackout_emergency');
  assert.equal(made.length, 2);
  env.setHDRI(new THREE.Texture());
  assert.deepEqual(made.map((rt) => rt.disposed), [1, 1]);
  assert.notEqual(env.get('neon_night'), a, 'rebuilt from the new sky');
});

test('dispose() frees the render targets too', () => {
  const { env, made } = fakeBuilder();
  env.get('neon_night');
  env.dispose();
  assert.equal(made[0].disposed, 1);
});
