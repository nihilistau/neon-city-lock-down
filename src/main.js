// @ts-check
// Boot entry: load editable engine config, then construct the app and go.
import { App } from './core/app.js';
import { loadConfig } from './core/config.js';
import { loadUserContent } from './core/userContent.js';

// Overlay config/*.yaml onto the baked defaults, then register user-authored
// content (scenarios/events/cutscenes/dialogue), before any system reads them.
// Both fail-soft: missing/invalid files are skipped, so the game always boots —
// and even a hard failure here must never block boot (defaults stand).
try { await loadConfig(); } catch (e) { console.warn('[boot] config load failed, using defaults', e); }
try { await loadUserContent(); } catch (e) { console.warn('[boot] user content load failed', e); }

const app = new App();
app.start();
