// @ts-check
// Boot entry: load editable engine config, then construct the app and go.
import { App } from './core/app.js';
import { loadConfig } from './core/config.js';
import { loadUserContent } from './core/userContent.js';

// Overlay config/*.yaml onto the baked defaults, then register user-authored
// content (scenarios/events/cutscenes/dialogue), before any system reads them.
// Both fail-soft: missing/invalid files are skipped, so the game always boots.
await loadConfig();
await loadUserContent();

const app = new App();
app.start();
