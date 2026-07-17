// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack, rollInjury, WEAPONS, HOSTILE_ARCHETYPES } from '../../src/sim/combat/resolver.js';
import { RngStream } from '../../src/core/rng.js';

test('point-blank skilled attack usually hits; long range rarely does', () => {
  let closeHits = 0, farHits = 0;
  const rngA = new RngStream(42), rngB = new RngStream(42);
  for (let i = 0; i < 200; i++) {
    if (resolveAttack({ weapon: WEAPONS.sidearm, skill: 80, distance: 1 }, rngA).hit) closeHits++;
    if (resolveAttack({ weapon: WEAPONS.sidearm, skill: 80, distance: 40 }, rngB).hit) farHits++;
  }
  assert.ok(closeHits > 150, `close hits ${closeHits}`);
  assert.ok(farHits < closeHits, `far ${farHits} should be < close ${closeHits}`);
});

test('damage falls within weapon bounds (crit can exceed max)', () => {
  const rng = new RngStream(7);
  for (let i = 0; i < 100; i++) {
    const r = resolveAttack({ weapon: WEAPONS.pipe, skill: 50, distance: 1 }, rng);
    if (r.hit && !r.crit) {
      assert.ok(r.damage >= WEAPONS.pipe.damage[0] - 0.5 && r.damage <= WEAPONS.pipe.damage[1] + 0.5);
    }
    if (r.crit) assert.ok(r.damage > WEAPONS.pipe.damage[0]);
  }
});

test('cover reduces hit rate', () => {
  const a = new RngStream(9), b = new RngStream(9);
  let open = 0, covered = 0;
  for (let i = 0; i < 300; i++) {
    if (resolveAttack({ weapon: WEAPONS.smg, skill: 60, distance: 5 }, a).hit) open++;
    if (resolveAttack({ weapon: WEAPONS.smg, skill: 60, distance: 5, cover: 0.9 }, b).hit) covered++;
  }
  assert.ok(covered < open, `covered ${covered} < open ${open}`);
});

test('rollInjury severity scales with damage', () => {
  const rng = new RngStream(3);
  assert.equal(rollInjury(8, rng).severity, 'graze');
  assert.equal(rollInjury(20, rng).severity, 'wound');
  assert.equal(rollInjury(35, rng).severity, 'serious');
});

test('archetypes reference real weapons', () => {
  for (const [id, arch] of Object.entries(HOSTILE_ARCHETYPES)) {
    assert.ok(WEAPONS[arch.weapon], `${id} has unknown weapon ${arch.weapon}`);
    assert.ok(arch.hp > 0 && arch.speed > 0);
  }
});
