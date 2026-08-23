// @ts-check
// 18+ entry gate. First boot: the age + content confirmation. Later boots: a
// quick enter screen. The click is also the user gesture that unlocks the
// AudioContext (see docs/systems/scene-audio-ui.md) — the browser will not start
// WebAudio without one, so this screen is load-bearing beyond compliance.
//
// Identity (handle / pronouns / appearance) deliberately does NOT live here: the
// New Run screen owns it (src/ui/mainMenu.js + src/ui/appearance.js). The gate
// asks one question and gets out of the way.
import { settings, setSetting, saveSettings } from '../core/settings.js';
import { h } from './widgets.js';

/**
 * Show the gate; resolves when the player has confirmed and entered.
 * @returns {Promise<void>}
 */
export function showGate18() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('overlay');
    const first = !settings.confirmed18;

    const root = document.createElement('div');
    root.className = 'screen mm-root';

    const wordmark = () => h('div', { class: 'wordmark' }, [
      h('div', { class: 'wm-rule' }),
      h('h1', { class: 'neon-title wm-title' }, ['NEON-CITY']),
      h('h1', { class: 'neon-title wm-title hot' }, ['LOCK-DOWN']),
      h('div', { class: 'wm-rule mag' }),
    ]);

    const enter = () => {
      if (first) setSetting('confirmed18', true);
      saveSettings();
      root.remove();
      resolve();
    };

    const leave = () => {
      root.innerHTML = '';
      root.appendChild(h('div', { class: 'panel mm-panel' }, [
        h('h1', { class: 'neon-title' }, ['STAY SAFE']),
        h('p', {}, ["Neon-City will still be here when you're older. You can close this tab."]),
      ]));
    };

    root.appendChild(h('div', { class: 'panel mm-panel gate-panel' }, first ? [
      wordmark(),
      h('h2', {}, ['an adults-only neon-noir roleplay']),
      h('p', { class: 'gate-body' }, [
        'This game contains adult themes, strong language, violence, and consensual ',
        'sexual content between fictional adult characters.',
      ]),
      h('p', { class: 'gate-body' }, [
        'By entering you confirm you are at least ',
        h('b', { class: 'gate-age' }, ['18 years old']),
        ' and wish to view this content.',
      ]),
      h('div', { class: 'mm-buttons' }, [
        h('button', { class: 'mm-big', onclick: enter }, ['I am 18 or older — enter']),
        h('button', { class: 'mm-big danger', onclick: leave }, ["I'm under 18 — leave"]),
      ]),
      h('div', { class: 'mm-foot' }, ['You can set your handle and appearance on the next screen.']),
    ] : [
      wordmark(),
      h('h2', {}, ['an adults-only neon-noir roleplay']),
      h('p', { class: 'gate-body' }, [
        'Lockdown continues, ',
        h('b', { class: 'gate-age' }, [settings.playerName]),
        '. The tower remembers you.',
      ]),
      h('div', { class: 'mm-buttons' }, [
        h('button', { class: 'mm-big', onclick: enter }, ['Enter the city']),
      ]),
    ]));

    overlay.appendChild(root);
    // keyboard parity: Enter/Space confirm, so the gate is not mouse-only
    root.querySelector('button')?.focus();
  });
}
