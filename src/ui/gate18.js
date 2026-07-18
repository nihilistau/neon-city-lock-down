// @ts-check
// 18+ entry gate + player identity. First boot: full confirmation + name/pronouns.
// Later boots: quick enter screen (the click also unlocks the AudioContext).
import { settings, setSetting, saveSettings } from '../core/settings.js';

/**
 * Show the gate; resolves when the player has confirmed and entered.
 * @returns {Promise<void>}
 */
export function showGate18() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('overlay');
    const first = !settings.confirmed18;

    const screen = document.createElement('div');
    screen.className = 'screen';
    screen.innerHTML = `
      <div class="panel">
        <h1 class="neon-title">NEON-CITY<span class="hot"> LOCK-DOWN</span></h1>
        <h2>an adults-only neon-noir roleplay</h2>
        ${first ? `
        <p>This game contains adult themes, strong language, violence, and consensual
           sexual content between fictional adult characters. It is intended for
           players aged <b style="color:var(--cyan)">18 or older</b>.</p>
        <p>By entering you confirm you are at least 18 years old and wish to view
           this content.</p>
        <div class="row"><label for="g18-name">Handle</label>
          <input id="g18-name" type="text" maxlength="18" value="${settings.playerName}" spellcheck="false"></div>
        <div class="row"><label for="g18-pro">Gender</label>
          <select id="g18-pro">
            <option value="she" ${settings.playerPronouns !== 'he' ? 'selected' : ''}>Female</option>
            <option value="he" ${settings.playerPronouns === 'he' ? 'selected' : ''}>Male</option>
          </select></div>
        <div class="actions">
          <button id="g18-leave" class="danger">I'm under 18 — leave</button>
          <button id="g18-enter">I am 18+ — enter the city</button>
        </div>` : `
        <p>Lockdown continues, <b style="color:var(--cyan)">${settings.playerName}</b>.
           The tower remembers you.</p>
        <div class="actions">
          <button id="g18-enter">Enter</button>
        </div>`}
      </div>`;
    overlay.appendChild(screen);

    screen.querySelector('#g18-enter').addEventListener('click', () => {
      if (first) {
        const name = /** @type {HTMLInputElement} */ (screen.querySelector('#g18-name')).value.trim();
        const pro = /** @type {HTMLSelectElement} */ (screen.querySelector('#g18-pro')).value;
        setSetting('playerName', name || 'Cipher');
        setSetting('playerPronouns', pro);
        setSetting('confirmed18', true);
      }
      saveSettings();
      screen.remove();
      resolve();
    });

    const leave = screen.querySelector('#g18-leave');
    if (leave) leave.addEventListener('click', () => {
      screen.querySelector('.panel').innerHTML =
        `<h1 class="neon-title">STAY SAFE</h1>
         <p>Neon-City will still be here when you're older. Close this tab.</p>`;
    });
  });
}
