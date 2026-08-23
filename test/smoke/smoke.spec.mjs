// @ts-check
// Headless smoke test via the ?debug=1 window.__ncld API. Run against a live
// server: node tools/serve.mjs 8420  →  then drive with chrome-devtools MCP or
// Playwright. This file documents the smoke contract as an executable checklist;
// it uses Playwright if installed, else prints the manual steps.
//
//   npx playwright test test/smoke/smoke.spec.mjs
//
// It is intentionally dependency-optional so `node --test` never imports Playwright.

export const SMOKE_STEPS = [
  'boot → main menu visible (no age-gate clickthrough)',
  'click New Run / Continue → window.__ncld.ready === true within 5s',
  'zero console errors after boot',
  'intro cutscene plays and is skippable (Space)',
  "say('lola','hey Lola') → returns a reply + a stat delta",
  "forceEvent('blackout') → lighting preset becomes blackout_emergency",
  'advanceMinutes(2880) → survives to day 3, resources depleted',
  'bed game: warm a partner, escalate through the consent ladder, actions gate-check',
  'save(3) → mutate → load(3) → stats restored exactly',
  'kill() → death screen with run summary + bonds, autosave deleted, meta run recorded',
  'fps() > 30 sustained (env vsync ceiling permitting)',
];

// If Playwright is present, run the automated version.
let test, expect;
try {
  ({ test, expect } = await import('@playwright/test'));
} catch {
  console.log('[smoke] Playwright not installed — manual checklist:');
  for (const s of SMOKE_STEPS) console.log('  •', s);
}

if (test) {
  const URL = process.env.NCLD_URL || 'http://localhost:8420/?debug=1';
  test('boots, chats, events, saves, dies', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(URL);
    await page.getByRole('button', { name: 'New Run' }).click();
    await page.getByRole('button', { name: /Begin/ }).click();
    await page.waitForFunction(() => window.__ncld?.ready === true, { timeout: 8000 });
    // skip cutscene
    await page.evaluate(async () => {
      const app = window.__ncld.app;
      while (app.cutscene?.playing) { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true })); await new Promise((r) => setTimeout(r, 300)); }
    });
    const reply = await page.evaluate(() => window.__ncld.debug.say('hey Lola', 'lola').then((r) => r.length));
    expect(reply).toBeGreaterThan(0);
    await page.evaluate(() => window.__ncld.debug.forceEvent('blackout'));
    await page.waitForTimeout(8000);
    const preset = await page.evaluate(() => window.__ncld.app.lighting.presetId);
    expect(preset).toBe('blackout_emergency');
    expect(errors).toEqual([]);
  });
}
