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
      <div class="dir-label">SUBTITLE SIZE</div>
      <div class="dir-row"><input type="range" min="0.7" max="1.6" step="0.1" value="${settings.subtitleScale || 1}" id="st-subs"></div>
    </div>
    <div class="dir-section">
      <div class="dir-label">MOUSE SENSITIVITY (first person)</div>
      <div class="dir-row"><input type="range" min="0.3" max="2.5" step="0.1" value="${settings.mouseSensitivity ?? 1}" id="st-sens"></div>
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
        <button id="st-llm-test">test</button></div>
      <div class="dir-row"><label class="st-check"><input type="checkbox" id="st-llm-agent" ${settings.llm.agentMode ? 'checked' : ''}> agent mode — the LLM writes replies &amp; drives the scene</label></div>
      <div class="dir-row">
        <label style="flex:1">warmth <span id="st-llm-tempv">${settings.llm.temperature}</span>
          <input id="st-llm-temp" type="range" min="0.3" max="1.3" step="0.05" value="${settings.llm.temperature}" style="width:100%"></label>
      </div>
      <p class="dir-hint">served via tools/serve.mjs → LM Studio (key stays server-side). Off = authored dialogue engine.</p>
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
  el.querySelector('#st-subs').addEventListener('input', (e) => setSetting('subtitleScale', Number(e.target.value)));
  el.querySelector('#st-sens').addEventListener('input', (e) => setSetting('mouseSensitivity', Number(e.target.value)));
  const statusEl = el.querySelector('#st-llm-status');
  const showStatus = async (force) => {
    const s = await app.agent.probe(force).then(() => app.agent.client.status(force));
    statusEl.textContent = s.available ? `online · ${s.model}` : `offline${s.reason ? ' (' + s.reason + ')' : ''}`;
    statusEl.style.color = s.available ? 'var(--green)' : 'var(--amber)';
  };
  showStatus(false);
  el.querySelector('#st-llm-on').addEventListener('change', (e) => {
    setSetting('llm.enabled', e.target.checked);
    app.llm.refresh();
    if (e.target.checked) showStatus(true);
  });
  el.querySelector('#st-llm-agent').addEventListener('change', (e) => setSetting('llm.agentMode', e.target.checked));
  el.querySelector('#st-llm-test').addEventListener('click', () => showStatus(true));
  el.querySelector('#st-llm-temp').addEventListener('input', (e) => {
    setSetting('llm.temperature', Number(e.target.value));
    el.querySelector('#st-llm-tempv').textContent = e.target.value;
  });
  el.querySelector('#st-side-on').addEventListener('change', (e) => {
    setSetting('tts.useSidecar', e.target.checked);
  });
  el.querySelector('#st-side-probe').addEventListener('click', async () => {
    const up = await app.sidecar.probe();
    el.querySelector('#st-side-status').textContent = up ? 'online' : 'offline';
  });
}
