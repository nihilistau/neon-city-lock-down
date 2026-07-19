// @ts-check
// Per-game-minute world tick orchestrator: survival (on hour boundaries) →
// systems → threat → scheduler → autosave cadence. Emits bus events; owns no UI.
import { hourlyTick } from './survival.js';
import { threatTick } from './threat.js';
import { resetDayPlan } from './dayPlan.js';
import { updateObjectives } from './objectives.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';
import { cfg } from '../core/config.js';   // systems degradation → config/sim.yaml (systems)

export class WorldTick {
  /**
   * @param {Object} deps
   * @param {() => any} deps.run
   * @param {() => import('../chars/character.js').Character[]} deps.livingCast
   * @param {import('./scheduler.js').Scheduler} deps.scheduler
   * @param {import('./eventRunner.js').EventRunner} deps.events
   * @param {import('../core/rng.js').RngStream} deps.rng
   */
  constructor(deps) {
    this.deps = deps;
  }

  /** @param {import('../core/clock.js').GameClock} clock */
  minute(clock) {
    const run = this.deps.run();

    // hour boundary: consumption + decay
    if (clock.minuteOfDay % 60 === 0) {
      const { notes } = hourlyTick(run, this.deps.livingCast());
      for (const n of notes) {
        feed(n, 'system');
        emit('hud.alert', { text: n, kind: 'warn' });
      }
      emit('resources.changed', run.resources);
    }

    threatTick(run, clock, this.deps.rng);
    emit('threat.changed', { threat: run.threat });

    // reserve cells drain while grid is down; total dark when they run out
    if (!run.systems.power.online && clock.minuteOfDay % 30 === 0) {
      if (run.resources.cells > 0) run.resources.cells = Math.max(0, run.resources.cells - cfg('sim.systems.cellDrainPer30', 0.5));
    }

    const eventId = this.deps.scheduler.tick(run, clock);
    if (eventId) {
      // if another event's script is mid-run — or a firefight is live — re-queue
      // rather than drop it (critical for scheduled beats like the extraction endgame)
      if (this.deps.events.busy || this.deps.combat?.().active) {
        run.eventQueue.push({ atMinute: clock.totalMinutes + 5, eventId });
      } else {
        this.deps.events.fire(eventId);
      }
    }

    // objectives can complete at any minute
    const done = updateObjectives(run, clock);
    for (const o of done) {
      feed(`✔ Objective complete: ${o.title} — ${o.note}`, 'system');
      emit('objective.done', o);
      emit('resources.changed', run.resources);
    }

    // day rollover: passive system degradation + a fresh AP pool
    if (clock.minuteOfDay === 0) {
      feed(`— Day ${clock.day} begins —`, 'system');
      if (run.systemsDay !== clock.day) {
        run.systemsDay = clock.day;
        const offlineHp = cfg('sim.systems.offlineHp', 12);
        for (const [k, amt] of Object.entries(cfg('sim.systems.degrade', {}))) {
          const s = run.systems[k];
          if (!s) continue;
          s.hp = Math.max(0, s.hp - amt);
          if (s.hp <= offlineHp && s.online) { s.online = false; feed(`The ${k} grid has failed — repair it.`, 'system'); }
        }
        emit('systems.changed', run.systems);
        resetDayPlan(run);
        emit('dayplan.reset', run.dayPlan);
      }
      emit('day.started', { day: clock.day });
    }
  }
}
