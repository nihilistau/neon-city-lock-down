// @ts-check
// Boot entry: load editable engine config, then construct the app and go.
import { App } from './core/app.js';
import { loadConfig } from './core/config.js';

// Overlay config/*.yaml onto the baked defaults before any system reads cfg().
// Fail-soft: missing/invalid files keep defaults, so the game always boots.
await loadConfig();

const app = new App();
app.start();
