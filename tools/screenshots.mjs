// @ts-check
// Capture the README / docs screenshots from the real game. DEV-TIME ONLY —
// needs the dev dependencies (@playwright/test, sharp) and a running server.
//
//   node tools/serve.mjs 8420            # in another terminal
//   node tools/screenshots.mjs           # every shot
//   node tools/screenshots.mjs bond-rail bed-together   # just these
//   node tools/screenshots.mjs --list    # names only
//   node tools/screenshots.mjs --out docs/screenshots/v0.6 bar   # somewhere else
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
 * @property {(page: Page, size: {width:number,height:number}) => Promise<Buffer>} [grab]
 *   custom capture returning a PNG at `size` (default: a full-viewport screenshot)
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
  // Quiet the world the moment the run exists, not after the settle: in a batch,
  // a dinner beat or world event fired during the settle took the camera, and
  // the director shots came out as the lounge's auto camera. The scheduler is
  // built a few lines after mode flips to 'run', so wait for it first.
  await until(page, 'the scheduler', (app) => !!app.scheduler);
  await quiet(page);
  // Same settle loop as test/smoke/smoke.spec.mjs: wait for scenarioSettled and
  // keep pressing Escape while the intro plays (a single press races its start).
  for (let i = 0; i < 90; i++) {
    const s = await game(page, (app) => ({
      settled: app.scenarioSettled === true, playing: app.cutscene?.playing === true, paused: app.loop.paused,
    }));
    if (s.settled && !s.playing && !s.paused) {
      // the clock chip is filled by the first world.minute; a shot that pauses
      // the sim straight away (an event choice) could otherwise catch it empty
      await until(page, 'the HUD clock', () => !!document.getElementById('hud-clock')?.textContent, null, 20000);
      await sleep(1500);
      return;
    }
    if (s.playing) await page.keyboard.press('Escape');
    await sleep(500);
  }
  throw new Error('the opening cutscene never released the sim');
}

/**
 * Keep the world still for the shot: no random world event (scheduler held)
 * and no scripted daily beat. The beats (dinner, sleep, …) are separate from
 * the scheduler; a dinner cutscene at 18:00 once took the camera mid-shot and
 * handed it back in a different mode.
 */
const quiet = (page) => game(page, (app) => { app.scheduler.hold = true; app._beatPlayable = () => false; });

/**
 * Frame a director-camera shot and make sure it is still framed at capture
 * time. Anything that plays a cutscene hands the camera back in another mode;
 * like the two-shot guard, check after settling — but re-stage once (after
 * ending the cutscene) before giving up, since a stray beat is transient.
 * @param {Page} page @param {(app: any) => void} frame @param {number} settleMs
 */
async function directorShot(page, frame, settleMs) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await quiet(page);
    await game(page, frame);
    await sleep(settleMs);
    const s = await game(page, (app) => ({ mode: app.cameraRig.mode, playing: app.cutscene?.playing === true }));
    if (s.mode === 'director' && !s.playing) return;
    console.warn(`  (camera left the director shot: mode ${s.mode}, cutscene ${s.playing}; re-staging)`);
    for (let i = 0; i < 20 && (await game(page, (app) => app.cutscene?.playing === true)); i++) {
      await page.keyboard.press('Escape');
      await sleep(500);
    }
  }
  throw new Error('the camera would not stay on the director shot');
}

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
  // no fade-in: under SwiftShader the 0.3s opacity transition had not left 0
  // by capture time, so the toast was "visible" in the DOM and blank on screen
  el.style.transition = 'none';
  new MutationObserver(() => { if (!el.classList.contains('visible')) el.classList.add('visible'); })
    .observe(el, { attributes: true, attributeFilter: ['class'] });
});

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
      // The picture is the rail and the toast. Kai's lounge outfit (top over
      // leggings) left a band of skin at the hip that read as missing clothes
      // from this angle, so he waits out of frame.
      await game(page, (app) => {
        app.brains.kai?.hold();
        app.cast.kai.queue.clear();
        app.cast.kai.actor.snapTo(2.6, 0.4, 0);
      });
      await bondTo(page, 'kai', 'ally');
      await bondTo(page, 'lola', 'trusted');
      await sleep(300);
      await holdToast(page);
      await bondTo(page, 'aria', 'loyal');   // last, so its toast is the one on screen
      await sleep(900);
      // the auto camera re-frames once Kai has gone; let it settle (the toast is held)
      await sleep(5000);
    },
  },
  {
    name: 'bed-together', file: '12-bed-together', size: STD,
    stage: async (page) => {
      await quiet(page);
      await bondTo(page, 'aria', 'ally');
      await game(page, (app) => {
        app.bedScene.use();   // sit — the real E-on-the-bed path (first person at bed.seat0)
        // Start her in the alcove: under SwiftShader the sim crawls, and the
        // real walk over from the bar takes minutes of wall time.
        const a = app.cast.aria;
        a.actor.snapTo(-11.2, 2.6, 0);
        a.queue.zone = 'bed_alcove';
      });
      const r = await game(page, (app) => app.bedScene.invite(app.cast.aria));
      if (!r.ok) throw new Error(`invite refused: ${r.reason}`);
      await until(page, 'Aria seated on the bed',
        (app) => app.cast.aria.queue.seatedAt === 'bed.seat1' && !app.cast.aria.queue.busy, null, 120000);
      // In play you see this in first person: the guest beside you, out of
      // frame. For a picture of BOTH of you, cut to a cinematic camera (the one
      // non-first-person mode that doesn't get you off the bed) and sit the
      // player's body on seat0 exactly the way ActorQueue seats a character.
      await page.evaluate(async () => {
        const app = window.__ncld.app;
        const { seatClip, seatRootY } = await import('/src/sim/actors/actorQueue.js');
        app.cameraRig.setMode('cinematic');
        const cam = app.stage.camera;
        const sock = app.world.getSocket('bed.seat0');
        const w = sock.getWorldPosition(cam.position.clone());
        const yaw = cam.rotation.clone().setFromQuaternion(sock.getWorldQuaternion(cam.quaternion.clone()), 'YXZ').y;
        const body = app.playerActor;
        const clip = seatClip('bed.seat0');
        body.root.position.set(w.x, seatRootY(w.y, clip), w.z);
        body.faceYaw(yaw + Math.PI);
        body.playClip(clip, 0.1);
        // nothing ticks the body in cinematic mode — settle the pose here
        for (let i = 0; i < 30; i++) body.update(0.1);
        // three-quarter view from the foot of the alcove, both seats in frame
        cam.position.set(-10.4, 2.2, 5.6);
        cam.lookAt(-12.1, 0.7, 4.1);
        cam.updateMatrixWorld();
      });
      await sleep(2000);
      const mode = await game(page, (app) => app.cameraRig.mode);
      if (mode !== 'cinematic') throw new Error(`the camera left the two-shot (mode ${mode})`);
      // "[E] Lie down" is re-announced on every bed state change and lands on
      // the player's chest in this framing; hide it for the picture only
      await page.evaluate(() => { const p = document.getElementById('hud-prompt'); if (p) p.style.visibility = 'hidden'; });
    },
  },
  {
    name: 'stay-the-night', file: '13-stay-the-night', size: STD,
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
      await until(page, 'the fade fully down',
        () => getComputedStyle(document.getElementById('fade')).opacity === '1', null, 15000);
      await sleep(600);
    },
    // Everything but the one line is the fade's flat black, and in the full
    // frame the line is a thin strip at the bottom. Frame it instead: the
    // line's own pixels, magnified, centred on the same black. The zoom is CSS
    // zoom on the subtitle strip, applied only now: a 2x deviceScaleFactor
    // context made the boot too slow to click through under SwiftShader, and a
    // late CDP metrics override is undone by Playwright's own emulation.
    grab: async (page, size) => {
      await page.evaluate(() => { const st = document.getElementById('subtitles'); if (st) st.style.zoom = '1.6'; });   // one line, still large
      await sleep(300);
      const line = await page.locator('#subtitles .narration').screenshot({ timeout: 120000, scale: 'device' });
      const meta = await sharp(line).metadata();
      const w = Math.min(meta.width ?? 0, size.width - 80);
      const fitted = w < (meta.width ?? 0) ? await sharp(line).resize({ width: w }).toBuffer() : line;
      const fm = await sharp(fitted).metadata();
      return sharp({ create: { width: size.width, height: size.height, channels: 3, background: '#000000' } })
        .composite([{ input: fitted,
          left: Math.round((size.width - (fm.width ?? 0)) / 2),
          top: Math.round((size.height - (fm.height ?? 0)) / 2) }])
        .png().toBuffer();
    },
  },
  {
    // v0.7 before/after pairs: the bar is marble, metal and wood — the three
    // surfaces the PBR pass changes most
    name: 'bar', file: '14-bar', size: WIDE,
    stage: async (page) => {
      await directorShot(page, (app) => {
        app.cameraRig.setMode('director');
        app.cameraRig.orbit.maxDistance = 60;
        app.cameraRig.orbit.target.set(4.6, 1.05, -4.6);
        app.stage.camera.position.set(1.4, 1.75, -0.9);
        app.cameraRig.orbit.update();
      }, 3000);
    },
  },
  {
    name: 'rooftop', file: '15-rooftop', size: WIDE,
    stage: async (page) => {
      await directorShot(page, (app) => {
        if (app.world.activeFloor !== 'rooftop') app.setFloor('rooftop');
        app.cameraRig.setMode('director');
        app.cameraRig.orbit.maxDistance = 60;
        app.cameraRig.orbit.target.set(203, 0.8, 0.5);    // rooftop floor offset is x+200
        app.stage.camera.position.set(193.5, 4.2, 7.2);
        app.cameraRig.orbit.update();
      }, 4000);
    },
  },
  {
    // through the curtain wall: skyline, towers, rain
    name: 'exterior', file: '16-exterior', size: WIDE,
    stage: async (page) => {
      await directorShot(page, (app) => {
        app.cameraRig.setMode('director');
        app.cameraRig.orbit.maxDistance = 60;
        app.cameraRig.orbit.target.set(3, 3.5, 30);
        app.stage.camera.position.set(2.2, 1.7, 6.4);
        app.cameraRig.orbit.update();
      }, 4000);
    },
  },
  {
    name: 'extraction-victory', file: '10-extraction-victory', size: STD,
    stage: async (page) => {
      await quiet(page);
      await bondTo(page, 'lola', 'trusted');
      await bondTo(page, 'aria', 'ally');
      // the real end-of-run path: src/sim/death.js endRun → run.death → the summary screen
      await page.evaluate(async () => {
        const { endRun } = await import('/src/sim/death.js');
        endRun(window.__ncld.app, 'extracted');
      });
      await page.locator('#ds-again').waitFor({ state: 'visible', timeout: 30000 });
      await sleep(1200);
    },
  },
];

async function capture(browser, shot, outDir = OUT) {
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
    const png = shot.grab
      ? await shot.grab(page, shot.size)
      : await page.screenshot({ type: 'png', timeout: 120000 });
    const out = join(outDir, `${shot.file}.jpg`);
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
  // `--out <dir>` writes somewhere other than docs/screenshots — used for the
  // v0.6 "before" set the README's before/after pairs compare against
  const outAt = args.indexOf('--out');
  const outDir = outAt >= 0 ? args[outAt + 1] : OUT;
  if (outAt >= 0 && !outDir) throw new Error('--out needs a directory');
  const names = outAt >= 0 ? args.filter((_, i) => i !== outAt && i !== outAt + 1) : args;
  const wanted = names.length
    ? SHOTS.filter((s) => names.includes(s.name) || names.includes(s.file))
    : SHOTS;
  const unknown = names.filter((a) => !SHOTS.some((s) => s.name === a || s.file === a));
  if (unknown.length) throw new Error(`unknown shot(s): ${unknown.join(', ')} — try --list`);

  const res = await fetch(URL).catch(() => null);
  if (!res?.ok) throw new Error(`no server at ${URL} — start one with: node tools/serve.mjs 8420`);

  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: GL_ARGS });
  let failed = 0;
  try {
    for (const shot of wanted) {
      console.log(`${shot.name}`);
      try { await capture(browser, shot, outDir); } catch (e) { failed++; console.error(`  ✗ ${shot.name}: ${e instanceof Error ? e.message : e}`); }
    }
  } finally {
    await browser.close();
  }
  if (failed) { console.error(`${failed} shot(s) failed`); process.exitCode = 1; }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
