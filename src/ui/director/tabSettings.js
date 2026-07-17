// @ts-check
// Settings tab: explicitness cap, audio volumes, LLM adapter, TTS sidecar.
import { settings, setSetting } from '../../core/settings.js';

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
      <div class="dir-label">AUDIO</div>
      ${['master', 'music', 'sfx', 'ambience', 'voice'].map((b) => `
        <div class="dir-row"><span class="st-vlabel">${b}</span>
          <input type="range" min="0" max="1" step="0.05" value="${vol[b]}" data-vol="${b}">
        </div>`).join('')}
    </div>
    <div class="dir-section">
      <div class="dir-label">LLM ADAPTER (optional — rewrites surface text only)</div>
      <div class="dir-row"><label class="st-check"><input type="checkbox" id="st-llm-on" ${settings.llm.enabled ? 'checked' : ''}> enabled</label></div>
      <div class="dir-row"><input id="st-llm-url" type="text" placeholder="base url" value="${settings.llm.baseUrl}" style="flex:1"></div>
      <div class="dir-row">
        <input id="st-llm-model" type="text" placeholder="model" value="${settings.llm.model}" style="flex:1">
        <input id="st-llm-key" type="password" placeholder="api key (optional)" value="${settings.llm.apiKey}" style="flex:1">
      </div>
    </div>
    <div class="dir-section">
      <div class="dir-label">LIVE TTS SIDECAR — <span id="st-side-status">${app.sidecar.healthy ? 'online' : 'offline'}</span></div>
      <div class="dir-row">
        <label class="st-check"><input type="checkbox" id="st-side-on" ${settings.tts.useSidecar ? 'checked' : ''}> use when available</label>
        <button id="st-side-probe">probe</button>
      </div>
      <p class="dir-hint">run: node tools/sidecar.mjs — voices dynamic lines through voxtral</p>
    </div>`;

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
  el.querySelector('#st-llm-on').addEventListener('change', (e) => {
    setSetting('llm.enabled', e.target.checked);
    app.llm.refresh();
  });
  for (const [id, path] of [['st-llm-url', 'llm.baseUrl'], ['st-llm-model', 'llm.model'], ['st-llm-key', 'llm.apiKey']]) {
    const input = el.querySelector('#' + id);
    input.addEventListener('change', () => { setSetting(path, input.value.trim()); app.llm.refresh(); });
    input.addEventListener('keydown', (e) => e.stopPropagation());
  }
  el.querySelector('#st-side-on').addEventListener('change', (e) => {
    setSetting('tts.useSidecar', e.target.checked);
  });
  el.querySelector('#st-side-probe').addEventListener('click', async () => {
    const up = await app.sidecar.probe();
    el.querySelector('#st-side-status').textContent = up ? 'online' : 'offline';
  });
}
