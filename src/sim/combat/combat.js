// @ts-check
// Real-time-lite encounter controller. Hostiles are Actor3D puppets steered
// directly (no ActorQueue — they're not people, they're problems). The player
// shoots by clicking/E-ing a hostile through the picker; armed cast members
// return fire on their own cadence. World tick keeps running.
import * as THREE from 'three';
import { Actor3D } from '../../humanoid/actor3d.js';
import { resolveAttack, rollInjury, WEAPONS, HOSTILE_ARCHETYPES } from './resolver.js';
import { emit } from '../../core/bus.js';
import { feed } from '../../core/log.js';
import { spend } from '../world.js';

/** dark, hooded-looking rioter persona factory (procedural visual variety) */
function hostilePersona(arch, i, rng) {
  return {
    id: `hostile_${i}`,
    name: arch === 'merc' ? 'Merc' : arch === 'looter' ? 'Looter' : 'Rioter',
    accent: '#ff4757',
    colors: {
      skin: ['#8a6752', '#6e5142', '#a3765c'][i % 3],
      hair: '#0c0a10',
      eyes: '#b0b8c0',
      lips: '#5c4038',
    },
    hairStyle: 'short',
    face: { browWeight: 1.3 },
    body: {
      height: 1.7 + rng.range(-0.06, 0.1), shoulderW: 0.42, hipW: 0.34,
      bust: 0, waist: 1.05, hips: 0.9, build: 1.1,
    },
    personality: { breathBase: 1.2, fidget: 0.8, idleClip: 'idle_stand' },
  };
}

export class Combat {
  /**
   * @param {Object} deps
   * @param {import('../../scene3d/stage.js').Stage} deps.stage
   * @param {() => any} deps.run
   * @param {() => Record<string, import('../../chars/character.js').Character>} deps.cast
   * @param {THREE.Object3D} deps.playerMarker
   * @param {import('../../core/rng.js').RngStream} deps.rng
   * @param {(id:string)=>void} deps.sfx
   * @param {import('../../scene3d/picking.js').Picker} deps.picker
   * @param {() => number} deps.nowMinute
   */
  constructor(deps) {
    this.d = deps;
    /** @type {{actor:Actor3D, hp:number, arch:any, state:string, attackT:number, pickerIdx:number}[]} */
    this.hostiles = [];
    this.active = false;
    this._castFireT = 0;
    this._onResolve = null;
  }

  /**
   * @param {{count:number, archetype?:string, spawnAt:[number,number], onResolve?:(win:boolean)=>void}} spec
   */
  start(spec) {
    if (this.active) return;
    this.active = true;
    this._onResolve = spec.onResolve || null;
    const archId = spec.archetype || 'rioter';
    const arch = HOSTILE_ARCHETYPES[archId];

    for (let i = 0; i < spec.count; i++) {
      const persona = hostilePersona(archId, i, this.d.rng);
      const actor = new Actor3D(persona);
      actor.root.position.set(
        spec.spawnAt[0] + this.d.rng.range(-0.8, 0.8), 0,
        spec.spawnAt[1] + this.d.rng.range(-0.5, 0.5));
      actor.setRim(0.8);
      actor.face.setExpression({ mouth: 'grit', browAngle: -0.8, browRaise: -0.5 });
      this.d.stage.scene.add(actor.root);

      const h = { actor, hp: arch.hp, arch: { ...arch, id: archId }, state: 'advance', attackT: this.d.rng.range(0, 1.5), id: persona.id };
      this.hostiles.push(h);
      this.d.picker.register({
        mesh: actor.root, id: persona.id,
        prompt: `Shoot the ${persona.name.toLowerCase()}`,
        onInteract: () => this.playerShoot(h),
      });
    }
    emit('combat.started', { count: spec.count, archetype: archId });
    emit('hud.alert', { text: 'HOSTILES IN THE TOWER', kind: 'danger' });
    feed(`${spec.count} hostiles breached the penthouse floor!`, 'combat');
  }

  /** @param {any} h hostile entry */
  playerShoot(h) {
    if (!this.active || h.hp <= 0) return;
    const run = this.d.run();
    const wpn = this.d.equipped ? this.d.equipped() : { key: 'sidearm', ranged: true, name: 'Sidearm' };
    const weapon = WEAPONS[wpn.key] || WEAPONS.sidearm;
    const dist = h.actor.root.position.distanceTo(this.d.playerMarker.position);

    // melee weapons need to be in reach; ranged need ammo
    if (wpn.ranged) {
      if (run.resources.ammo < 1) {
        emit('hud.alert', { text: 'OUT OF AMMO — equip a melee weapon (I)', kind: 'danger' });
        this.d.sfx('ui_deny');
        return;
      }
      spend(run, 'ammo', 1);
      emit('resources.changed', run.resources);
      this.d.sfx('gunshot');
    } else {
      if (dist > weapon.range + 1.0) {
        emit('hud.alert', { text: `Too far for the ${wpn.name} — get closer`, kind: 'warn' });
        return;
      }
      this.d.sfx('thump');
    }

    const res = resolveAttack({ weapon, skill: 70, distance: dist }, this.d.rng);
    if (res.hit) {
      this._damageHostile(h, res.damage, res.crit ? 'Critical hit!' : null);
    } else {
      feed(wpn.ranged ? 'Your shot goes wide.' : 'You swing and miss.', 'combat');
    }
  }

  _damageHostile(h, damage, note) {
    h.hp -= damage;
    if (note) feed(note, 'combat');
    h.actor.face.setExpression({ mouth: 'open', browAngle: 0.6 });
    if (h.hp <= 0) {
      h.state = 'down';
      const run = this.d.run();
      run.history.kills = (run.history.kills || 0) + 1;
      h.actor.playClip('lounge', 0.2); // crumple approximation (dedicated clip later)
      h.actor.setRim(0);
      h.actor.root.rotation.x = -Math.PI / 2 * 0.06;
      feed(`${h.actor.persona.name} is down.`, 'combat');
      this.d.sfx('thump');
      if (this.hostiles.every((x) => x.hp <= 0)) this._resolve(true);
    }
  }

  /** cast members with weapons return fire */
  _castFire(dt) {
    this._castFireT += dt;
    if (this._castFireT < 3) return;
    this._castFireT = 0;
    const alive = this.hostiles.filter((h) => h.hp > 0);
    if (!alive.length) return;
    const run = this.d.run();
    for (const c of Object.values(this.d.cast())) {
      if (!c.alive || run.resources.ammo < 1) continue;
      const target = alive[0];
      spend(run, 'ammo', 1);
      this.d.sfx('gunshot');
      const dist = c.actor.root.position.distanceTo(target.actor.root.position);
      const skill = 40 + c.stats.dominance * 0.4;
      const res = resolveAttack({ weapon: WEAPONS.sidearm, skill, distance: dist }, this.d.rng);
      c.actor.lookAt(target.actor.root);
      if (res.hit) {
        this._damageHostile(target, res.damage);
        feed(`${c.name} hits the ${target.actor.persona.name.toLowerCase()}.`, 'combat');
      }
      c.applyStats({ tension: 2, fear: 1 }, 'combat');
    }
    emit('resources.changed', run.resources);
  }

  /** @param {number} dt seconds */
  update(dt) {
    if (!this.active) return;
    const run = this.d.run();
    const targets = [
      { pos: this.d.playerMarker.position, kind: 'player' },
      ...Object.values(this.d.cast()).filter((c) => c.alive)
        .map((c) => ({ pos: c.actor.root.position, kind: 'cast', char: c })),
    ];

    for (const h of this.hostiles) {
      if (h.hp <= 0) continue;
      // nearest target
      let best = targets[0], bestD = Infinity;
      for (const t of targets) {
        const d2 = h.actor.root.position.distanceTo(t.pos);
        if (d2 < bestD) { bestD = d2; best = t; }
      }
      const reach = WEAPONS[h.arch.weapon].range + 0.4;
      if (bestD > reach) {
        // advance
        const dir = best.pos.clone().sub(h.actor.root.position);
        dir.y = 0; dir.normalize();
        h.actor.root.position.addScaledVector(dir, h.arch.speed * dt);
        h.actor.faceYaw(Math.atan2(dir.x, dir.z));
        if (h.actor.animator.current.id !== 'walk') h.actor.playClip('walk', 0.2);
      } else {
        // attack on cadence
        h.attackT += dt;
        if (h.attackT >= 2.2) {
          h.attackT = 0;
          h.actor.playClip('gesture_lean_in', 0.1);
          const res = resolveAttack({
            weapon: WEAPONS[h.arch.weapon], skill: h.arch.skill, distance: bestD,
          }, this.d.rng);
          this.d.sfx(h.arch.weapon === 'smg' ? 'gunshot' : 'thump');
          if (res.hit) {
            if (best.kind === 'player') {
              run.player.health = Math.max(0, run.player.health - res.damage);
              emit('player.health', { health: run.player.health });
              emit('hud.alert', { text: `You're hit! −${res.damage}`, kind: 'danger' });
              if (run.player.health <= 0) { this._resolve(false); return; }
            } else if (best.char) {
              const injury = rollInjury(res.damage, this.d.rng, this.d.nowMinute());
              best.char.injuries.push(injury);
              best.char.applyStats({ fear: 6, tension: 8, energy: -5 }, 'wounded');
              feed(`${best.char.name} takes a ${injury.severity} to the ${injury.part}.`, 'combat');
            }
          }
        }
      }
      h.actor.update(dt);
    }
    if (this.active) this._castFire(dt);
  }

  _resolve(win) {
    this.active = false;
    emit('combat.resolved', { win });
    if (win) {
      feed('The penthouse floor is clear.', 'combat');
      emit('hud.alert', { text: 'THREAT NEUTRALIZED', kind: 'info' });
      for (const c of Object.values(this.d.cast())) {
        c.applyStats({ trust: 5, tension: -6, fear: -4 }, 'victory');
        c.memory.setFlag('survived_breach');
      }
    } else {
      feed('You are down. The tower has fallen.', 'combat');
    }
    // corpses fade out after a beat
    setTimeout(() => this._cleanup(), 6000);
    this._onResolve?.(win);
  }

  _cleanup() {
    for (const h of this.hostiles) {
      this.d.stage.scene.remove(h.actor.root);
      h.actor.dispose();
      const idx = this.d.picker.targets.findIndex((t) => t.id === h.id);
      if (idx >= 0) this.d.picker.targets.splice(idx, 1);
    }
    this.hostiles.length = 0;
  }
}
