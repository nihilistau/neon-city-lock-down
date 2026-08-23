// @ts-check
// Playwright config. DEV-ONLY — `node --test` never touches this, and the game
// itself still needs no dependencies at all: `clone && node tools/serve.mjs`.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/smoke',
  testMatch: '**/*.spec.mjs',
  // The game boots a WebGL scene, builds seven floors and precompiles their
  // shaders; a 30s default is not enough headroom on a cold cache.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,          // one server, one save-slot namespace
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: 'http://localhost:8420',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: {
        // Headless Chromium falls back to SwiftShader for WebGL2; without these
        // the renderer silently fails to acquire a context and every test dies
        // at boot for a reason that looks like a game bug.
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      },
    },
  }],
  webServer: {
    command: 'node tools/serve.mjs 8420',
    url: 'http://localhost:8420/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
