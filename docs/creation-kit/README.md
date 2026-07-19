# Creation Kit

Neon-City ships as an **engine + creation kit**: almost everything is editable, and you can author
your own content in-game — no code, no rebuild. This is the friendly overview; each section links to
the full reference.

## What you can make

| Want to… | Where | Persists to |
|----------|-------|-------------|
| Retune how the game feels | edit `config/*.yaml` (or the panels) | `config/` |
| Author scenarios, events, cutscenes, dialogue | **Creation Kit** panel (key **G**) | `user/` |
| Make / assign / clone voices, bake custom lines | **Voice Controls** panel (key **V**) | `config/voice.yaml`, `user/voices/`, `assets/voice/` |
| Tune the LLM | **LLM Engine** panel (key **L**) + `config/llm.yaml` | `config/llm.yaml`, browser settings |

Nothing you make can break the base game: with no `config/` or `user/` folder it boots on pure
defaults, and any invalid file is skipped with an error rather than crashing.

## 1. Tune the engine — `config/*.yaml`

Every tunable value lives in a documented YAML group under `config/`: camera feel, combat balance,
event pacing, the survival economy, character stat coupling + intimacy thresholds, gait, the day
clock, bed-game desire, all 10 lighting presets, the LLM, and voice. Edit a file and reload, or edit
live (the LLM/Voice panels write config for you). Full per-key reference: **[docs/config](../config/README.md)**.

> Example — make nights redder and events rarer: set `config/lighting.yaml` `presets.neon_night`
> colors, and raise `config/sim.yaml` `scheduler.minGapMin`.

## 2. Author content — the Creation Kit (key G)

Press **G** in-game. Pick a tab (**Scenarios / Events / Cutscenes / Dialogue**), start from the
template or load a built-in as a starting point, edit the JSON with the live cheatsheet, then
**Save + Register** (writes `user/<cat>/<name>.json` and registers it live) and **Play / Test**. Full
guide + content shapes: **[scenario-toolkit](../systems/scenario-toolkit.md)**.

- **Scenario** — a staged setup: lighting, cast mood shifts, placements, an opening cutscene, a
  fired event, a mini-game. *Play* applies it to the current run.
- **Event** — a scripted world beat (step list: `vox`, `alert`, `light`, `combat`, `choice`, …) with
  a weight + window. *Test* fires it now. See **[event-catalog](../event-catalog.md)**.
- **Cutscene** — a step list over the camera/line DSL (`shot`, `line`, `titleCard`, …). *Play* runs it.
- **Dialogue** — a topic (triggers + conditions + lines with `[[tags]]`), registered into the same
  engine as the built-in dialogue.

## 3. Voices — the Voice Controls panel (key V)

Press **V** (run `node tools/sidecar.mjs` first). Speak text in any of 20 voices, synthesize long
text or a `.txt` file, assign a voice to each character (saved to `config/voice.yaml`), **bake a
custom spoken line** for a character, browse/play saved clips, and **clone** a voice from a reference
clip (with the Python add-on). Engine setup + API: **[voice](../systems/voice.md)**.

## Sharing

`config/*.yaml` is committed with the project (your tuning ships with it). `user/` and saved voices
are gitignored — they're your workspace; copy the JSON/WAV files to share a scenario or voice pack.
