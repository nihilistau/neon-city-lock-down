// @ts-check
// Director panel shell: right-side drawer, 8 tabs (3 live in the slice), and
// the activity feed. Toggle with ` (backquote) or the ◈ button.
import { on } from '../../core/bus.js';
import { feedEntries } from '../../core/log.js';
import { tabScene } from './tabScene.js';
import { tabDialog } from './tabDialog.js';
import { tabSettings } from './tabSettings.js';
import { tabActions } from './tabActions.js';
import { tabGames } from './tabGames.js';
import { tabCast } from './tabCast.js';
import { tabScenario } from './tabScenario.js';
import { tabWorld } from './tabWorld.js';

const TABS = [
  { id: 'scene', label: 'Scene', build: tabScene },
  { id: 'cast', label: 'Cast', build: tabCast },
  { id: 'dialog', label: 'Dialog', build: tabDialog },
  { id: 'actions', label: 'Actions', build: tabActions },
  { id: 'scenario', label: 'Scenario', build: tabScenario },
  { id: 'world', label: 'World', build: tabWorld },
  { id: 'games', label: 'Games', build: tabGames },
  { id: 'settings', label: 'Settings', build: tabSettings },
];

export class DirectorPanel {
  /** @param {import('../../core/app.js').App} app */
  constructor(app) {
    this.app = app;
    this.open = false;
    this.activeTab = 'scene';
    this.root = document.getElementById('director');
    this.root.innerHTML = `
      <button id="dir-toggle" class="clickable" title="Director panel (\`)">◈</button>
      <div id="dir-drawer" class="clickable hidden">
        <div id="dir-tabs">${TABS.map((t) =>
          `<button class="dir-tab" data-tab="${t.id}">${t.label}</button>`).join('')}</div>
        <div id="dir-body"></div>
        <div id="dir-feed"><div class="dir-feed-title">ACTIVITY</div><div id="dir-feed-list"></div></div>
      </div>`;

    this.drawer = this.root.querySelector('#dir-drawer');
    this.body = this.root.querySelector('#dir-body');
    this.feedList = this.root.querySelector('#dir-feed-list');

    this.root.querySelector('#dir-toggle').addEventListener('click', () => this.toggle());
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' && !(e.target instanceof HTMLInputElement)
          && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        this.toggle();
      }
    });
    this.root.querySelector('#dir-tabs').addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target);
      if (btn.dataset?.tab) this.showTab(btn.dataset.tab);
    });

    for (const entry of feedEntries.slice(-30)) this._feedRow(entry);
    on('feed.entry', (entry) => this._feedRow(entry));
  }

  toggle() {
    this.open = !this.open;
    this.drawer.classList.toggle('hidden', !this.open);
    if (this.open) this.showTab(this.activeTab);
  }

  showTab(id) {
    this.activeTab = id;
    for (const btn of this.root.querySelectorAll('.dir-tab')) {
      btn.classList.toggle('active', btn.dataset.tab === id);
    }
    const tab = TABS.find((t) => t.id === id);
    this.body.innerHTML = '';
    if (tab?.build) {
      tab.build(this.body, this.app);
    } else {
      this.body.innerHTML = `<div class="dir-stub">「 ${tab.label} 」<br>arrives in a later build phase</div>`;
    }
  }

  _feedRow(entry) {
    const div = document.createElement('div');
    div.className = `dir-feed-row kind-${entry.kind}`;
    div.textContent = entry.text;
    this.feedList.appendChild(div);
    while (this.feedList.children.length > 40) this.feedList.firstChild.remove();
    this.feedList.scrollTop = this.feedList.scrollHeight;
  }
}
