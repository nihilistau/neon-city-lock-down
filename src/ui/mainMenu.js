// @ts-check
// Main menu, shown over the neon boot scene. Resolves to a
// startRun options object: {resume:true} to continue the autosave, or
// {scenarioId, loadout, resume:false} to begin a fresh run. A Codex view reads
// the persistent meta store.
import { SCENARIOS } from '../../data/scenarios.js';
import { LOADOUTS } from '../../data/items.js';
import { readSlot } from '../core/save.js';
import { meta } from '../sim/meta.js';
import { settings, setSetting } from '../core/settings.js';
import { appearanceBlock, saveAppearance } from './appearance.js';
import { h } from './widgets.js';

/**
 * @param {import('../core/app.js').App} app
 * @returns {Promise<{scenarioId?:string, loadout?:string, resume?:boolean}>}
 */
export function showMainMenu(app) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('overlay');
    const root = document.createElement('div');
    root.className = 'screen mm-root';
    overlay.appendChild(root);
    const done = (opts) => { root.remove(); resolve(opts); };

    const auto = readSlot('auto');

    const mainScreen = () => {
      root.innerHTML = '';
      root.appendChild(h('div', { class: 'panel mm-panel' }, [
        h('div', { class: 'wordmark' }, [
          h('div', { class: 'wm-rule' }),
          h('h1', { class: 'neon-title wm-title' }, ['NEON-CITY']),
          h('h1', { class: 'neon-title wm-title hot' }, ['LOCK-DOWN']),
          h('div', { class: 'wm-rule mag' }),
        ]),
        h('h2', {}, [`welcome back, ${settings.playerName}`]),
        h('div', { class: 'mm-buttons' }, [
          auto ? h('button', { class: 'mm-big', onclick: () => done({ resume: true }) }, [
            'Continue', h('span', { class: 'mm-sub' }, [` — ${auto.meta.label}`])]) : '',
          h('button', { class: 'mm-big', onclick: newGameScreen }, ['New Run']),
          h('button', { class: 'mm-big', onclick: settingsScreen }, ['Settings']),
          h('button', { class: 'mm-big', onclick: codexScreen }, [`Codex (${meta.codex.length})`]),
        ].filter(Boolean)),
        h('div', { class: 'mm-foot' }, [`Runs completed: ${meta.runs.length} · Press K in-game for the codex`]),
      ]));
    };

    let pickScenario = 'first_night';
    let pickLoadout = 'fixer';
    const newGameScreen = () => {
      root.innerHTML = '';
      const look = appearanceBlock({ live: true });
      // Locked scenarios are SHOWN, not hidden. Content the player cannot see
      // cannot motivate them; a locked card with its condition on it can.
      const scenCards = Object.values(SCENARIOS).map((s) => {
        const locked = !!s.requiresUnlock && !meta.unlocks.includes(s.requiresUnlock);
        return h('div', {
          class: `mm-scen ${pickScenario === s.id ? 'sel' : ''}${locked ? ' locked' : ''}`,
          title: locked ? s.unlockHint : '',
          onclick: () => { if (locked) return; pickScenario = s.id; newGameScreen(); },
        }, [
          h('div', { class: 'mm-scen-title' }, [locked ? `🔒 ${s.title}` : s.title]),
          h('div', { class: 'mm-scen-blurb' }, [locked ? (s.unlockHint || 'Locked.') : s.blurb]),
        ]);
      });
      const loadCards = Object.values(LOADOUTS).map((l) =>
        h('div', {
          class: `mm-load ${pickLoadout === l.id ? 'sel' : ''}`,
          onclick: () => { pickLoadout = l.id; newGameScreen(); },
        }, [
          h('div', { class: 'mm-load-name' }, [`${l.icon} ${l.name}`]),
          h('div', { class: 'mm-load-desc' }, [l.desc]),
        ]));

      root.appendChild(h('div', { class: 'panel mm-panel mm-newgame' }, [
        h('h1', { class: 'neon-title', style: 'font-size:24px' }, ['NEW RUN']),
        h('h2', {}, ['your handle']),
        h('div', { class: 'row' }, [
          h('label', { for: 'mm-name' }, ['Handle']),
          h('input', { id: 'mm-name', type: 'text', maxlength: '18', value: settings.playerName, spellcheck: 'false' }),
        ]),
        h('div', { class: 'row' }, [
          h('label', { for: 'mm-pro' }, ['Body']),
          h('select', { id: 'mm-pro' }, [
            h('option', { value: 'she', selected: settings.playerPronouns !== 'he' }, ['Female']),
            h('option', { value: 'he', selected: settings.playerPronouns === 'he' }, ['Male']),
          ]),
        ]),
        look.el,
        h('h2', { style: 'margin-top:18px' }, ['choose a scenario']),
        h('div', { class: 'mm-scen-grid' }, scenCards),
        h('h2', { style: 'margin-top:18px' }, ['choose a loadout']),
        h('div', { class: 'mm-load-grid' }, loadCards),
        h('div', { class: 'actions' }, [
          h('button', { onclick: mainScreen }, ['Back']),
          h('button', { class: 'mm-begin', onclick: () => {
            const nameEl = /** @type {HTMLInputElement} */ (root.querySelector('#mm-name'));
            const proEl = /** @type {HTMLSelectElement} */ (root.querySelector('#mm-pro'));
            setSetting('playerName', (nameEl?.value || '').trim() || 'Cipher');
            setSetting('playerPronouns', proEl?.value || 'she');
            saveAppearance(look.read());
            done({ scenarioId: pickScenario, loadout: pickLoadout, resume: false });
          } }, ['Begin ▸']),
        ]),
      ]));
    };

    const settingsScreen = () => {
      root.innerHTML = '';
      const look = appearanceBlock({ live: true });
      root.appendChild(h('div', { class: 'panel mm-panel mm-newgame' }, [
        h('h1', { class: 'neon-title', style: 'font-size:24px' }, ['SETTINGS']),
        look.el,
        h('p', { class: 'mm-foot' }, ['Look applies on the next New Run. Volumes and the rest live in-game under Esc.']),
        h('div', { class: 'actions' }, [h('button', { onclick: mainScreen }, ['Back'])]),
      ]));
    };

    const codexScreen = () => {
      root.innerHTML = '';
      const entries = meta.codex.length
        ? meta.codex.map((c) => h('div', { class: 'cx-entry' }, [
            h('div', { class: 'cx-title' }, [`◈ ${c.title}`]),
            h('div', { class: 'cx-text' }, [c.text])]))
        : [h('p', {}, ['Nothing discovered yet. Play, explore the tower, and talk to VOX — the codex fills as you uncover the tower\'s secrets.'])];
      root.appendChild(h('div', { class: 'panel mm-panel', style: 'max-height:82vh;overflow-y:auto' }, [
        h('h1', { class: 'neon-title', style: 'font-size:24px' }, ['CODEX']),
        h('h2', {}, [`${meta.codex.length} entries · ${meta.runs.length} runs`]),
        h('div', { class: 'cx-list' }, entries),
        h('div', { class: 'actions' }, [h('button', { onclick: mainScreen }, ['Back'])]),
      ]));
    };

    mainScreen();
  });
}
