// @ts-check
// Settings tab: explicitness cap, audio volumes, LLM adapter, TTS sidecar.
import { settings, setSetting } from '../../core/settings.js';
import { appearanceBlock } from '../appearance.js';

/** @param {HTMLElement} el @param {import('../../core/app.js').App} app */
export function tabSettings(el, app) {
  const vol = settings.volumes;
  el.innerHTML = `
    <div class="dir-section">
      <div class="dir-label">EXPLICITNESS CAP</div>
      <div class="dir-row" id="st-exp">
        ${['suggestive', 'mature', 'full'].map((x) =>
          `<button data-exp="${x}" class="${settings.explicitness === x ? 'active' : ''}">${x}</button>`).join('')}
      </div>
    </div>
    <div class="dir-section">
      <div class="dir-label">SUBTITLE SIZE</div>
      <div class="dir-row"><input type="range" min="0.7" max="1.6" step="0.1" value="${settings.subtitleScale || 1}" id="st-subs"></div>
    </div>
    <div class="dir-section">
      <div class="dir-label">MOUSE SENSITIVITY (first person)</div>
      <div class="dir-row"><input type="range" min="0.3" max="2.5" step="0.1" value="${settings.mouseSensitivity ?? 1}" id="st-sens"></div>
    </div>
    <div class="dir-section">
      <div class="dir-label">CAMERA</div>
      <div class="dir-row"><label class="st-check"><input type="checkbox" id="st-autocam" ${settings.autoCamera ? 'checked' : ''}> cinematic auto-camera (frames combat / dialogue / events)</label></div>
      <p class="dir-hint">C cycles: auto → free orbit → first person. Any manual mode pauses the auto-director.</p>
    </div>
    <div class="dir-section">
      <div class="dir-label">AUDIO</div>
      ${['master', 'music', 'sfx', 'ambience', 'voice'].map((b) => `
        <div class="dir-row"><span class="st-vlabel">${b}</span>
          <input type="range" min="0" max="1" step="0.05" value="${vol[b]}" data-vol="${b}">
        </div>`).join('')}
    </div>
    <div class="dir-section">
      <div class="dir-label">LLM CHARACTERS — <span id="st-llm-status">checking…</span></div>
      <div class="dir-row"><label class="st-check"><input type="checkbox" id="st-llm-on" ${settings.llm.enabled ? 'checked' : ''}> enabled</label>
        <button id="st-llm-test">test</button>
        <button id="st-llm-open" class="clickable">⚙ Models &amp; per-character…</button></div>
      <p class="dir-hint">Open the LLM Engine panel (or press <b>L</b>) to pick models, set each character's interaction (agent / rewrite / authored), and toggle thinking.</p>
    </div>
    <div class="dir-section">
      <div class="dir-label">LIVE TTS SIDECAR — <span id="st-side-status">${app.sidecar.healthy ? 'online' : 'offline'}</span></div>
      <div class="dir-row">
        <label class="st-check"><input type="checkbox" id="st-side-on" ${settings.tts.useSidecar ? 'checked' : ''}> use when available</label>
        <button id="st-side-probe">probe</button>
      </div>
      <p class="dir-hint">run: node tools/sidecar.mjs — voices dynamic lines through voxtral</p>
    </div>`;

  const look = appearanceBlock({ live: true });
  look.el.classList.add('dir-section');
  const lookHint = document.createElement('p');
  lookHint.className = 'dir-hint';
  lookHint.textContent = 'Look applies on the next New Run.';
  look.el.appendChild(lookHint);
  el.insertBefore(look.el, el.firstChild);

  el.querySelector('#st-exp').addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target);
    if (!btn.dataset?.exp) return;
    setSetting('explicitness', btn.dataset.exp);
    globalThis.__ncldExplicitness = btn.dataset.exp;
    el.querySelectorAll('[data-exp]').forEach((b) => b.classList.toggle('active', b === btn));
  });
  el.querySelectorAll('[data-vol]').forEach((input) => {
    input.addEventListener('input', () => {
      setSetting(`volumes.${input.dataset.vol}`, Number(input.value));
    });
  });
  el.querySelector('#st-subs').addEventListener('input', (e) => setSetting('subtitleScale', Number(e.target.value)));
  el.querySelector('#st-sens').addEventListener('input', (e) => setSetting('mouseSensitivity', Number(e.target.value)));
  el.querySelector('#st-autocam').addEventListener('change', (e) => {
    setSetting('autoCamera', e.target.checked);
    if (e.target.checked) app.cameraRig.setMode('auto');
    else if (app.cameraRig.mode === 'auto') app.cameraRig.setMode('director');
  });
  const statusEl = el.querySelector('#st-llm-status');
  const showStatus = async (force) => {
    const s = await app.agent.info(force);
    const online = s.available !== false && s.model;
    statusEl.textContent = online ? `online · ${s.mode} · ${s.model}` : 'offline';
    statusEl.style.color = online ? 'var(--green)' : 'var(--amber)';
  };
  showStatus(false);
  el.querySelector('#st-llm-on').addEventListener('change', (e) => {
    setSetting('llm.enabled', e.target.checked);
    app.llm.refresh();
    if (e.target.checked) showStatus(true);
  });
  el.querySelector('#st-llm-test').addEventListener('click', () => showStatus(true));
  el.querySelector('#st-llm-open').addEventListener('click', () => { app.directorPanel?.close?.(); app.llmPanel.show(); });
  el.querySelector('#st-side-on').addEventListener('change', (e) => {
    setSetting('tts.useSidecar', e.target.checked);
  });
  el.querySelector('#st-side-probe').addEventListener('click', async () => {
    const up = await app.sidecar.probe();
    el.querySelector('#st-side-status').textContent = up ? 'online' : 'offline';
  });
}
