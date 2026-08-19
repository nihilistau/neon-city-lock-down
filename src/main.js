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
// startRun() is long and async — an unhandled rejection here used to surface only
// in the console, behind a black screen. Say something on the page instead.
app.start().catch((err) => {
  console.error('[boot] start failed', err);
  const overlay = document.getElementById('overlay') || document.body;
  const el = document.createElement('div');
  el.className = 'screen';
  el.style.background = 'rgba(4,5,9,0.96)';
  el.innerHTML = `
    <div class="panel" style="max-width:560px">
      <h1 class="neon-title" style="font-size:22px">LOCKDOWN FAILED TO START</h1>
      <h2>the tower didn't come up</h2>
      <p style="white-space:pre-wrap;font-size:12px;opacity:.85">${String(err?.stack || err)
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>
      <p style="font-size:12px;opacity:.7">Open the browser console for the full trace, then reload.</p>
    </div>`;
  overlay.appendChild(el);
});
