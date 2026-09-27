# Characters & Dialogue

The roleplay core: `src/chars/` (the pure stat/bond/mood model + the runtime Character) and
`src/dialogue/` (the turn pipeline, stage-direction grammar, and the LLM agent path). The character
modules are three.js/DOM-free and unit-tested; `Character` bridges them to the Actor3D and the bus.

## Stats (`chars/stats.js`)
`STAT_KEYS` — 9 stats, all clamped 0..100:
`happiness, openness, dominance, trust, tension, energy, sobriety, loyalty, fear`. `defaultStats()`
seeds them from `chars.startStats`.
- `applyDelta(stats, deltas, personality?) → applied` — scales each raw delta by personality
  `receptivity[key]` **and** `couplingFactor` (cross-stat coupling), clamps, returns the actually-applied deltas.
- `couplingFactor(s, key, delta)` — low sobriety amplifies openness gain and fear suppresses it;
  tension makes trust hard to earn; tension climbs faster when fearful.
- `decayTick(stats, minutes)` — tension and fear bleed toward rest values; sobriety climbs back to 100.
- `compliance(stats, playerDominance=50) → 0..100` — weighted blend (trust-heavy) minus a **dominance
  clash** when the NPC out-dominates the player. Derived on demand, never stored.

## Bond — the relationship tier (`chars/bond.js`)
The sole authority on how a character stands with the player. Ordered low→high:
`BOND_TIERS = [stranger, ally, trusted, loyal]`. The tier is **derived, never stored as truth**: it is
recomputed from the stats every time they move, so it can't drift out of sync with the dialogue, events
and objectives that move trust and loyalty.
- `bondScore(stats)` — `(trust + loyalty) / 2`.
- `bondTier(stats, prevTier?)` — the highest tier whose entry threshold the score reaches. Entry
  thresholds are `chars.bond.thresholds` (`ally 35, trusted 55, loyal 75`). **Hysteresis:** a tier the
  character already holds is kept down to `entry − chars.bond.hysteresis` (5), so a score hovering at 35
  doesn't flip ally/stranger on every line; a new tier always needs the full entry score.
- `bondAtLeast(stats, tier, prevTier?)`, `bondIndex(tier)`.

Where it's read: topic conditions (`bondAtLeast` / `bondBelow`), the ActorQueue (`minBond` on a command),
the bed (invite needs ally, stay the night needs trusted — see [The bed](#the-bed-simbedscenejs)), the stat
rail's bond chip, and the HUD toast when a bond deepens.

## Mood (`chars/mood.js`)
`MOODS` — `volatile, afraid, playful, confident, guarded, exhausted, warm`, each a stat-scoring
function plus a `face` hint + resting `idle` clip. `deriveMood(stats) → {id, face, idle}` (highest score wins).
`animTempo(stats) → 0.7..1.6` scalar (energy + tension) for tempo-scaled clips.

## Character (`chars/character.js`)
`class Character(persona, actor, queue)` — aggregates `stats, memory, mood, wardrobe, health`,
`alive`, `present`. On construction wires `queue.hooks.bondCheck = tier => this.bondAtLeast(tier)`.
- `applyStats(deltas, cause?)` — through `applyDelta` (personality-weighted, coupled); re-derives the bond,
  emits `char.stat` (carrying the current `bond`), refreshes mood.
- `get bond` / `bondAtLeast(tier)` — the tier with this character's own hysteresis applied. A real crossing
  emits `bond.changed {id, name, from, to}` and a `bond` feed line; seeding (construction/restore) is silent.
- `get compliance`, `setPlayerDominance(pd)`, `tickMinutes(minutes)`, `hurt`/`die`, `refreshMood(force?)`
  (pushes face+idle+tempo to the actor, emits `char.mood`), `serialize`/`restore` (fields a v0.5 save
  carries for retired systems are ignored).

## Memory & wardrobe (`chars/memory.js`, `chars/wardrobe.js`)
- `class Memory` — `facts`, `counters` (`bump`/`count`), `saidLines` (recency), `topicHistory`,
  `promises`, `rel` (per-character affinity/grudge), `flags` (`setFlag`/`hasFlag`). `recordLine`,
  `recordTopic`, `saidTopic`, serialize/deserialize.
- `class Wardrobe(character, initial?)` — `change(outfitId, silent?)` builds outfit layers lazily and toggles
  visibility; emits `wardrobe.changed`. Every state in `data/outfits.js` is a full outfit (street armor,
  lounge, evening, workout, swim, sleepwear, robe, towel); `initial` defaults to `DEFAULT_OUTFIT`.

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
  `rewrite` keeps the authored line's meaning, restyled in-voice. Either way, authored effects stay
  authoritative — the model only supplies surface text + stage directives.

## Parser (`dialogue/parser/*`)
- `normalize(raw)` → `{text, tokens, stems, exclaim, question, caps, wordCount}` (contraction expansion + cheap stemming).
- `matchIntents(n) → [{id, score, slots}]` (weighted keywords/phrases/regex); `captureSlots(n, vocab)`;
  `registerIntents(defs)`.
- `toneOf(n)` → axes `{affection, hostility, command, flirt, fear, dominant}`; `dominantTone(tone)` keys fallbacks.

## Topics, selection, effects (`dialogue/*`)
- `topics.js` — `registerTopics(defs)` (compiles line text, fails fast on bad tags), `topicsFor(id)`,
  `candidateTopics(char, intents, {day})` (trigger match + `condOk` + recency penalty, ranked). `condOk`
  supports `minStat/maxStat/mood/flag/notFlag/saidBefore/notSaid/fact/minCounter/dayGte/zoneAny/
  bondAtLeast/bondBelow/chance`.
- `selector.js` — `selectLine(topic, char, nowMinute, rng)` — deterministic under seed + memory:
  `score = matchedConditions×10 − recency + jitter`; keyed `topicId#index`.
- `effects.js` — `applyLineEffects(char, line, topic, {tone, nowMinute})` — line/topic stat fx, flags, facts,
  a line's `bed` field (→ `bed.requested`), **tone bleed** (hostile tone raises tension/fear and costs trust;
  warmth builds trust and happiness), memory recording; emits `dialogue.effects`.

## Stage directions (`dialogue/stageDirections.js`)
Line text carries `[[type:arg:arg2]]` tags; `compileLine(text) → {cleanText, directions:[{at, type, args}]}`
where `at` is the char offset it fires at. **Unknown tags throw at compile time.** `TAG_TYPES` (closed
vocabulary + arity): `anim, face, mood, look, move, sit, outfit, light, cam, sfx, vox, wait, fx, beat, stat`.
- `makeDispatcher(ctx) → (direction) => …` — dispatches each tag: `anim`→`pushPriority` clip, `move`/`sit`
  →queue, `outfit`→wardrobe, `light`/`cam`/`sfx`/`vox`/`fx` to facades.
- `[[stat:trust+5]]` — a character shifting their OWN stat, applied via `applyStats({...}, 'self')`
  (used by the LLM agent).

## LLM path (`dialogue/llm/*`)
`class CharacterAgent` — preferred path is the **lmstudio-engine** (`engineClient.js`): the big model streams
clean in-character prose while a tiny function model extracts structured scene directives; the legacy REST
proxy (`lmsClient.js`) is the fallback where the model emits inline `[[tags]]` we sanitize. `respond()`
returns `{text, directions}` or `null` (→ authored engine). `mode(id)` → `agent | rewrite | authored`.
Prompt assembly in `promptBuilder.js` (its `CONTRACT` is an all-audiences noir survival drama); tag
scrubbing in `tags.js`. See [../../lmstudio-engine/README.md](../../lmstudio-engine/README.md).

## The bed (`sim/bedScene.js`)
The bed is furniture. `class BedScene(ports)` is a pure state machine over injected ports (camera placement,
clock skip, fade, narration, the scheduler, the cast), so it runs under `node --test`; `app.js` wires it.
- **Player:** `use()` (E on the bed) cycles `none → sitting → lying → none`; `getUp()` also fires on a
  movement key or on leaving first person. `bedPrompt(state)` is the E-prompt text. Sitting down makes an
  NPC who was sleeping there get up.
- **Invite** (`invite(char)`) — the player must already be on the bed and the character must be at least an
  **ally**; one guest at a time. The guest clears their queue, sits at `bed.seat1`, gains a little trust, and
  their AI brain is **held** until they are dismissed, the player gets up, combat starts, or they die. The
  hold is not saved — a load always starts standing with nobody seated (`reset()`).
- **Stay the night** (`stayNight(char)`) — needs a **trusted** bond and the player on the bed. Fade to black,
  one line of narration (`BED_NARRATION` in `data/dialogue/bed.js`), `STAY_MINUTES` (180) skipped, the
  guest's rest need refilled, small happiness/loyalty gains, player morale +10, fade back. The scheduler is
  held for the whole skip (released in `finally`) so no event fires while the screen is black; `busy`
  ignores input until it ends.
- **Context gates:** `app.js` refuses bed requests during combat, an active event, or a cutscene, with a HUD
  hint (`Not in the middle of a fight.`, `Sit on the bed first.`, `There is only room for one more.`, …).
- **Reservation:** `bedUsers(chars)` counts anyone seated at a `bed.*` socket **or** with a bed sit queued,
  so two tired NPCs deciding in the same minute can't both claim it. `isFree()` is what the AI sleep action
  checks before lying down.
- Requests come from dialogue: the `data/dialogue/bed.js` topics (`bed_invite` / `bed_stay` / `bed_dismiss`
  intents) put a `bed` field on the accepting line only, so a refusal can never seat anyone.
- Emits `bedscene.state {player}`, `bedscene.guest {id, seated}`, `bedscene.evicted`, `bedscene.started/ended`.

### Events emitted
`chat.player`, `chat.reply`, `char.stat`, `char.mood`, `bond.changed`, `wardrobe.changed`,
`dialogue.effects`, `bed.requested`, `bedscene.*`, plus TTS `voice.speaking/done` / `vox.speaking/done`
(via the TTS router).
