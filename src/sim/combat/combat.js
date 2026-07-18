// @ts-check
// Real-time-lite combat, deepened into a mode:
// - COVER: furniture at crouch height shields player, cast, and hostiles
//   (cover.js math feeds the resolver's cover param on every attack).
// - CAST AI: on breach, the cast sprints to cover and fights crouched.
// - HOSTILE AI: rioters/looters rush; mercs advance to cover at mid-range and
//   hold there, firing disciplined bursts.
// - DEFENCES: the ceiling turret auto-fires while the defence grid is online
//   (accuracy scales with grid hp, and firing wears it); blast shutters can be
//   dropped mid-fight (2 power cells) to seal out reinforcement waves.
// - WAVES: breaches can arrive in waves; shutters cancel what hasn't spawned.
// - LOOT: downed hostiles are stripped for ammo and the occasional item.
import * as THREE from 'three';
import { Actor3D } from '../../humanoid/actor3d.js';
import { resolveAttack, rollInjury, WEAPONS, HOSTILE_ARCHETYPES, hitChance } from './resolver.js';
import { coverBetween, findCoverSpot } from './cover.js';
import { emit } from '../../core/bus.js';
import { feed } from '../../core/log.js';
import { spend } from '../world.js';

/** dark, hooded-looking rioter persona factory (procedural visual variety) */
function hostilePersona(arch, i, rng) {
  return {
    id: `hostile_${i}_${rng.int(0, 9999)}`,
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

const TURRET_PERIOD = 2.6;
const WAVE_DELAY = 6;
const MAG_SIZE = { sidearm: 12, smg: 25, pipe: 1, shiv: 1 };

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
   * @param {() => {key:string, ranged:boolean, name:string}} [deps.equipped]
   * @param {() => THREE.Box3[]} [deps.colliders]  active-floor cover boxes
   * @param {() => any} [deps.defences]            world.defences (turret/shutter)
   * @param {(x:number,z:number)=>boolean} [deps.walkable]
   * @param {(itemId:string, qty?:number)=>void} [deps.giveItem]
   */
  constructor(deps) {
    this.d = deps;
    /** @type {{actor:Actor3D, hp:number, maxHp:number, arch:any, state:string, attackT:number, id:string, coverSpot:any}[]} */
    this.hostiles = [];
    this.active = false;
    this._castFireT = 0;
    this._turretT = 0;
    this._onResolve = null;
    /** @type {{count:number, archetype:string}[]} */
    this._pendingWaves = [];
    this._waveCountdown = 0;
    this.wave = 0;
    this.totalWaves = 1;
    this.mag = 0;          // rounds in the current magazine (reserve = resources.ammo)
    this.magSize = 12;
    this._spawnAt = [0, 0];
  }

  _colliders() { return this.d.colliders ? this.d.colliders() : []; }

  /**
   * @param {{count?:number, archetype?:string, spawnAt:[number,number],
   *          waves?:{count:number, archetype?:string}[],
   *          onResolve?:(win:boolean)=>void}} spec
   */
  start(spec) {
    if (this.active) return;
    this.active = true;
    this._onResolve = spec.onResolve || null;
    this._spawnAt = spec.spawnAt;
    const waves = spec.waves?.length
      ? spec.waves.map((w) => ({ count: w.count, archetype: w.archetype || 'rioter' }))
      : [{ count: spec.count || 2, archetype: spec.archetype || 'rioter' }];
    this._pendingWaves = waves;
    this.totalWaves = waves.length;
    this.wave = 0;
    this._waveCountdown = 0;

    // load the magazine from the reserve for the equipped weapon
    const wpn = this.d.equipped ? this.d.equipped() : { key: 'sidearm' };
    this.magSize = MAG_SIZE[wpn.key] ?? 12;
    this.mag = Math.min(this.magSize, this.d.run().resources.ammo);
    this.d.run().resources.ammo -= this.mag;

    this._spawnWave();
    this._castTakeCover();
    emit('combat.started', { waves: this.totalWaves });
    emit('hud.alert', { text: 'HOSTILES IN THE TOWER', kind: 'danger' });
  }

  _spawnWave() {
    const waveSpec = this._pendingWaves.shift();
    if (!waveSpec) return;
    this.wave++;
    const arch = HOSTILE_ARCHETYPES[waveSpec.archetype];
    for (let i = 0; i < waveSpec.count; i++) {
      const persona = hostilePersona(waveSpec.archetype, i, this.d.rng);
      const actor = new Actor3D(persona);
      actor.root.position.set(
        this._spawnAt[0] + this.d.rng.range(-0.8, 0.8), 0,
        this._spawnAt[1] + this.d.rng.range(-0.5, 0.5));
      actor.setRim(0.8);
      actor.face.setExpression({ mouth: 'grit', browAngle: -0.8, browRaise: -0.5 });
      this.d.stage.scene.add(actor.root);

      const h = {
        actor, hp: arch.hp, maxHp: arch.hp,
        arch: { ...arch, id: waveSpec.archetype },
        state: 'advance', attackT: this.d.rng.range(0, 1.5),
        id: persona.id, coverSpot: null,
      };
      this.hostiles.push(h);
      this.d.picker.register({
        mesh: actor.root, id: persona.id,
        prompt: `Attack the ${persona.name.toLowerCase()}`,
        onInteract: () => this.playerShoot(h),
      });
    }
    feed(`Wave ${this.wave}/${this.totalWaves}: ${waveSpec.count} ${waveSpec.archetype}${waveSpec.count > 1 ? 's' : ''} breach the floor!`, 'combat');
    emit('combat.wave', { wave: this.wave, total: this.totalWaves });
    this.d.sfx('alarm_hard');
  }

  /** the cast scrambles for the nearest furniture cover, crouched */
  _castTakeCover() {
    const threat = { x: this._spawnAt[0], z: this._spawnAt[1] };
    for (const c of Object.values(this.d.cast())) {
      if (!c.alive || c.present === false || c.id === 'vox') continue;
      const p = c.actor.root.position;
      const spot = findCoverSpot(this._colliders(), threat, { x: p.x, z: p.z }, this.d.walkable);
      c.queue.clear();
      if (spot) {
        c.queue.push({ type: 'gotoPos', args: [spot.x, spot.z] });
        c.queue.playClip('crouch', 0.3);
        c.queue.look(null);
      } else {
        c.queue.playClip('crouch', 0.3);
      }
    }
    feed('The others scramble for cover.', 'combat');
  }

  /** Drop the blast shutters: costs 2 cells, seals out un-spawned waves. */
  dropShutters() {
    const run = this.d.run();
    const def = this.d.defences?.();
    if (!def || def.shutter.down) return { ok: false, reason: 'already_down' };
    if (run.resources.cells < 2) {
      emit('hud.alert', { text: 'Not enough power cells (need 2)', kind: 'danger' });
      return { ok: false, reason: 'cells' };
    }
    spend(run, 'cells', 2);
    emit('resources.changed', run.resources);
    def.shutter.down = true;
    this.d.sfx('door_servo');
    const sealed = this._pendingWaves.reduce((s, w) => s + w.count, 0);
    this._pendingWaves = [];
    this._waveCountdown = 0;
    emit('combat.shutters', { sealed });
    feed(sealed > 0
      ? `Blast shutters slam down — ${sealed} reinforcements hammer uselessly on the steel.`
      : 'Blast shutters slam down over the stairwell.', 'combat');
    return { ok: true, sealed };
  }

  /** raise shutters again after combat (no cost) */
  raiseShutters() {
    const def = this.d.defences?.();
    if (def?.shutter.down) {
      def.shutter.down = false;
      this.d.sfx('door_servo');
    }
  }

  /** player's current cover value against a given hostile */
  playerCoverAgainst(h) {
    const p = this.d.playerMarker.position;
    return coverBetween({ x: p.x, z: p.z }, h.actor.root.position, this._colliders());
  }

  /** best-case display of the player's cover vs any living hostile */
  playerCover() {
    let worst = 1;
    const alive = this.hostiles.filter((x) => x.hp > 0);
    if (!alive.length) return 0;
    for (const h of alive) worst = Math.min(worst, this.playerCoverAgainst(h));
    return worst;
  }

  /** hit % preview for the HUD */
  playerHitChance(h) {
    const wpn = this.d.equipped ? this.d.equipped() : { key: 'sidearm', ranged: true };
    const weapon = WEAPONS[wpn.key] || WEAPONS.sidearm;
    const p = this.d.playerMarker.position;
    const dist = h.actor.root.position.distanceTo(p);
    const cover = coverBetween(
      { x: h.actor.root.position.x, z: h.actor.root.position.z },
      { x: p.x, z: p.z }, this._colliders());
    return hitChance({ weapon, skill: 70, distance: dist, cover });
  }

  /**
   * FPS/TPS fire: raycast from the camera crosshair against hostiles. Hit → the
   * shared playerShoot resolution; miss → spend ammo + a tracer into the void.
   * @param {import('three').Camera} camera
   */
  fireRay(camera) {
    if (!this.active) return;
    const alive = this.hostiles.filter((h) => h.hp > 0);
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = ray.intersectObjects(alive.map((h) => h.actor.root), true);
    if (hits.length) {
      let obj = hits[0].object, hit = null;
      while (obj && !hit) { hit = alive.find((x) => x.actor.root === obj); obj = obj.parent; }
      if (hit) { this.playerShoot(hit); return; }
    }
    // clean miss into the distance
    const run = this.d.run();
    const wpn = this.d.equipped ? this.d.equipped() : { key: 'sidearm', ranged: true, name: 'Sidearm' };
    if (!wpn.ranged) return;   // a melee whiff at empty air costs nothing
    if (this.mag < 1) { emit('hud.alert', { text: run.resources.ammo > 0 ? 'RELOAD — press R' : 'OUT OF AMMO', kind: 'warn' }); this.d.sfx('ui_deny'); return; }
    this.mag -= 1;
    emit('combat.mag', { mag: this.mag, magSize: this.magSize, reserve: run.resources.ammo });
    this.d.sfx('gunshot');
    const p = this.d.playerMarker.position;
    const from = new THREE.Vector3(p.x, 1.5, p.z);
    const to = camera.position.clone().addScaledVector(ray.ray.direction, 24);
    this._fxShot(from, to, false);
  }

  /** Top up the magazine from the ammo reserve (R). */
  reload() {
    if (!this.active) return;
    const run = this.d.run();
    const need = this.magSize - this.mag;
    if (need <= 0) return;
    if (run.resources.ammo < 1) { emit('hud.alert', { text: 'No spare ammo', kind: 'warn' }); return; }
    const take = Math.min(need, run.resources.ammo);
    run.resources.ammo -= take;
    this.mag += take;
    this.d.sfx('door_servo');
    emit('combat.mag', { mag: this.mag, magSize: this.magSize, reserve: run.resources.ammo });
    emit('resources.changed', run.resources);
  }

  /** @param {any} h hostile entry */
  playerShoot(h) {
    if (!this.active || h.hp <= 0) return;
    const run = this.d.run();
    const wpn = this.d.equipped ? this.d.equipped() : { key: 'sidearm', ranged: true, name: 'Sidearm' };
    const weapon = WEAPONS[wpn.key] || WEAPONS.sidearm;
    const p = this.d.playerMarker.position;
    const dist = h.actor.root.position.distanceTo(p);

    if (wpn.ranged) {
      if (this.mag < 1) {
        emit('hud.alert', { text: run.resources.ammo > 0 ? 'RELOAD — press R' : 'OUT OF AMMO — equip melee (I)', kind: 'warn' });
        this.d.sfx('ui_deny');
        return;
      }
      this.mag -= 1;
      emit('combat.mag', { mag: this.mag, magSize: this.magSize, reserve: run.resources.ammo });
      this.d.sfx('gunshot');
    } else {
      if (dist > weapon.range + 1.0) {
        emit('hud.alert', { text: `Too far for the ${wpn.name} — get closer`, kind: 'warn' });
        return;
      }
      this.d.sfx('thump');
    }

    // the hostile's own cover protects it from the player too
    const cover = coverBetween(
      { x: h.actor.root.position.x, z: h.actor.root.position.z },
      { x: p.x, z: p.z }, this._colliders());
    const skill = this.d.playerSkill ? this.d.playerSkill() : 70;
    const res = resolveAttack({ weapon, skill, distance: dist, cover }, this.d.rng);
    const target = h.actor.root.position.clone(); target.y = 1.2;
    if (wpn.ranged) this._fxShot(new THREE.Vector3(p.x, 1.5, p.z), target, res.hit);
    else if (res.hit && this.d.fx) this.d.fx.impact(target, 'blood');
    if (res.hit) {
      this._damageHostile(h, res.damage, res.crit ? 'Critical hit!' : null);
      emit('combat.hit', { crit: res.crit });
    } else {
      feed(cover > 0 ? 'Your shot chews into their cover.' : (wpn.ranged ? 'Your shot goes wide.' : 'You swing and miss.'), 'combat');
    }
  }

  /** muzzle flash + tracer (+ impact on hit) between two world points. */
  _fxShot(from, to, hit, kind = 'blood') {
    const fx = this.d.fx;
    if (!fx) return;
    fx.muzzleFlash(from);
    const end = hit ? to
      : to.clone().add(new THREE.Vector3(this.d.rng.range(-0.9, 0.9), this.d.rng.range(-0.5, 0.5), this.d.rng.range(-0.9, 0.9)));
    fx.tracer(from, end);
    if (hit) fx.impact(to, kind);
  }

  _damageHostile(h, damage, note) {
    if (h.hp <= 0) return;   // already down — no double kill credit
    h.hp -= damage;
    if (note) feed(note, 'combat');
    h.actor.face.setExpression({ mouth: 'open', browAngle: 0.6 });
    if (h.hp <= 0) {
      h.state = 'down';
      const run = this.d.run();
      run.history.kills = (run.history.kills || 0) + 1;
      h.actor.playClip('lounge', 0.2);
      h.actor.setRim(0);
      h.actor.root.rotation.x = -Math.PI / 2 * 0.06;
      feed(`${h.actor.persona.name} is down.`, 'combat');
      this.d.sfx('thump');
    }
  }

  /** cast members return fire from cover */
  _castFire(dt) {
    this._castFireT += dt;
    if (this._castFireT < 3) return;
    this._castFireT = 0;
    if (!this.hostiles.some((h) => h.hp > 0)) return;
    const run = this.d.run();
    for (const c of Object.values(this.d.cast())) {
      if (!c.alive || c.present === false || c.id === 'vox' || run.resources.ammo < 1) continue;
      // re-filter per shooter: an earlier cast member may have dropped the target
      const alive = this.hostiles.filter((h) => h.hp > 0);
      if (!alive.length) break;
      const target = alive[this.d.rng.int(0, alive.length - 1)];
      spend(run, 'ammo', 1);
      this.d.sfx('gunshot');
      const cp = c.actor.root.position;
      const dist = cp.distanceTo(target.actor.root.position);
      const skill = 40 + c.stats.dominance * 0.4;
      const tCover = coverBetween(
        { x: target.actor.root.position.x, z: target.actor.root.position.z },
        { x: cp.x, z: cp.z }, this._colliders());
      const res = resolveAttack({ weapon: WEAPONS.sidearm, skill, distance: dist, cover: tCover }, this.d.rng);
      c.actor.lookAt(target.actor.root);
      this._fxShot(new THREE.Vector3(cp.x, 1.3, cp.z), target.actor.root.position.clone().setY(1.2), res.hit);
      if (res.hit) {
        this._damageHostile(target, res.damage);
        feed(`${c.name} hits the ${target.actor.persona.name.toLowerCase()}.`, 'combat');
      }
      c.applyStats({ tension: 2, fear: 1 }, 'combat');
    }
    emit('resources.changed', run.resources);
  }

  /** the building fights back while the defence grid is up */
  _turretFire(dt) {
    const run = this.d.run();
    const def = this.d.defences?.();
    const grid = run.systems.defence;
    if (!def || !grid.online || grid.hp <= 5) return;
    const alive = this.hostiles.filter((h) => h.hp > 0);
    if (!alive.length) return;

    // yoke tracks the closest hostile continuously
    const turret = def.turret;
    const target = alive[0];
    const world = new THREE.Vector3();
    turret.group.getWorldPosition(world);
    const tp = target.actor.root.position;
    turret.yoke.lookAt(tp.x, 1.2, tp.z);

    this._turretT += dt;
    if (this._turretT < TURRET_PERIOD) return;
    this._turretT = 0;

    const skill = 20 + grid.hp * 0.55;    // a healthy grid shoots straight
    const dist = world.distanceTo(tp);
    const res = resolveAttack({ weapon: WEAPONS.smg, skill, distance: Math.max(2, dist * 0.6) }, this.d.rng);
    turret.muzzle.material.emissiveIntensity = 6;
    this.d.sfx('gunshot');
    const muzzleW = turret.muzzle.getWorldPosition(new THREE.Vector3());
    this._fxShot(muzzleW, tp.clone().setY(1.2), res.hit, 'blood');
    grid.hp = Math.max(0, grid.hp - 0.6);  // barrels wear
    emit('systems.changed', run.systems);
    if (res.hit) {
      this._damageHostile(target, Math.round(res.damage * 0.9), null);
      feed('The ceiling turret finds its mark.', 'combat');
    }
  }

  /** @param {number} dt seconds */
  update(dt) {
    if (!this.active) return;
    const run = this.d.run();
    const colliders = this._colliders();
    const targets = [
      { pos: this.d.playerMarker.position, kind: 'player' },
      ...Object.values(this.d.cast()).filter((c) => c.alive && c.present !== false && c.id !== 'vox')
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
      const weapon = WEAPONS[h.arch.weapon];
      const reach = weapon.range + 0.4;
      const hp3 = h.actor.root.position;

      // mercs fight from cover at range; rushers close to melee
      const isRanged = weapon.range > 3;
      let wantAdvance = bestD > reach;
      if (isRanged && h.state !== 'holding') {
        if (!h.coverSpot) {
          h.coverSpot = findCoverSpot(colliders, { x: best.pos.x, z: best.pos.z },
            { x: hp3.x, z: hp3.z }, this.d.walkable);
        }
        if (h.coverSpot) {
          const dCover = Math.hypot(h.coverSpot.x - hp3.x, h.coverSpot.z - hp3.z);
          if (dCover > 0.25) {
            // move to cover instead of straight at the target
            const dir = new THREE.Vector3(h.coverSpot.x - hp3.x, 0, h.coverSpot.z - hp3.z).normalize();
            hp3.addScaledVector(dir, h.arch.speed * dt);
            h.actor.faceYaw(Math.atan2(dir.x, dir.z));
            if (h.actor.animator.current.id !== 'walk') h.actor.playClip('walk', 0.2);
            h.actor.update(dt);
            continue;
          }
          h.state = 'holding';
          h.actor.playClip('crouch', 0.3);
          wantAdvance = false;
        }
      }
      if (h.state === 'holding') wantAdvance = false;

      if (wantAdvance) {
        const dir = best.pos.clone().sub(hp3);
        dir.y = 0; dir.normalize();
        hp3.addScaledVector(dir, h.arch.speed * dt);
        h.actor.faceYaw(Math.atan2(dir.x, dir.z));
        if (h.actor.animator.current.id !== 'walk') h.actor.playClip('walk', 0.2);
      } else if (bestD <= reach || h.state === 'holding') {
        h.attackT += dt;
        if (h.attackT >= 2.2 && bestD <= (h.state === 'holding' ? weapon.range * 2.2 : reach)) {
          h.attackT = 0;
          if (h.state !== 'holding') h.actor.playClip('gesture_lean_in', 0.1);
          h.actor.faceYaw(Math.atan2(best.pos.x - hp3.x, best.pos.z - hp3.z));
          // the defender's cover reduces the hit
          const cover = coverBetween(
            { x: best.pos.x, z: best.pos.z }, { x: hp3.x, z: hp3.z }, colliders);
          const res = resolveAttack({
            weapon, skill: h.arch.skill, distance: bestD, cover,
          }, this.d.rng);
          this.d.sfx(h.arch.weapon === 'smg' ? 'gunshot' : 'thump');
          if (weapon.range > 3) {   // ranged hostile → tracer toward the target
            this._fxShot(new THREE.Vector3(hp3.x, 1.3, hp3.z),
              new THREE.Vector3(best.pos.x, 1.3, best.pos.z), res.hit, best.kind === 'player' ? 'spark' : 'blood');
          }
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
          } else if (cover > 0) {
            feed(best.kind === 'player' ? 'Rounds thud into your cover.' : `${best.char.name}'s cover holds.`, 'combat');
          }
        }
      }
      h.actor.update(dt);
    }

    this._turretFire(dt);
    if (this.active) this._castFire(dt);

    // wave management
    const anyAlive = this.hostiles.some((h) => h.hp > 0);
    if (!anyAlive) {
      if (this._pendingWaves.length) {
        this._waveCountdown += dt;
        if (this._waveCountdown === dt) {
          emit('hud.alert', { text: 'MORE INBOUND — drop the shutters or dig in', kind: 'warn' });
          emit('combat.waveIncoming', { inSec: WAVE_DELAY });
        }
        if (this._waveCountdown >= WAVE_DELAY) {
          this._waveCountdown = 0;
          this._spawnWave();
        }
      } else {
        this._resolve(true);
      }
    }
  }

  _resolve(win) {
    this.active = false;
    // return unspent magazine rounds to the reserve
    if (this.mag > 0) { this.d.run().resources.ammo += this.mag; this.mag = 0; emit('resources.changed', this.d.run().resources); }
    emit('combat.resolved', { win });
    if (win) {
      // strip the fallen: ammo + occasional gear
      const run = this.d.run();
      const downed = this.hostiles.filter((h) => h.hp <= 0).length;
      let ammoLoot = 0;
      for (let i = 0; i < downed; i++) {
        ammoLoot += this.d.rng.int(3, 8);
        if (this.d.giveItem && this.d.rng.chance(0.3)) {
          this.d.giveItem(this.d.rng.pick(['stim', 'shiv', 'ration']), 1);
        }
      }
      if (ammoLoot) {
        run.resources.ammo += ammoLoot;
        emit('resources.changed', run.resources);
        feed(`You strip the fallen: +${ammoLoot} rounds.`, 'combat');
      }
      feed('The floor is clear.', 'combat');
      emit('hud.alert', { text: 'THREAT NEUTRALIZED', kind: 'info' });
      for (const c of Object.values(this.d.cast())) {
        c.applyStats({ trust: 5, tension: -6, fear: -4 }, 'victory');
        c.memory.setFlag('survived_breach');
        if (c.id !== 'vox' && c.present !== false) {
          c.queue.clear();
          c.queue.playClip(c.persona.personality.idleClip || 'idle_stand', 0.6);
        }
      }
      this.raiseShutters();
    } else {
      feed('You are down. The tower has fallen.', 'combat');
    }
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
