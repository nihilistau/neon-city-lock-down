// @ts-check
// Day-plan panel (press P). Spend the day's action points on repairs, fortifying,
// foraging, training, resting, or faction deals; track mid-run objectives. This
// is the active decision layer between events.
import { DAY_ACTIONS, canAct, performAction } from '../sim/dayPlan.js';
import { jobDest } from '../sim/jobs.js';
import { objectiveState } from '../sim/objectives.js';
import { on, emit } from '../core/bus.js';
import { h } from './widgets.js';
import { iconUrl } from './icons.js';
import { openModal, closeModal } from './modalStack.js';

export class PlanPanel {
  /** @param {import('../core/app.js').App} app */
  constructor(app) {
    this.app = app;
    this.open = false;
    this.el = null;
    this._last = '';
    this.rng = app.rng.stream('dayplan');
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && this.app.mode === 'run'
          && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) {
        this.toggle();
      }
    });
    on('dayplan.reset', () => { if (this.open) this._render(); });
  }

  toggle() { this.open ? this.close() : this.show(); }
  close() { this.open = false; this.el?.remove(); this.el = null; this.app.loop.resume('plan'); closeModal('plan'); }
  show() { this.open = true; this.app.loop.pause('plan'); openModal('plan', () => this.close()); this._render(); }

  async _act(id) {
    this.close();
    const r = this.app.startJob
      ? await this.app.startJob(id)
      : performAction(this.app.run, id, this.rng);
    this._last = r.msg;
    emit('hud.alert', { text: r.msg, kind: r.ok ? 'info' : 'warn' });
  }

  _render() {
    const overlay = document.getElementById('overlay');
    if (this.el) this.el.remove();
    const run = this.app.run;
    const clock = { day: this.app.clock.day, totalMinutes: this.app.clock.totalMinutes };
    const ap = run.dayPlan?.ap ?? 0, apMax = run.dayPlan?.apMax ?? 4;

    const actions = DAY_ACTIONS.map((a) => {
      const ok = canAct(run, a.id);
      const dest = jobDest(a.id);
      return h('button', { class: `plan-act ${ok ? '' : 'disabled'}`, disabled: !ok, onclick: () => this._act(a.id) }, [
        h('span', { class: 'plan-act-name' }, [a.label, h('em', {}, [` ${a.ap} AP`])]),
        h('span', { class: 'plan-act-hint' }, [a.hint, dest ? ` · ${dest.label}` : '']),
      ]);
    });

    const objs = objectiveState(run, clock).map((o) => h('div', { class: `plan-obj ${o.complete ? 'done' : ''}` }, [
      h('div', { class: 'plan-obj-top' }, [`${o.complete ? '✔ ' : ''}${o.title}`, h('span', {}, [`${Math.round(o.progress * 100)}%`])]),
      h('div', { class: 'plan-obj-desc' }, [o.desc]),
      h('div', { class: 'plan-bar' }, [h('i', { style: `width:${Math.round(o.progress * 100)}%` }, [])]),
    ]));

    const sys = Object.entries(run.systems).map(([k, s]) =>
      h('span', { class: `plan-sys ${s.online ? '' : 'off'}` }, [`${k} ${Math.round(s.hp)}%`]));

    const el = h('div', { class: 'plan-wrap' }, [
      h('div', { class: 'plan-scrim', onclick: () => this.close() }),
      h('div', { class: 'plan-drawer clickable' }, [
        h('div', { class: 'game-head' }, [
          h('h1', { class: 'neon-title plan-title' }, [
            h('img', { class: 'chip-ico', src: iconUrl('plan'), alt: '' }),
            ` DAY ${clock.day}`,
          ]),
          h('button', { onclick: () => this.close() }, ['Close (P)']),
        ]),
        h('div', { class: 'plan-ap' }, [`Action points: `, h('b', {}, [`${ap} / ${apMax}`]),
          h('span', { class: 'plan-sysrow' }, sys)]),
        this._last ? h('div', { class: 'plan-last' }, [this._last]) : '',
        h('div', { class: 'dir-label' }, ['ACTIONS']),
        h('div', { class: 'plan-actions' }, actions),
        h('div', { class: 'dir-label' }, ['OBJECTIVES']),
        ...objs,
      ]),
    ]);
    overlay.appendChild(el);
    this.el = el;
  }
}
