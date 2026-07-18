# Characters & Dialogue

The roleplay core: `src/chars/` (the pure stat/gate/mood model + the runtime Character) and
`src/dialogue/` (the turn pipeline, stage-direction grammar, and the LLM agent path). The character
modules are three.js/DOM-free and unit-tested; `Character` bridges them to the Actor3D and the bus.

## Stats (`chars/stats.js`)
`STAT_KEYS` — 12 stats, all clamped 0..100:
`arousal, pleasure, happiness, horniness, openness, dominance, trust, tension, energy, sobriety,
loyalty, fear`. `defaultStats()` seeds them.
- `applyDelta(stats, deltas, personality?) → applied` — scales each raw delta by personality
  `receptivity[key]` **and** `couplingFactor` (cross-stat coupling), clamps, returns the actually-applied deltas.
- `couplingFactor(s, key, delta)` — e.g. high tension/fear suppress arousal & horniness gains;
  low sobriety amplifies arousal/openness; pleasure tracks arousal; tension climbs faster when fearful.
- `decayTick(stats, minutes)` — arousal/horniness/tension/pleasure/fear bleed toward rest values; sobriety climbs to 100.
- `compliance(stats, playerDominance=50) → 0..100` — weighted blend (trust-heavy) minus a **dominance
  clash** when the NPC out-dominates the player. Derived on demand, never stored.

## Gates — the sole intimacy authority (`chars/gates.js`)
No other module flips a gate. Ordered ladder, low→high:
`GATE_LADDER = [light_touch, kiss, touch, undress, intimate, explicit, depraved]`.
- `TIER_THRESHOLDS` — minimum stats to even OFFER each tier (trust/arousal/horniness/openness climbing per rung).
- `EXPLICITNESS_CAP` — `{ suggestive:'kiss', mature:'intimate', full:'depraved' }` (the global taste ceiling).
- `gateCheck(char, tier, {explicitness}) → {allowed, reason?, need?}` — requires **all five**: cap allows
  it, not withdrawn/safeworded, every lower tier already `granted` (ladder integrity), stat thresholds met,
  and in-fiction `consent.ladder[tier].given`.
- `canOffer(char, tier, settings)` — thresholds + cap + ladder, independent of consent (drives UI pips/options).
- `setGate(char, tier, action, atMinute?)` — sanctioned transitions: `offer | grant | revoke | withdraw |
  safeword | reset_withdraw`. `highestGranted(gates)`, `tierIndex(tier)`. `defaultGates()`/`defaultConsent()`.

## Mood (`chars/mood.js`)
`MOODS` — `volatile, afraid, sultry, playful, confident, guarded, exhausted, warm`, each a stat-scoring
function plus a `face` hint + resting `idle` clip. `deriveMood(stats) → {id, face, idle}` (highest score wins).
`animTempo(stats) → 0.7..1.6` scalar (arousal+energy) for tempo-scaled clips.

## Character (`chars/character.js`)
`class Character(persona, actor, queue)` — aggregates `stats, gates, consent, memory, mood, wardrobe`,
`alive`, `present`. On construction wires `queue.hooks.gateCheck = tier => this.gateCheck(tier)`.
- `applyStats(deltas, cause?)` — through `applyDelta` (personality-weighted, coupled); emits `char.stat`,
  refreshes mood.
- `gateCheck(tier)` — reads explicitness from `globalThis.__ncldExplicitness`. `gate(tier, action, atMinute?)`
  — sanctioned transition + feed + `gate.changed`.
- `get compliance`, `get topGate`, `setPlayerDominance(pd)`, `tickMinutes(minutes)`, `refreshMood(force?)`
  (pushes face+idle+tempo to the actor, emits `char.mood`), `serialize`/`restore`.

## Memory & wardrobe (`chars/memory.js`, `chars/wardrobe.js`)
- `class Memory` — `facts`, `counters` (`bump`/`count`), `saidLines` (recency), `topicHistory`,
  `promises`, `rel` (per-character affinity/grudge), `flags` (`setFlag`/`hasFlag`). `recordLine`,
  `recordTopic`, `saidTopic`, serialize/deserialize.
- `class Wardrobe(character, initial)` — `change(outfitId, silent?)` builds outfit layers lazily and toggles
  visibility; emits `wardrobe.changed`. **The logical state stays honest** (for stats/warmth) while the RENDER
  is capped by explicitness (`none`→`underwear`→`towel`).

## Dialogue engine (`dialogue/engine.js`)
`class DialogueEngine(deps)` — one player turn. `playerSays(rawText, target?, {whisper?}) → [{speaker, line}]`:
```
normalize → matchIntents + toneOf → resolveAddressee → (LLM agent? →) candidateTopics
  → selectLine → applyLineEffects → optional rewrite → _perform → maybe bystander interjection
```
- Emits `chat.player`; `_perform` emits `chat.reply` and schedules stage directions on the typewriter
  (`onReveal(offset)` fires due directions, `flushDirections()` fires the rest), then routes TTS.
- `forceSay(charId, rawText)` — Director "give line": says text verbatim (stage tags compiled).
- **LLM agent path** (`_respond`): if the char's mode is `agent`, `agent.respond(...)` AUTHORS the reply
  and returns `{text, directions}`; the text is compiled and directions merged. **Rewrite path**: mode
  `rewrite` keeps the authored line's meaning, restyled in-voice. Either way, authored effects/gates stay
  authoritative — the model only supplies surface text + non-gate directives.

## Parser (`dialogue/parser/*`)
- `normalize(raw)` → `{text, tokens, stems, exclaim, question, caps, wordCount}` (contraction expansion + cheap stemming).
- `matchIntents(n) → [{id, score, slots}]` (weighted keywords/phrases/regex); `captureSlots(n, vocab)`;
  `registerIntents(defs)`.
- `toneOf(n)` → axes `{affection, hostility, command, flirt, fear, dominant}`; `dominantTone(tone)` keys fallbacks.

## Topics, selection, effects (`dialogue/*`)
- `topics.js` — `registerTopics(defs)` (compiles line text, fails fast on bad tags), `topicsFor(id)`,
  `candidateTopics(char, intents, {day})` (trigger match + `condOk` + recency penalty, ranked). `condOk`
  supports `minStat/maxStat/mood/flag/notFlag/saidBefore/notSaid/fact/dayGte/gateAtLeast/zoneAny`.
- `selector.js` — `selectLine(topic, char, nowMinute, rng)` — deterministic under seed + memory:
  `score = matchedConditions×10 − recency + jitter`; keyed `topicId#index`.
- `effects.js` — `applyLineEffects(char, line, topic, {tone, nowMinute})` — line/topic stat fx, flags, facts,
  gate transitions, **tone bleed** (hostile tone raises tension/fear; flirt raises arousal), memory recording;
  emits `dialogue.effects`.

## Stage directions (`dialogue/stageDirections.js`)
Line text carries `[[type:arg:arg2]]` tags; `compileLine(text) → {cleanText, directions:[{at, type, args}]}`
where `at` is the char offset it fires at. **Unknown tags throw at compile time.** `TAG_TYPES` (closed
vocabulary + arity): `anim, face, mood, look, move, sit, pair, outfit, light, cam, sfx, vox, gate, wait,
fx, beat, stat`.
- `makeDispatcher(ctx) → (direction) => …` — dispatches each tag: `anim`→`pushPriority` clip, `move`/`sit`
  →queue, `outfit`→wardrobe, `gate`→`speaker.gate(tier, action)`, `light`/`cam`/`sfx`/`vox`/`fx` to facades.
- `[[stat:arousal+10]]` (**new `stat` tag**) — a character shifting their OWN stat, applied via
  `applyStats({...}, 'self')` (used by the LLM agent).
- `pair` clips carry a `gateTier` arg so the ActorQueue gate-checks them.

## LLM path (`dialogue/llm/*`)
`class CharacterAgent` — preferred path is the **lmstudio-engine** (`engineClient.js`): the big model streams
clean in-character prose while a tiny function model extracts structured scene directives; the legacy REST
proxy (`lmsClient.js`) is the fallback where the model emits inline `[[tags]]` we sanitize. `respond()`
returns `{text, directions}` or `null` (→ authored engine). `mode(id)` → `agent | rewrite | authored`.
Prompt assembly in `promptBuilder.js`; tag scrubbing in `tags.js`. See
[../../lmstudio-engine/README.md](../../lmstudio-engine/README.md).

## The bed game's willingness (`games/bedGame.js`)
Escalation is a consent ladder gate-checked through `gates.js`. On top of thresholds, willingness is
**desire-based** (`bedGame._willing`): `desire = arousal·0.42 + horniness·0.30 + trust·0.16 + openness·0.12`
minus `resist = tension·0.22 + fear·0.45`, and must clear `18 + tierIndex·5`. This replaced obedience-
"compliance" so a dominant, guarded character who is genuinely aroused isn't permanently locked out.
`act(id)` applies the action's fx; giving pleasure builds toward `_climax()` (tier≥4, pleasure≥82,
arousal≥70). A tension spike past arousal+30 triggers `_withdraw()` (revokes the top gate). Emits
`bedgame.started/state/action/climax/withdraw/ended`.

### Events emitted
`chat.player`, `chat.reply`, `char.stat`, `char.mood`, `gate.changed`, `wardrobe.changed`,
`dialogue.effects`, `bedgame.*`, plus TTS `voice.speaking/done` / `vox.speaking/done` (via the TTS router).
