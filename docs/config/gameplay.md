# config/gameplay.yaml

Bed-game desire / climax / safeword tuning (`src/games/bedGame.js`). Defaults in
`data/configDefaults.js` → `gameplay`. Escalation still routes through the intimacy gate
(`config/chars.yaml` → `gates`); this group tunes the bed game's own willingness + payoff.

## `bed`

| Key | Default | Effect |
|-----|---------|--------|
| `startTrust` / `startArousal` | 15 / 20 | Start gate: the partner engages if `trust ≥ startTrust` **or** `arousal ≥ startArousal`. |
| `willing.arousal / .horniness / .trust / .openness` | 0.42 / 0.30 / 0.16 / 0.12 | Desire weights: `desire = Σ weightᵢ · statᵢ`. |
| `willing.tension / .fear` | 0.22 / 0.45 | Resistance weights: `resist = tension·w + fear·w`; willingness `score = max(0, desire − resist)`. |
| `willing.base` / `willing.perTier` | 18 / 5 | Bar to clear per tier: `need = base + tierIndex · perTier` (kiss 23 … depraved 48). |
| `climaxTier` | 4 | Climax only from actions at this tier or higher. |
| `climaxPleasure` / `climaxArousal` | 82 / 70 | …and when the partner's pleasure ≥ / arousal ≥ these. |
| `safewordGap` | 30 | The partner withdraws when `tension > arousal + safewordGap`. |

The desire model (not obedience/compliance) is deliberate: a dominant, guarded character who
is genuinely aroused can still consent. Lower `startTrust`/`willing.base` to make partners
more forward; raise `safewordGap` to make them more resilient before pulling back.
