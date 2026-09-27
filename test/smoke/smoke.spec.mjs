// @ts-check
// End-to-end smoke test. Drives a real browser through the real game.
//
//   npx playwright test          (starts tools/serve.mjs itself — see playwright.config.mjs)
//
// WHAT THIS REPLACED
// The previous version of this file printed a checklist of eleven things a
// human should check, and exited 0. It reported a green tick in the suite while
// asserting nothing at all, because Playwright was never installed — so the one
// test whose whole job was to catch "the game does not boot" could not fail.
// The hidden control hint and the elevator soft-lock both shipped past it.
//
// This file is NOT run by `node --test`; it lives behind `npx playwright test`
// so the zero-dependency runtime promise is unaffected.
import { test, expect } from '@playwright/test';

const URL = process.env.NCLD_URL || 'http://localhost:8420/?debug=1';

/** Boot to a live run and hand back the page. Fails loudly rather than timing out silently. */
async function bootToRun(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  const newRun = page.getByRole('button', { name: /New Run/i });
  await expect(newRun).toBeVisible({ timeout: 10000 });
  await newRun.click();

  // the new-run screen's own confirm button
  const begin = page.getByRole('button', { name: /^(Begin|Start|Enter the tower|Start run)/i }).first();
  if (await begin.isVisible().catch(() => false)) await begin.click();

  await page.waitForFunction(() => window.__ncld?.app?.mode === 'run', null, { timeout: 45000 });

  // mode === 'run' is reached BEFORE the opening cutscene finishes, and during a
  // cutscene the HUD is deliberately hidden (`.cinema #hud > *`), the sim is
  // paused, and CutscenePlayer.play() no-ops (`if (this.playing) return`). Tests
  // that ran against that raced the intro and failed for reasons that had
  // nothing to do with what they assert. Skip it and wait for real gameplay.
  // Retry, because a single Escape races the cutscene's own start: abort() bails
  // early if `playing` is not true yet, and under software rendering the opening
  // beats take a while to get going.
  for (let i = 0; i < 40; i++) {
    const clear = await page.evaluate(() => {
      const app = window.__ncld.app;
      return app.cutscene?.playing === false && !app.loop.paused;
    });
    if (clear) return errors;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  throw new Error('the opening cutscene never released the sim');
}

test.describe('Neon-City: Lock-Down', () => {
  test('boots to a live run with no console errors', async ({ page }) => {
    const errors = await bootToRun(page);
    const state = await page.evaluate(() => ({
      mode: window.__ncld.app.mode,
      floor: window.__ncld.app.world.activeFloor,
      cast: Object.keys(window.__ncld.app.cast).length,
      lights: (() => { let n = 0; window.__ncld.app.stage.scene.traverseVisible((o) => { if (o.isLight) n++; }); return n; })(),
    }));
    expect(state.mode).toBe('run');
    expect(state.floor).toBe('penthouse');
    expect(state.cast).toBeGreaterThanOrEqual(3);
    expect(state.lights).toBeGreaterThan(0);
    // an ignorable-error allowlist would defeat the point; there should be none
    expect(errors, `console errors during boot:\n${errors.join('\n')}`).toEqual([]);
  });

  test('the control hint is visible — it shipped hidden once', async ({ page }) => {
    await bootToRun(page);
    // #hud-hint was emitted with class="hidden" and nothing ever removed it, so
    // the only pointer to the only controls surface was invisible for a release.
    await expect(page.locator('#hud-hint')).toBeVisible();
    await page.keyboard.press('?');
    await expect(page.locator('#hud-help')).toBeVisible();
  });

  test('only one panel is open at a time and Escape closes it', async ({ page }) => {
    await bootToRun(page);
    // Five panels used to stack, each holding its own pause token, and the
    // elevator picker rendered above the pause menu with no way out.
    for (const key of ['KeyP', 'KeyI', 'KeyK']) await page.keyboard.press(key.replace('Key', ''));
    const open = await page.evaluate(() => ({
      overlays: document.querySelectorAll('#overlay > *').length,
      pauseReasons: [...window.__ncld.app.loop.pauseReasons],
    }));
    expect(open.overlays).toBe(1);
    expect(open.pauseReasons.length).toBe(1);

    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => ({
      overlays: document.querySelectorAll('#overlay > *').length,
      pauseReasons: [...window.__ncld.app.loop.pauseReasons],
    }));
    expect(closed.overlays).toBe(0);
    expect(closed.pauseReasons).toEqual([]);
  });

  test('a save round-trips through a slot', async ({ page }) => {
    await bootToRun(page);
    const result = await page.evaluate(async () => {
      const app = window.__ncld.app;
      app.run.resources.food = 42;
      app.cast.lola.stats.trust = 71;
      window.__ncld.debug.save(3);
      app.run.resources.food = 1;
      app.cast.lola.stats.trust = 5;
      window.__ncld.debug.load(3);
      await new Promise((r) => setTimeout(r, 500));
      return { food: app.run.resources.food, trust: Math.round(app.cast.lola.stats.trust) };
    });
    expect(result.food).toBe(42);
    expect(result.trust).toBe(71);
  });

  test('every floor is reachable and renders', async ({ page }) => {
    await bootToRun(page);
    const floors = ['rooftop', 'fl40', 'fl27', 'fl12', 'ground', 'basement', 'penthouse'];
    for (const f of floors) {
      const state = await page.evaluate(async (floor) => {
        window.__ncld.app.setFloor(floor);
        await new Promise((r) => setTimeout(r, 300));
        const app = window.__ncld.app;
        let meshes = 0;
        app.stage.scene.traverseVisible((o) => { if (o.isMesh) meshes++; });
        return {
          active: app.world.activeFloor,
          meshes,
          // the light kit must FOLLOW the floor, not stay 1200 units behind it
          lightOffset: Math.round(app.lighting.key.position.x),
          markerX: Math.round(app.playerMarker.position.x),
        };
      }, f);
      expect(state.active, `setFloor('${f}')`).toBe(f);
      expect(state.meshes, `${f} should render geometry`).toBeGreaterThan(20);
      expect(Math.abs(state.lightOffset - state.markerX), `${f}: light kit should be near the player`).toBeLessThan(40);
    }
  });

  test('the minigames are reachable from inside a run', async ({ page }) => {
    await bootToRun(page);
    // The card game and three mystery cases were openable only from the
    // new-run screen or the debug panel.
    const opened = await page.evaluate(async () => {
      const app = window.__ncld.app;
      const out = {};
      for (const [name, game] of [['cards', 'cards'], ['mystery', 'mystery:dead_drop']]) {
        window.__ncld.app.gamesPanel.close();
        const { emit } = await import('/src/core/bus.js');
        emit('game.requested', { game });
        await new Promise((r) => setTimeout(r, 400));
        out[name] = app.gamesPanel.mode;
      }
      app.gamesPanel.close();
      return out;
    });
    expect(opened.cards).toBe('cards');
    expect(opened.mystery).toBe('mystery');
  });

  test('half rations do not kill a fed cast', async ({ page }) => {
    await bootToRun(page);
    // Regression guard for a shipped bug: a flat tension nudge on half rations
    // tagged the cause as 'rations', which dealt 6hp/hour regardless of whether
    // there was any actual shortfall. Every NPC died in ~17 game-hours with a
    // full pantry.
    const after = await page.evaluate(async () => {
      const app = window.__ncld.app;
      app.run.resources.food = 500;
      app.run.resources.water = 500;
      app.run.rationPolicy.food = 'half';
      app.run.rationPolicy.water = 'half';
      const { hourlyTick } = await import('/src/sim/survival.js');
      const cast = Object.values(app.cast).filter((c) => c.persona?.corporeal !== false);
      for (let i = 0; i < 24; i++) hourlyTick(app.run, cast);
      return cast.map((c) => ({ id: c.id, alive: c.alive, health: Math.round(c.health) }));
    });
    for (const c of after) {
      expect(c.alive, `${c.id} should survive 24h of half rations with a full pantry`).toBe(true);
      expect(c.health, `${c.id} health`).toBeGreaterThan(50);
    }
  });

  test('a cutscene cannot leave the game frozen — even in a hidden tab', async ({ page }) => {
    await bootToRun(page);
    // THE BUG THIS GUARDS. Camera shots drove themselves purely from
    // requestAnimationFrame, which a browser stops ENTIRELY in a hidden tab —
    // not throttled, stopped. So alt-tabbing during the ~60s intro meant the
    // shot's promise never resolved, play()'s finally never ran, and
    // loop.resume('cutscene') never happened: the sim stayed paused forever with
    // no way back. The only symptom is "I can't move or turn the camera", which
    // reads as broken controls rather than a cutscene that never ended.
    const result = await page.evaluate(async () => {
      const app = window.__ncld.app;
      // a short script with a shot in it — the step that used to stall
      const steps = [
        { type: 'shot', from: [2, 1.6, 4], to: [-1, 1.6, 2], look: [-3, 1.3, 0], dur: 1.2 },
        { type: 'wait', sec: 0.3 },
      ];
      // convince the page it is hidden, exactly as an alt-tab would
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      const rafStub = window.requestAnimationFrame;
      window.requestAnimationFrame = () => 0;   // the browser's hidden-tab behaviour

      const t0 = performance.now();
      await app.cutscene.play(steps);
      const elapsed = performance.now() - t0;

      window.requestAnimationFrame = rafStub;
      return { elapsed, paused: app.loop.paused, reasons: [...app.loop.pauseReasons], playing: app.cutscene.playing };
    });
    expect(result.playing, 'the cutscene must finish').toBe(false);
    expect(result.reasons, 'the cutscene pause token must be released').not.toContain('cutscene');
    expect(result.paused, 'the sim must be running again').toBe(false);
    // the timer backstop lands a little after the declared duration, never never
    expect(result.elapsed).toBeLessThan(20000);
  });

  test('death ends the run and records it', async ({ page }) => {
    await bootToRun(page);
    const result = await page.evaluate(async () => {
      window.__ncld.debug.kill();
      await new Promise((r) => setTimeout(r, 1200));
      return {
        screen: !!document.querySelector('.screen'),
        text: document.body.innerText.slice(0, 400),
        runsRecorded: JSON.parse(localStorage.getItem('ncld.meta') || '{}').runs?.length ?? 0,
      };
    });
    expect(result.screen).toBe(true);
    expect(result.runsRecorded).toBeGreaterThan(0);
  });
});
