# config/chars.yaml

The character stat model + intimacy-gate tuning (`src/chars/stats.js`, `gates.js`). The 12
stat keys and the 7-tier gate ladder **order** are structural (code); everything below is
config-tunable. `cfg()` falls back to `CONFIG_DEFAULTS.chars`, so Node unit tests use defaults.

## `startStats`

The `defaultStats()` baseline (0..100) each character starts from before its persona applies
overrides. Keys: the 12 stats — `arousal, pleasure, happiness, horniness, openness, dominance,
trust, tension, energy, sobriety, loyalty, fear`.

## `coupling` — cross-stat gain modifiers

How the current state scales an incoming stat gain (`couplingFactor`). All roughly 0..2.

| Key | Default | Effect |
|-----|---------|--------|
| `tensionSuppress` | 0.55 | Arousal/horniness gain reduced by this × (tension/100). |
| `fearSuppress` | 0.5 | …and by this × (fear/100). |
| `intoxArousal` | 0.4 | Intoxication (low sobriety) amplifies arousal gain. |
| `intoxOpen` | 0.5 | Intoxication amplifies openness gain. |
| `fearClose` | 0.4 | Fear suppresses openness gain. |
| `tensionTrust` | 0.4 | Tension suppresses trust gain. |
| `pleasureBase` / `pleasureArousal` | 0.3 / 0.9 | Pleasure gain = base + arousal-tracking term. |
| `fearTension` | 0.35 | Fear amplifies tension gain. |

## `decay` — passive homeostasis (`decayTick`)

| Key | Default | Effect |
|-----|---------|--------|
| `rest` | `{arousal:5, horniness:8, tension:22, pleasure:12, fear:4}` | Target each stat bleeds toward. |
| `rate` | `{arousal:0.5, horniness:0.35, tension:0.25, pleasure:0.6, fear:0.4}` | Per-minute fall rate. |
| `approachFactor` | 0.3 | When below rest, rise at this fraction of the fall rate. |
| `sobrietyRegain` | 0.35 | Sobriety recovered per minute. |

## `compliance` — how likely an NPC accepts asks (`compliance()`)

Weighted blend (weights 0..1) of `trust, openness, happiness, loyalty`, plus `calm` on
`(100-tension)` and `brave` on `(100-fear)`. A dominance clash subtracts
`clamp((npcDominance - playerDominance) · clashScale, clashMin, clashMax)`.

## `gates` — intimacy ladder

- **`thresholds`** — the minimum stats required to even *offer* each of the 7 tiers
  (`light_touch → kiss → touch → undress → intimate → explicit → depraved`). Consent + the bed
  game's desire model apply on top. Lower trust minima keep willing-but-guarded characters
  from being locked out.
- **`explicitnessCap`** — the highest tier each global explicitness setting (`suggestive`,
  `mature`, `full`) permits.

_Mood scoring (`src/chars/mood.js`) stays in code — its per-mood score functions are logic,
not flat tuning._
