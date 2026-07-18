# Combat

Real-time-lite combat that plays as a mode: cover, defences, waves, loot, and real FPS/TPS
shooting with a visible player avatar. Pure math is separated from the three.js controller.

## Modules
- `src/sim/combat/resolver.js` — pure math. `WEAPONS`, `HOSTILE_ARCHETYPES`, `hitChance(a)`,
  `resolveAttack(a, rng)`, `rollInjury(damage, rng, atMinute)`.
- `src/sim/combat/cover.js` — pure AABB cover. `coverBetween(pos, from, colliders) → 0..1`,
  `findCoverSpot(colliders, threat, near, walkable)`.
- `src/sim/combat/combat.js` — the `Combat` controller (spawns, waves, AI, defences, resolution).
- `src/scene3d/combatFx.js` — `CombatFx`: pooled tracers, muzzle flashes, impact sparks; backs
  `world.particles(kind, pos)`.
- `src/ui/combatHud.js`, `src/ui/reticle.js` — wave/HP/turret HUD, crosshair + ammo readout.

## Resolver math (`resolver.js`)
```
hitChance = clamp(accuracy · distFactor · skillFactor · coverFactor · dodgeFactor, 0.03, 0.98)
  distFactor  = 1/(1 + max(0, distance-1)/range)
  skillFactor = 0.6 + skill/100·0.55
  coverFactor = 1 - cover·0.5
```
`WEAPONS`: `sidearm [12,22]/0.78/9m`, `smg [8,14]/0.60/7m` (ranged); `pipe`, `shiv` (melee).
`HOSTILE_ARCHETYPES`: `rioter` (hp45, rushes), `looter` (hp35), `merc` (hp70, holds cover, smg).

## Combat controller (`Combat`)
Constructed in `app.js` with accessor deps: `run, cast, playerMarker, rng, sfx, picker, equipped,
colliders, defences, walkable, giveItem, fx, playerSkill`.

- `start({ spawnAt, waves|count, archetype, onResolve })` — loads the **magazine** from the ammo
  reserve for the equipped weapon, spawns wave 1, sends the cast to cover, emits `combat.started`.
- `fireRay(camera)` — **FPS/TPS fire**: raycasts the crosshair against hostiles → `playerShoot(hit)`;
  a clean miss spends a round + tracer into the distance. Wired to `firstPerson.onFire` (LMB).
- `playerShoot(h)` — resolves one attack (weapon, `playerSkill()`, distance, the target's cover),
  spends a magazine round, emits `combat.mag`/`combat.hit`, damages via `_damageHostile`.
- `reload()` — refills the magazine from `resources.ammo` (R). Unspent rounds return to the reserve
  on `_resolve`.
- `update(dt)` — hostile AI (rushers close to melee; mercs move to cover and hold), cast return
  fire, the ceiling turret, wave management. Every shot emits a muzzle flash + tracer via `_fxShot`.
- `dropShutters()` — 2 power cells seal out un-spawned waves.

## FPS / TPS integration
Combat is **camera-agnostic**. `fireRay`/`playerShoot`/`_damageHostile` don't care whether the shot
came from a first-person crosshair, a third-person crosshair, or the old picker-click. The camera
controller (`src/camera/firstPerson.js`) owns the player avatar + aiming; on LMB it calls
`onFire → combat.fireRay(camera)`. Player combat skill comes from `run.player.skill` (raised by the
day-plan **Drill Combat** action).

## Events emitted
`combat.started {waves}`, `combat.wave {wave,total}`, `combat.waveIncoming {inSec}`,
`combat.shutters {sealed}`, `combat.resolved {win}`, `combat.mag {mag,magSize,reserve}`,
`combat.hit {crit}`, `player.health {health}`, plus `hud.alert`, `resources.changed`,
`systems.changed`.
