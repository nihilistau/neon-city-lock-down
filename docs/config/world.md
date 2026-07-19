# config/world.yaml

Game-clock tuning (`src/core/clock.js`). Defaults in `data/configDefaults.js` → `world`.
`MINUTES_PER_DAY` (1440) is structural and not exposed.

## `clock`

| Key | Default | Effect |
|-----|---------|--------|
| `startHour` | 18 | Hour of day the run begins (Day 1 opens at dusk). |
| `speed` | 1 | Game minutes per real second — raise for faster days, lower for a slower burn. |
| `dawnStart` | 5 | Hour the `dawn` phase begins. |
| `dayStart` | 8 | Hour the `day` phase begins. |
| `duskStart` | 17 | Hour the `dusk` phase begins. |
| `nightStart` | 20 | Hour the `night` phase begins (wraps to `dawnStart`). |

The four boundaries must ascend; each phase runs from its start to the next. Phase drives
ambience, threat night/dusk boosts, and the neon_night time-of-day lighting sweep.

_(Audio bus volumes are player preferences in `settings.js` / the Settings tab, not engine
config, so they're not a config group.)_
