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
import { resolveAttack, resolveAimedShot, rollInjury, hitChance } from './resolver.js';
import { coverBetween, findCoverSpot, crouchCover } from './cover.js';
import { rollLoot } from './loot.js';
import { emit } from '../../core/bus.js';
import { cfg } from '../../core/config.js';
// Live combat data (hot-reloadable via config/combat.yaml)
const weapons = () => cfg('combat.weapons');
import { feed } from '../../core/log.js';
import { spend } from '../world.js';

/** dark, hooded-looking rioter persona factory (procedural visual variety) */
function hostilePersona(arch, i, rng) {
  const kit = arch === 'merc' ? 'visor' : arch === 'looter' ? 'backpack' : 'hoodie';
  const hair = arch === 'merc' ? 'slick' : arch === 'looter' ? 'undercut' : 'short';
  return {
    id: `hostile_${i}_${rng.int(0, 9999)}`,
    name: arch === 'merc' ? 'Merc' : arch === 'looter' ? 'Looter' : 'Rioter',
    accent: '#ff4757',
    kit,
    colors: {
      skin: ['#8a6752', '#6e5142', '#a3765c', '#3d2a22'][i % 4],
      hair: ['#0c0a10', '#3a2418', '#1a1420'][i % 3],
      eyes: '#b0b8c0',
      lips: '#5c4038',
    },
    hairStyle: hair,
    face: { browWeight: 1.3 },
    body: {
      height: 1.7 + rng.range(-0.06, 0.1), shoulderW: 0.42 + rng.range(-0.03, 0.04),
      hipW: 0.34, bust: 0, waist: 1.05, hips: 0.9, build: 1.05 + rng.range(0, 0.15),
    },
    personality: { breathBase: 1.2, fidget: 0.8, idleClip: 'idle_stand' },
  };
}

// TURRET_PERIOD / WAVE_DELAY / MAG_SIZE now live in config/combat.yaml
// (data/configDefaults.js) — read via cfg() at use so edits hot-reload.

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
    /** bumped per fight so a stale cleanup timer can't wipe a newer wave */
    this._generation = 0;
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
    this._spawnFloor = spec.floor || null;
    const waves = spec.waves?.length
      ? spec.waves.map((w) => ({ count: w.count, archetype: w.archetype || 'rioter' }))
      : [{ count: spec.count || 2, archetype: spec.archetype || 'rioter' }];
    this._pendingWaves = waves;
    this.totalWaves = waves.length;
    this.wave = 0;
    this._waveCountdown = 0;

    // load the magazine from the reserve for the equipped weapon
    const wpn = this.d.equipped ? this.d.equipped() : { key: 'sidearm' };
    this.magSize = cfg('combat.magSize')[wpn.key] ?? 12;
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
    const arch = cfg('combat.hostileArchetypes')[waveSpec.archetype];
    for (let i = 0; i < waveSpec.count; i++) {
      const persona = hostilePersona(waveSpec.archetype, i, this.d.rng);
      const actor = new Actor3D(persona);
      const ox = this.d.floorOffset ? this.d.floorOffset() : 0;
      actor.root.position.set(
        this._spawnAt[0] + ox + this.d.rng.range(-0.8, 0.8), 0,
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
      if (!this._onCombatFloor(c)) continue;   // cover is computed per-floor
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
    if (run.flags.shuttersJammed) {
      emit('hud.alert', { text: 'The shutter rails scream and bind. Steel stays up.', kind: 'danger' });
      return { ok: false, reason: 'jammed' };
    }
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
    const base = coverBetween({ x: p.x, z: p.z }, h.actor.root.position, this._colliders());
    return crouchCover(base, !!this.d.playerCrouch?.());
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
    const weapon = weapons()[wpn.key] || weapons().sidearm;
    const p = this.d.playerMarker.position;
    const dist = h.actor.root.position.distanceTo(p);
    const cover = coverBetween(
      { x: h.actor.root.position.x, z: h.actor.root.position.z },
      { x: p.x, z: p.z }, this._colliders());
    // must match playerShoot()'s skill source exactly, or the HUD lies: this was
    // hard-coded to 70 while resolution used the live 60→92 value.
    const skill = this.d.playerSkill ? this.d.playerSkill() : 70;
    return hitChance({ weapon, skill, distance: dist, cover });
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
    const from = this._muzzlePos() || new THREE.Vector3(p.x, 1.5, p.z);
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
    this.d.sfx('reload');
    emit('combat.mag', { mag: this.mag, magSize: this.magSize, reserve: run.resources.ammo });
    emit('resources.changed', run.resources);
  }

  /** @param {any} h hostile entry */
  playerShoot(h) {
    if (!this.active || h.hp <= 0) return;
    const run = this.d.run();
    const wpn = this.d.equipped ? this.d.equipped() : { key: 'sidearm', ranged: true, name: 'Sidearm' };
    const weapon = weapons()[wpn.key] || weapons().sidearm;
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
    // Aimed: the caller already put the crosshair / interact on this body.
    const res = resolveAimedShot({ weapon, cover, skill, rng: this.d.rng });
    const target = h.actor.root.position.clone(); target.y = 1.2;
    const from = this._muzzlePos() || new THREE.Vector3(p.x, 1.5, p.z);
    if (wpn.ranged) this._fxShot(from, target, true, res.glancing ? 'spark' : 'blood');
    else if (this.d.fx) this.d.fx.impact(target, res.glancing ? 'spark' : 'blood');
    this.d.sfx(res.glancing ? 'hit_cover' : 'hit_flesh');
    this._damageHostile(h, res.damage, res.crit ? 'Critical hit!' : (res.glancing ? 'Glancing — cover ate some of it.' : null));
    emit('combat.hit', { crit: res.crit, glancing: res.glancing });
  }

  _muzzlePos() {
    const m = this.d.muzzle?.();
    return m || null;
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
      this._offerLoot(h);
    }
  }

  _offerLoot(h) {
    h.lootable = true;
    h.looted = false;
    this.d.picker.register({
      mesh: h.actor.root, id: `${h.id}_loot`,
      prompt: `Loot the ${h.actor.persona.name.toLowerCase()}`,
      onInteract: () => this._lootBody(h),
    });
  }

  _lootBody(h) {
    if (!h || h.looted) return;
    h.looted = true;
    const run = this.d.run();
    const loot = rollLoot(this.d.rng);
    run.resources.ammo += loot.ammo;
    emit('resources.changed', run.resources);
    if (loot.item && this.d.giveItem) this.d.giveItem(loot.item, 1);
    feed(`You strip the body: +${loot.ammo} rounds${loot.item ? `, ${loot.item}` : ''}.`, 'combat');
    emit('hud.alert', { text: `Looted +${loot.ammo} ammo`, kind: 'info' });
    this.d.sfx('thump');
  }

  /**
   * Is this character on the floor the fight is actually happening on?
   * Floors are laid out 200 world-units apart on X, so an off-floor cast member
   * used to burn a reserve round every 3s shooting at ~1200m for a 3% floored
   * hit chance — and to walk to "cover" computed against the wrong floor.
   * @param {import('../../chars/character.js').Character} c
   */
  _onCombatFloor(c) {
    const ref = this.d.playerMarker?.position;
    if (!ref) return true;
    return Math.abs(c.actor.root.position.x - ref.x) < 100;
  }

  /** one of the cast is down for good — the survivors feel it */
  _castMourn(fallen) {
    this.d.sfx('thump');
    emit('hud.alert', { text: `${fallen.name.toUpperCase()} IS DOWN`, kind: 'danger' });
    for (const c of Object.values(this.d.cast())) {
      if (!c.alive || c.id === fallen.id) continue;
      c.applyStats({ fear: 14, tension: 16, happiness: -12, loyalty: -2 }, 'witnessed_death');
      c.memory.setFlag(`lost_${fallen.id}`);
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
      if (!c.alive || c.present === false || c.id === 'vox') continue;
      // don't dump the shared magazine — they only fire if the reserve is healthy
      if (run.resources.ammo <= 15) continue;
      if (!this._onCombatFloor(c)) continue;
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
      const res = resolveAttack({ weapon: weapons().sidearm, skill, distance: dist, cover: tCover }, this.d.rng);
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
  /**
   * Is this hostile on the same floor as the turret itself?
   * @param {{actor:{root:{position:{x:number}}}}} h
   */
  _onTurretFloor(h) {
    const def = this.d.defences?.();
    const turretX = def?.turret?.group?.position?.x;
    if (turretX == null) return true;
    const world = new THREE.Vector3();
    def.turret.group.getWorldPosition(world);
    return Math.abs(h.actor.root.position.x - world.x) < 100;
  }

  _turretFire(dt) {
    const run = this.d.run();
    const def = this.d.defences?.();
    const grid = run.systems.defence;
    if (!def || !grid.online || grid.hp <= 5) return;
    // The turret is a penthouse fixture, but nothing checked that the fight was
    // on its floor. Floors sit 200 world-units apart on X, so a basement breach
    // had the ceiling gun firing at ~1200m for a floored 3% hit chance while
    // wearing the defence grid down ~14hp/min. Same bug the v0.3.0 pass fixed
    // for _castFire; the turret was missed.
    const alive = this.hostiles.filter((h) => h.hp > 0 && this._onTurretFloor(h));
    if (!alive.length) return;

    // yoke tracks the closest hostile continuously
    const turret = def.turret;
    const target = alive[0];
    const world = new THREE.Vector3();
    turret.group.getWorldPosition(world);
    const tp = target.actor.root.position;
    turret.yoke.lookAt(tp.x, 1.2, tp.z);

    this._turretT += dt;
    if (this._turretT < cfg('combat.turretPeriod', 2.6)) return;
    this._turretT = 0;

    const skill = 20 + grid.hp * 0.55;    // a healthy grid shoots straight
    const dist = world.distanceTo(tp);
    const res = resolveAttack({ weapon: weapons().smg, skill, distance: Math.max(2, dist * 0.6) }, this.d.rng);
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
      const weapon = weapons()[h.arch.weapon];
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
              // the cast can actually fall now — Character.hurt() clears `alive`,
              // which every targeting/AI/relationship filter has always read but
              // nothing ever set. The dead drop out of `targets` next update.
              if (best.char.hurt(res.damage, 'wounds')) {
                this._castMourn(best.char);
              }
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
          emit('combat.waveIncoming', { inSec: cfg('combat.waveDelay', 6) });
        }
        if (this._waveCountdown >= cfg('combat.waveDelay', 6)) {
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
      const leftover = this.hostiles.filter((h) => h.hp <= 0 && !h.looted);
      if (leftover.length) {
        feed('The floor is clear. Strip the fallen before they go cold.', 'combat');
      } else {
        feed('The floor is clear.', 'combat');
      }
      emit('hud.alert', { text: 'THREAT NEUTRALIZED', kind: 'info' });
      for (const c of Object.values(this.d.cast())) {
        if (!c.alive) continue;   // no relief, no idle clip, no queue for the fallen
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
    // Tag the corpses THIS fight owns. A queued event can start a new fight ~5
    // real seconds later (tick.js re-queues blocked events at +5 game-min), well
    // inside this window — and the stale timer then disposed the NEW wave's
    // actors and emptied `hostiles`, so update() saw no one alive and resolved
    // the fresh breach as an instant phantom victory.
    const generation = ++this._generation;
    setTimeout(() => this._cleanup(generation), 14000);
    this._onResolve?.(win);
  }

  /** @param {number} [generation] only clean up if no new fight has started */
  _cleanup(generation) {
    if (generation != null && generation !== this._generation) return;
    if (this.active) return;   // a new fight owns the field now
    for (const h of this.hostiles) {
      if (h.hp <= 0 && !h.looted) this._lootBody(h);
      this.d.stage.scene.remove(h.actor.root);
      h.actor.dispose();
      if (this.d.picker?.targets) {
        this.d.picker.targets = this.d.picker.targets.filter(
          (t) => t.id !== h.id && t.id !== `${h.id}_loot`);
      }
    }
    this.hostiles.length = 0;
  }
}
