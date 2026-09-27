# config/chars.yaml

The character stat model + bond tuning (`src/chars/stats.js`, `src/chars/bond.js`). The 9 stat
keys and the bond tier **order** are structural (code); everything below is config-tunable.
`cfg()` falls back to `CONFIG_DEFAULTS.chars`, so Node unit tests use defaults.

## `startStats`

The `defaultStats()` baseline (0..100) each character starts from before its persona applies
overrides. Keys: the 9 stats — `happiness, openness, dominance, trust, tension, energy, sobriety,
loyalty, fear`.

## `coupling` — cross-stat gain modifiers

How the current state scales an incoming stat gain (`couplingFactor`). All roughly 0..2.

| Key | Default | Effect |
|-----|---------|--------|
| `intoxOpen` | 0.5 | Intoxication (low sobriety) amplifies openness gain. |
| `fearClose` | 0.4 | Fear suppresses openness gain. |
| `tensionTrust` | 0.4 | Tension suppresses trust gain. |
| `fearTension` | 0.35 | Fear amplifies tension gain. |

## `decay` — passive homeostasis (`decayTick`)

| Key | Default | Effect |
|-----|---------|--------|
| `rest` | `{tension:22, fear:4}` | Target each stat bleeds toward. |
| `rate` | `{tension:0.25, fear:0.4}` | Per-minute fall rate. |
| `approachFactor` | 0.3 | When below rest, rise at this fraction of the fall rate. |
| `sobrietyRegain` | 0.35 | Sobriety recovered per minute. |

## `compliance` — how likely an NPC accepts asks (`compliance()`)

Weighted blend (weights 0..1) of `trust, openness, happiness, loyalty`, plus `calm` on
`(100-tension)` and `brave` on `(100-fear)`. A dominance clash subtracts
`clamp((npcDominance - playerDominance) · clashScale, clashMin, clashMax)`.

## `bond` — the relationship tier (`src/chars/bond.js`)

A character's bond with the player (`stranger → ally → trusted → loyal`) is derived from the
bond score `(trust + loyalty) / 2`; it is never stored as truth.

| Key | Default | Effect |
|-----|---------|--------|
| `thresholds` | `{ally:35, trusted:55, loyal:75}` | Score needed to *enter* each tier. |
| `hysteresis` | 5 | A tier already held survives until the score drops below `entry − hysteresis`, so a character hovering on a line doesn't flicker between tiers. |

What the tiers unlock: bond-conditioned dialogue (`bondAtLeast` / `bondBelow`), inviting a character
to sit on the bed (ally), and asking them to stay the night (trusted). Raising a threshold makes all
of those harder to reach.

_Mood scoring (`src/chars/mood.js`) stays in code — its per-mood score functions are logic,
not flat tuning._
