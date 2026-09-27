// @ts-check
// Capture the README / docs screenshots from the real game. DEV-TIME ONLY —
// needs the dev dependencies (@playwright/test, sharp) and a running server.
//
//   node tools/serve.mjs 8420            # in another terminal
//   node tools/screenshots.mjs           # every shot
//   node tools/screenshots.mjs bond-rail bed-together   # just these
//   node tools/screenshots.mjs --list    # names only
//
// Each shot boots a fresh browser context (clean localStorage, so no autosave
// and no leftovers from the previous shot), stages the scene through
// window.__ncld (the ?debug=1 hooks in src/core/app.js), and writes
// docs/screenshots/<file>.jpg at the README's framing: 1710x907 for the wide
// hero shots, 1250x907 for the rest, JPEG q82 via sharp.
//
// Why a script and not hand-captured images: every screenshot the README
// shipped before v0.6.0-rc.1 was taken by hand, and when the UI changed they
// silently went stale — six of them kept showing a stat rail that no longer
// existed. Re-running this after a UI change keeps them honest.
//
// Env: NCLD_URL overrides the URL (default http://localhost:8420/?debug=1).
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.NCLD_URL || 'http://localhost:8420/?debug=1';
const OUT = 'docs/screenshots';
const WIDE = { width: 1710, height: 907 };
const STD = { width: 1250, height: 907 };
// Same flags as playwright.config.mjs: headless Chromium needs SwiftShader for
// WebGL2, or the renderer fails to get a context and every shot is black.
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/** @typedef {import('@playwright/test').Page} Page */
/**
 * @typedef {object} Shot
 * @property {string} name  CLI name
 * @property {string} file  output basename (no extension)
 * @property {{width:number,height:number}} size
 * @property {'menu'|'intro'|'run'} [boot]  how far to boot before staging (default 'run')
 * @property {(page: Page) => Promise<void>} stage  arrange the scene; the capture happens after it returns
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a function in the page with the app and debug hooks in scope. A returned
 * promise is NOT awaited: page.evaluate would wait on it, and plenty of game
 * calls resolve only when a scene ends — debug.forceEvent() of an event with a
 * choice waits for the player, and hung the capture forever.
 */
function game(page, fn, arg) {
  return page.evaluate(({ src, arg }) => {
    // eslint-disable-next-line no-new-func
    const f = new Function('app', 'debug', 'arg', `return (${src})(app, debug, arg);`);
    const r = f(window.__ncld.app, window.__ncld.debug, arg);
    return r && typeof r.then === 'function' ? null : r;
  }, { src: fn.toString(), arg });
}

/** Poll a game predicate until it holds (or throw with its label). */
async function until(page, label, fn, arg, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await game(page, fn, arg)) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

/**
 * Boot to the main menu, the opening cutscene, or a settled live run.
 * @param {Page} page @param {'menu'|'intro'|'run'} to
 */
async function boot(page, to) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const newRun = page.getByRole('button', { name: /New Run/i });
  await newRun.waitFor({ state: 'visible', timeout: 30000 });
  if (to === 'menu') { await sleep(4000); return; }   // let the boot scene render behind it
  await newRun.click();
  const begin = page.getByRole('button', { name: /^(Begin|Start|Enter the tower|Start run)/i }).first();
  if (await begin.isVisible().catch(() => false)) await begin.click();
  await page.waitForFunction(() => window.__ncld?.app?.mode === 'run', null, { timeout: 60000 });
  if (to === 'intro') {
    await until(page, 'the opening cutscene', (app) => app.cutscene?.playing === true);
    return;
  }
  // Same settle loop as test/smoke/smoke.spec.mjs: wait for scenarioSettled and
  // keep pressing Escape while the intro plays (a single press races its start).
  for (let i = 0; i < 90; i++) {
    const s = await game(page, (app) => ({
      settled: app.scenarioSettled === true, playing: app.cutscene?.playing === true, paused: app.loop.paused,
    }));
    if (s.settled && !s.playing && !s.paused) { await sleep(1500); return; }
    if (s.playing) await page.keyboard.press('Escape');
    await sleep(500);
  }
  throw new Error('the opening cutscene never released the sim');
}

/** Clear the scheduler so a random world event can't land mid-shot. */
const quiet = (page) => game(page, (app) => { app.scheduler.hold = true; });

/**
 * Raise trust + loyalty until a character reaches a bond tier (debug.setStat
 * goes through the real stat model, so personality receptivity applies).
 */
const bondTo = (page, id, tier) => game(page, (app, debug, { id, tier }) => {
  const order = ['stranger', 'ally', 'trusted', 'loyal'];
  for (let i = 0; i < 40 && order.indexOf(debug.bond(id)) < order.indexOf(tier); i++) {
    debug.setStat(id, { trust: 4, loyalty: 4 });
  }
  return debug.bond(id);
}, { id, tier });

/**
 * Keep the HUD toast up for the capture. It hides itself after 4.2s, and a
 * SwiftShader capture can take longer than that to land.
 */
const holdToast = (page) => page.evaluate(() => {
  const el = document.getElementById('hud-alert');
  if (!el) return;
  new MutationObserver(() => { if (!el.classList.contains('visible')) el.classList.add('visible'); })
    .observe(el, { attributes: true, attributeFilter: ['class'] });
});

/**
 * Turn the first-person eye toward a character: `turn` 1 looks straight at
 * them, 0 keeps the current heading, in between keeps some of the room in frame.
 */
const lookToward = (page, id, turn, pitch) => game(page, (app, debug, { id, turn, pitch }) => {
  const fp = app.cameraRig.fp;
  const t = app.cast[id].actor.root.position;
  const to = Math.atan2(-(t.x - fp.pos.x), -(t.z - fp.pos.z));   // the eye looks down -Z
  const d = Math.atan2(Math.sin(to - fp.yaw), Math.cos(to - fp.yaw));
  fp._targetYaw = fp.yaw = fp.yaw + d * turn;
  fp._targetPitch = fp.pitch = pitch;
}, { id, turn, pitch });

/** @type {Shot[]} */
const SHOTS = [
  {
    name: 'main-menu', file: '01-main-menu', size: WIDE, boot: 'menu',
    stage: async () => {},
  },
  {
    name: 'intro-cutscene', file: '02-intro-cutscene', size: WIDE, boot: 'intro',
    // a few seconds in: the letterbox is down and VOX's first subtitle is up
    stage: async () => { await sleep(7000); },
  },
  {
    name: 'penthouse-lounge', file: '03-penthouse-lounge', size: WIDE,
    stage: async (page) => {
      await quiet(page);
      await game(page, (app) => app.cameraRig.setMode('auto'));
      await sleep(4000);
    },
  },
  {
    name: 'chat-dialogue', file: '04-chat-dialogue', size: WIDE,
    stage: async (page) => {
      await quiet(page);
      await game(page, (app, debug) => debug.say('Lola, how long do you think the doors hold?', 'lola'));
      await sleep(16000);   // the typewriter runs on sim time, which crawls under SwiftShader
    },
  },
  {
    name: 'cast-outfits', file: '05-cast-outfits', size: STD,
    stage: async (page) => {
      await quiet(page);
      await game(page, (app, debug) => {
        // three different wardrobes, grouped in the lounge where the
        // establishing shot frames them; brains held so nobody wanders off
        const spots = { lola: [-4.7, 0.3, 0.6], aria: [-3.3, 0.8, -0.4], kai: [-4.1, 2.1, 2.8] };
        const fits = { lola: 'evening_wear', aria: 'workout', kai: 'street_armor' };
        for (const [id, [x, z, yaw]] of Object.entries(spots)) {
          app.brains[id]?.hold();
          const c = app.cast[id];
          c.queue.clear();
          c.actor.snapTo(x, z, yaw);
          c.queue.zone = 'lounge';
          debug.outfit(id, fits[id]);
        }
        app.cameraRig.setMode('auto');
      });
      await sleep(6000);
    },
  },
  {
    name: 'events-choices', file: '06-events-choices', size: STD,
    stage: async (page) => {
      await game(page, (app, debug) => debug.forceEvent('looter'));
      await page.getByText(/Confront them, or let VOX seal/).waitFor({ state: 'visible', timeout: 30000 });
      await sleep(1200);
    },
  },
  {
    name: 'director-panel', file: '08-director-panel', size: STD,
    stage: async (page) => {
      await quiet(page);
      await game(page, (app) => { app.directorPanel.setOpen(true); app.directorPanel.showTab('cast'); });
      await sleep(2500);
    },
  },
  {
    name: 'combat', file: '09-combat', size: STD,
    stage: async (page) => {
      await game(page, (app, debug) => debug.forceEvent('riot_breach'));
      await until(page, 'hostiles on the floor', (app) => app.combat.active && app.combat.hostiles?.length > 0, null, 45000);
      await sleep(3500);
    },
  },
  {
    name: 'bond-rail', file: '11-bond-rail', size: STD,
    stage: async (page) => {
      await quiet(page);
      await bondTo(page, 'kai', 'ally');
      await bondTo(page, 'lola', 'trusted');
      await sleep(300);
      await holdToast(page);
      await bondTo(page, 'aria', 'loyal');   // last, so its toast is the one on screen
      await sleep(900);
    },
  },
  {
    name: 'bed-together', file: '12-bed-together', size: WIDE,
    stage: async (page) => {
      await quiet(page);
      await bondTo(page, 'aria', 'ally');
      await game(page, (app) => {
        app.bedScene.use();   // sit
        // Start her in the alcove: under SwiftShader the sim crawls, and the
        // real walk over from the bar takes minutes of wall time.
        const a = app.cast.aria;
        a.actor.snapTo(-11.2, 2.6, 0);
        a.queue.zone = 'bed_alcove';
      });
      const r = await game(page, (app) => app.bedScene.invite(app.cast.aria));
      if (!r.ok) throw new Error(`invite refused: ${r.reason}`);
      await until(page, 'Aria seated on the bed', (app) => app.cast.aria.queue.seatedAt === 'bed.seat1', null, 120000);
      await sleep(1500);
      await lookToward(page, 'aria', 0.8, -0.06);
      await sleep(1500);
    },
  },
  {
    name: 'stay-the-night', file: '13-stay-the-night', size: WIDE,
    stage: async (page) => {
      await quiet(page);
      await bondTo(page, 'lola', 'trusted');
      await game(page, (app) => { app.bedScene.use(); });
      // Hold the moment: the real narration clears itself after ~5s and a
      // SwiftShader capture can outlast it. Same DOM as app._narrate, but the
      // line stays and the promise never settles, so the fade stays down.
      await game(page, (app) => {
        app._narrate = (text) => {
          const line = document.createElement('div');
          line.className = 'line narration';
          line.textContent = text;
          document.getElementById('subtitles')?.appendChild(line);
          return new Promise(() => {});
        };
      });
      // not awaited: it never finishes (see above)
      await game(page, (app) => { app.bedScene.stayNight(app.cast.lola); });
      await until(page, 'the narration line', () => !!document.querySelector('#subtitles .narration'), null, 15000);
      await sleep(900);
    },
  },
];

async function capture(browser, shot) {
  const ctx = await browser.newContext({ viewport: shot.size, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await boot(page, shot.boot || 'run');
    await shot.stage(page);
    // Freeze the frame. Under SwiftShader a capture has to wait for a frame to
    // composite, and with the render loop still running that took 20-40s and
    // tripped Playwright's timeout. Stopped, the canvas keeps its last frame and
    // the DOM overlays (HUD, toasts, subtitles) are captured as they stand.
    // The menu boot has no app loop yet, hence the optional chain.
    await page.evaluate(() => window.__ncld?.app?.loop?.stop());
    const png = await page.screenshot({ type: 'png', timeout: 120000 });
    const out = join(OUT, `${shot.file}.jpg`);
    await sharp(png).jpeg({ quality: 82, mozjpeg: true }).toFile(out);
    const kb = Math.round(statSync(out).size / 1024);
    console.log(`  ✓ ${out}  ${shot.size.width}x${shot.size.height}  ${kb}KB${kb > 450 ? '  (over the ~450KB budget)' : ''}`);
    if (errors.length) console.warn(`    page errors:\n      ${errors.join('\n      ')}`);
  } finally {
    await ctx.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const s of SHOTS) console.log(`${s.name.padEnd(18)} → ${OUT}/${s.file}.jpg`);
    return;
  }
  const wanted = args.length
    ? SHOTS.filter((s) => args.includes(s.name) || args.includes(s.file))
    : SHOTS;
  const unknown = args.filter((a) => !SHOTS.some((s) => s.name === a || s.file === a));
  if (unknown.length) throw new Error(`unknown shot(s): ${unknown.join(', ')} — try --list`);

  const res = await fetch(URL).catch(() => null);
  if (!res?.ok) throw new Error(`no server at ${URL} — start one with: node tools/serve.mjs 8420`);

  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: GL_ARGS });
  let failed = 0;
  try {
    for (const shot of wanted) {
      console.log(`${shot.name}`);
      try { await capture(browser, shot); } catch (e) { failed++; console.error(`  ✗ ${shot.name}: ${e instanceof Error ? e.message : e}`); }
    }
  } finally {
    await browser.close();
  }
  if (failed) { console.error(`${failed} shot(s) failed`); process.exitCode = 1; }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
