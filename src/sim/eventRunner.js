// @ts-check
// Runs world events through the shared ScriptRunner with a world-mutation
// vocabulary. Waits measured in game-minutes ride the world clock; a 'choice'
// step surfaces through the bus and resolves on the player's pick.
import { ScriptRunner } from '../core/script.js';
import { EVENTS } from '../../data/events.js';
import { emit, on } from '../core/bus.js';
import { feed } from '../core/log.js';
import { spikeThreat } from './threat.js';
import { gain, spend } from './world.js';

export class EventRunner {
  /**
   * @param {Object} deps
   * @param {() => any} deps.run
   * @param {() => Record<string, import('../chars/character.js').Character>} deps.cast
   * @param {any} deps.lighting @param {any} deps.audioFacade
   * @param {() => number} deps.nowMinute
   */
  constructor(deps) {
    this.deps = deps;
    this.runner = new ScriptRunner('events');
    this._minuteWaiters = [];

    on('world.minute', () => {
      const now = deps.nowMinute();
      this._minuteWaiters = this._minuteWaiters.filter((w) => {
        if (now >= w.until) { w.resolve(); return false; }
        return true;
      });
    });

    const d = deps;
    this.runner.register({
      vox: (s) => {
        feed(`VOX: ${s.text}`, 'system');
        d.audioFacade().voxLine?.(s.text, s.bakedId);
      },
      news: (s) => emit('news.push', { text: s.text }),
      alert: (s) => { emit('hud.alert', { text: s.text, kind: s.kind }); feed(s.text, 'event'); },
      sfx: (s) => d.audioFacade().sfx(s.id),
      wait: (s) => new Promise((r) => setTimeout(r, s.sec * 1000)),
      waitMinutes: (s) => new Promise((resolve) => {
        this._minuteWaiters.push({ until: d.nowMinute() + s.minutes, resolve });
      }),
      powerDown: () => {
        const run = d.run();
        run.systems.power.online = false;
        emit('power.changed', { online: false });
      },
      powerUp: () => {
        const run = d.run();
        run.systems.power.online = true;
        emit('power.changed', { online: true });
      },
      castStats: (s) => {
        for (const c of Object.values(d.cast())) c.applyStats(s.deltas, 'event');
      },
      castStat: (s) => d.cast()[s.char]?.applyStats(s.deltas, 'event'),
      castFlag: (s) => {
        for (const c of Object.values(d.cast())) c.memory.setFlag(s.flag);
      },
      playerMorale: (s) => {
        const p = d.run().player;
        p.morale = Math.max(0, Math.min(100, p.morale + s.amount));
      },
      resource: (s) => {
        if (s.amount >= 0) gain(d.run(), s.key, s.amount);
        else spend(d.run(), s.key, -s.amount);
        emit('resources.changed', d.run().resources);
      },
      addRefugee: () => {
        const run = d.run();
        run.refugees++;
        emit('resources.changed', run.resources);
      },
      threatSpike: (s) => spikeThreat(d.run(), s.amount ?? 10),
      damageSystem: (s) => {
        const sys = d.run().systems[s.system];
        if (!sys) return;
        sys.hp = Math.max(0, sys.hp - (s.amount ?? 25));
        if (sys.hp <= 15) sys.online = false;
        if (s.system === 'power' && !sys.online) emit('power.changed', { online: false });
        emit('systems.changed', d.run().systems);
        feed(`System damaged: ${s.system} (${Math.round(sys.hp)}%)`, 'event');
      },
      systemOnline: (s) => {
        const sys = d.run().systems[s.system];
        if (!sys) return;
        sys.online = s.online !== false;
        if (s.system === 'power') emit('power.changed', { online: sys.online });
        emit('systems.changed', d.run().systems);
      },
      playerHurt: (s) => {
        const p = d.run().player;
        p.health = Math.max(0, p.health - s.amount);
        emit('player.health', { health: p.health });
      },
      scheduleEvent: (s) => {
        d.run().eventQueue.push({ atMinute: d.nowMinute() + s.inMinutes, eventId: s.eventId });
      },
      lockElevator: (s) => {
        d.run().systems.elevator.locked = s.locked !== false;
        feed(s.locked !== false ? 'VOX has locked the elevator.' : 'Elevator restored.', 'system');
      },
      endRun: (s) => emit('run.extraction', { outcome: s.outcome }),
      combat: (s) => new Promise((resolve) => {
        if (!d.combat) { resolve(); return; }
        d.combat().start({
          count: s.count, archetype: s.archetype, spawnAt: s.spawnAt,
          onResolve: (win) => resolve({ steps: win ? (s.onWin || []) : (s.onLoss || []) }),
        });
      }),
      choice: (s) => new Promise((resolve) => {
        emit('event.choice', {
          prompt: s.prompt,
          options: s.options.map((o) => o.label),
          pick: (idx) => {
            const opt = s.options[idx] ?? s.options[0];
            d.run().history.choices.push({ prompt: s.prompt, chose: opt.label });
            resolve({ steps: opt.steps });
          },
        });
      }),
    });
  }

  get busy() { return this.runner.running; }

  /** @param {string} eventId */
  async fire(eventId) {
    const def = EVENTS[eventId];
    if (!def || this.runner.running) return;
    const run = this.deps.run();
    run.activeEventId = eventId;
    run.eventsFired.push(eventId);
    emit('event.fired', { id: eventId, cls: def.cls });
    feed(`⚡ Event: ${eventId}`, 'event');
    try {
      await this.runner.run(def.script, {});
    } catch (err) {
      console.error('[event]', eventId, err);
    } finally {
      run.activeEventId = null;
      emit('event.done', { id: eventId });
    }
  }
}
