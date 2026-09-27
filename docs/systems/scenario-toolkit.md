# Scenario Creation Toolkit

Author your own **scenarios, world events, cutscenes, and dialogue** in-game, save them, and
play them immediately — no code, no rebuild. Press **G** for the Creation Kit.

## How it works

```
user/<category>/<name>.json   ← your content (scenarios | events | cutscenes | dialogue)
tools/userApi.mjs             ← GET/POST/DELETE /api/user (served by tools/serve.mjs)
src/core/userContent.js       ← boot loader: registers user content into the live game
src/ui/kitPanel.js            ← the Creation Kit editor (press G)
```

At boot (`main.js` → `loadUserContent()`), every file under `user/` is validated and registered
**alongside the built-ins**, then the game runs. **Fail-soft:** a bad file is skipped with a
collected error (shown in the Kit panel) and never crashes boot; built-in content is untouched.
`user/` is gitignored — it's your workspace.

Registration targets:

| Category | Registered into | Play/Test |
|----------|-----------------|-----------|
| scenarios | the `SCENARIOS` map | **Play** → `launchScenario` (applies to the current run) |
| events | the `EVENTS` map (numeric `weight` wrapped to a fn) | **Test** → fires the event now |
| cutscenes | a name→steps registry | **Play** → plays the cutscene |
| dialogue | `registerTopics` (same as `data/dialogue/*`) | live in conversation |

## The Kit panel (press G)

Pick a **category tab**, then either start from the template, **load a built-in** as a template
(◇), or **load one of your saved items** (●). Edit the JSON, with a live **REFERENCE** cheatsheet
under the editor (available lighting presets, event ids, zones, the step vocabulary, the topic
schema). Then:

- **💾 Save + Register** — validates + registers live, then writes `user/<cat>/<name>.json`.
- **▶ Play / Test** — registers + launches the scenario / fires the event / plays the cutscene.
- **🗑 Delete** — removes the saved file (the registered copy persists until reload).
- **＋ New** — reset to the template.

## Content shapes

- **Scenario** — `{ id, title, blurb, lighting, castMoodShifts:{char:{stat:delta}},
  placements:{char:[zone,waypoint]}, fireEvent, game }`. `game` is `"cards"` (Kai's card game) or
  `"mystery:<case>"`.
- **Event** — `{ id, cls:"threat|social|system", weight:<number>, weightThreatScale?, cooldownMin?,
  maxPerRun?, window:{minDay?,phase?}, script:[steps] }`. Steps use the event vocabulary
  (`vox/news/alert/sfx/wait/light/threatSpike/resource/castStat/combat/choice/…` — see
  [event-catalog](../event-catalog.md)). The numeric `weight` becomes `(run)=>weight +
  run.threat·weightThreatScale`.
- **Cutscene** — a `[steps]` array (or `{steps:[…]}`) over the cutscene DSL
  (`light/shot/line/anim/face/teleport/look/titleCard/wait`).
- **Dialogue** — a topic `{ id:"char.pack.name", char, priority, triggers:[{intent,min}],
  cond:{…}, lines:[{text,fx}], effects:{…} }`. Line text may embed `[[tags]]` and `[player]`.

Editing the JSON files directly (any editor) works too; they load the same way at boot.
