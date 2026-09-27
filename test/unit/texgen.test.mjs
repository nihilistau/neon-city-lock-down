// @ts-check
// src/scene3d/materials/texGen.js — procedural textures are SEEDED. They used to
// draw with Math.random(), so every boot painted a different concrete, a
// different wood grain and a different skyline: screenshots could never be
// compared, and a "looks wrong" report could not be reproduced. Each recipe now
// seeds its own stream from its cache key, so it paints the same pixels no
// matter what was generated before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './helpers/dom.mjs';

/** generate a few recipes in a FRESH module instance and return the draw log */
async function paint(tag, order) {
  const log = [];
  installFakeDom({ record: log });
  const tg = await import(`../../src/scene3d/materials/texGen.js?instance=${tag}`);
  const recipes = {
    concrete: () => tg.concreteTex('#181c2a', 1),
    wood: () => tg.woodTex('#2b1e18', 1),
    marble: () => tg.marbleTex('#353b4a', 1),
    tile: () => tg.tileTex('#11141f', '#05060a', 4, 1),
  };
  const byRecipe = {};
  for (const name of order) {
    const start = log.length;
    recipes[name]();
    byRecipe[name] = log.slice(start);
  }
  return byRecipe;
}

test('recipeRandom: the same key gives the same stream; different keys differ', async () => {
  installFakeDom();
  const { recipeRandom } = await import('../../src/scene3d/materials/texGen.js');
  const a = recipeRandom('wood:#2b1e18:1');
  const b = recipeRandom('wood:#2b1e18:1');
  const c = recipeRandom('wood:#2b1e18:2');
  const sa = [a(), a(), a()];
  assert.deepEqual(sa, [b(), b(), b()]);
  assert.notDeepEqual(sa, [c(), c(), c()]);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

test('a recipe paints identically across fresh module instances', async () => {
  const one = await paint('a', ['concrete', 'wood', 'marble', 'tile']);
  const two = await paint('b', ['concrete', 'wood', 'marble', 'tile']);
  assert.deepEqual(one, two);
  assert.ok(one.wood.length > 40, 'the log really recorded the grain strokes');
});

test('...and regardless of generation order', async () => {
  const fwd = await paint('c', ['concrete', 'wood', 'marble', 'tile']);
  const rev = await paint('d', ['tile', 'marble', 'wood', 'concrete']);
  assert.deepEqual(fwd.wood, rev.wood);
  assert.deepEqual(fwd.concrete, rev.concrete);
});

test('no Math.random left in the texture generators', () => {
  for (const f of ['src/scene3d/materials/texGen.js', 'src/scene3d/materials/cityWindows.js']) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /Math\.random/, f);
  }
});

test('the city-window canvas is seeded too', async () => {
  const logA = [];
  installFakeDom({ record: logA });
  (await import('../../src/scene3d/materials/cityWindows.js?instance=a')).cityWindowsTexture();
  const logB = [];
  installFakeDom({ record: logB });
  (await import('../../src/scene3d/materials/cityWindows.js?instance=b')).cityWindowsTexture();
  assert.deepEqual(logA, logB);
  assert.ok(logA.length > 50);
});
