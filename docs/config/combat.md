# config/combat.yaml

Combat tuning: weapons, hostile archetypes, magazines, cover, turret. Defaults in
`data/configDefaults.js` → `combat`. The pure math modules (`resolver.js`, `cover.js`)
source their defaults from here (so the values match config and unit tests stay stable);
the runtime controller (`combat.js`) reads live values via `cfg('combat.…')`, so edits
hot-reload mid-run.

## `weapons` — map of weapon key → stats

Each weapon (`sidearm`, `smg`, `pipe`, `shiv`) has:

| Field | Type | Effect |
|-------|------|--------|
| `id` | string | Weapon key (matches the map key). |
| `damage` | `[min, max]` | Damage roll range. |
| `accuracy` | 0–1 | Base hit chance at close range. |
| `range` | number (m) | Distance at which accuracy roughly halves (falloff). |

Defaults: sidearm `[12,22]/0.78/9`, smg `[8,14]/0.6/7`, pipe `[6,12]/0.85/1.2`, shiv `[5,10]/0.8/1`.

## `hostileArchetypes` — map of archetype → stats

Each archetype (`rioter`, `looter`, `merc`):

| Field | Type | Effect |
|-------|------|--------|
| `hp` | number | Hit points. |
| `skill` | 0–100 | Attack competence (feeds `hitChance`). |
| `weapon` | string | Weapon key from `weapons`. |
| `speed` | number | Move speed multiplier. |
| `aggression` | 0–1 | Advance/attack eagerness. |

Defaults: rioter `45/30/pipe/1.5/0.8`, looter `35/25/shiv/1.7/0.5`, merc `70/65/smg/1.3/0.95`.

## `magSize` — map of weapon key → rounds

Rounds before a reload is needed. Default `{sidearm: 12, smg: 25, pipe: 1, shiv: 1}`.

## Top-level timing

| Key | Default | Range | Effect |
|-----|---------|-------|--------|
| `turretPeriod` | 2.6 | 0.1–60 | Seconds between automated turret shots. |
| `waveDelay` | 6 | 0–120 | Seconds between breach waves. |

## `cover`

| Key | Default | Range | Effect |
|-----|---------|-------|--------|
| `minTop` | 0.5 | 0–3 | Minimum furniture height (m) that counts as cover. |
| `maxTop` | 1.45 | 0–3 | Height at which cover saturates (taller = a wall, not crouch-cover). |
| `nearM` | 2.2 | 0.1–20 | Defender must be within this distance behind an obstacle for it to shield. |
| `tallAt` | 0.9 | 0–3 | Furniture at/above this height gives tall-cover quality. |
| `qualityTall` | 0.65 | 0–1 | Cover quality for tall furniture (`top ≥ tallAt`). |
| `qualityLow` | 0.4 | 0–1 | Cover quality otherwise. |
| `maxRange` | 14 | 1–100 | Max search range for a cover spot. |
| `offset` | 0.55 | 0–5 | Stand-off distance behind cover when taking a spot. |
