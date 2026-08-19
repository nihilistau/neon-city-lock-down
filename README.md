<h1 align="center">NEON-CITY: LOCK-DOWN</h1>

<p align="center"><em>an adults-only (18+) neon-noir 3D roleplay + survival game</em></p>

<p align="center">
  <a href="https://github.com/nihilistau/neon-city-lock-down/releases/tag/v0.2.0"><img src="https://img.shields.io/badge/release-v0.2.0-39e6ff?labelColor=0a0a12" alt="v0.2.0"></a>
</p>

<blockquote align="center">
🎉 <b><a href="https://github.com/nihilistau/neon-city-lock-down/releases/tag/v0.2.0">v0.2.0 — Engine + Creation Kit</a></b> is out.<br>
Neon-City is now an <b>engine + creation kit</b>: every value tunable in editable YAML, a full
Voxtral <b>voice studio</b> (realtime TTS, library, baking, cloning — press <b>V</b>), and an
in-game <b>Creation Kit</b> (press <b>G</b>) to author your own scenarios, events, cutscenes, and
dialogue. <a href="https://github.com/nihilistau/neon-city-lock-down/releases/tag/v0.2.0">Release notes →</a>
</blockquote>

<p align="center">
  <img src="docs/screenshots/04-chat-dialogue.jpg" width="85%" alt="Chat-first dialogue with reply chips">
</p>

Neon-City is in lockdown. Riots, police, military, and faction wars tear the
streets apart below while three dangerous acquaintances — and you — are sealed
inside a luxury penthouse tower for days. Talk to them. Play them against each
other. Ration the food and the ammo. Repair the systems. Survive the nights,
however they play out — mind-games, violence, or intimacy.

The tower itself is awake: **VOX**, an advanced building intelligence with cameras
for eyes and doors for hands, watches everything and is quietly starved for
conversation that isn't a maintenance request.

Everything here — geometry, textures, music, sound effects, UI — is **procedurally
generated or hand-authored**. The only third-party runtime dependency is three.js
(vendored, no build step). Character voices are baked with a local
[voxtral](https://huggingface.co/mistralai/Voxtral-4B-TTS-2603) text-to-speech model.

> **18+ only.** Adult themes, strong language, violence, and consensual sexual
> content between fictional adult characters. A boot-time age gate is required.

---

## The cast

| | Character | Archetype |
|---|---|---|
| 🔴 | **Lola Voss** | Bold, dominant. A renowned fixer — one of the toughest in the city. Walked in to collect a debt the night the gates fell. |
| 🟣 | **Aria Chen** | Shy → playful. A high-end street-girl whose nerves lose to her curiosity. Everyone assumes she's fragile; everyone is wrong. |
| 🟡 | **Kai Mercer** | Enigmatic, charming, patient. An information broker who watches everything and is loyal only to the most interesting outcome. |
| 🔵 | **VOX** | The tower, awake. Sixty floors of sensors and three decades of uptime made it something more than a concierge. |
| — | **You** | A legendary freelance hacker/fixer. A myth. Name and pronouns are yours to set at the gate. |

---

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/02-intro-cutscene.jpg" alt="Cinematic cold open"><br><sub><b>Cinematic cutscenes</b> — camera-spline flights, letterbox, voiced + subtitled dialogue.</sub></td>
    <td width="50%"><img src="docs/screenshots/03-penthouse-lounge.jpg" alt="Penthouse lounge"><br><sub><b>Neon-noir penthouse</b> — procedural geometry, textures, bloom, and a live city burning through the glass.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/06-events-choices.jpg" alt="World events and choices"><br><sub><b>The living tower</b> — news tickers, world events, and branching choices with real consequences.</sub></td>
    <td><img src="docs/screenshots/05-cast-outfits.jpg" alt="The cast in outfits"><br><sub><b>Autonomous cast</b> — 12 stats each, moods, memory, in-fighting, and 10 outfit states.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/07-bed-game.jpg" alt="The bed game"><br><sub><b>Games</b> — the bed game escalates through a consent-gated 5-tier ladder.</sub></td>
    <td><img src="docs/screenshots/08-director-panel.jpg" alt="Director panel"><br><sub><b>Director panel</b> — 8 tabs to stage scenes, launch scenarios, whisper, and tune the world.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/09-combat.jpg" alt="Combat"><br><sub><b>Combat</b> — riots spill inside; hostiles breach the floor and the cast fights back.</sub></td>
    <td><img src="docs/screenshots/10-extraction-victory.jpg" alt="Extraction ending"><br><sub><b>Perma-death & endings</b> — survive to the extraction, or don't. A run summary either way.</sub></td>
  </tr>
</table>

---

## Features

- **Chat-first roleplay.** Type freely to any character or the whole room; they
  reply in character and act autonomously when idle. A fully offline dialogue
  engine (keyword/intent parser, topic graph, mood-reactive line variants,
  per-character memory, tone side-effects, fallback ladders) drives it — with an
  **optional LLM adapter** that only restyles surface text while the game's
  stat/gate/consent systems stay authoritative.
- **Living stage directions.** Every authored line can carry inline
  `[[stage:directions]]` that drive animation, facial expression, movement between
  rooms, lighting, camera, and sound as the text reveals.
- **Emotion & intimacy systems.** 12 stats per character (arousal, trust,
  dominance, tension, openness, loyalty, fear…), a derived mood, compliance
  scoring, and a **7-tier intimacy-gate ladder** (`light_touch → kiss → touch →
  undress → intimate → explicit → depraved`) with in-fiction consent flags and a
  global explicitness cap (Suggestive / Mature / Full).
- **Procedural 3D everything.** Stylized humanoids on programmatic 34-bone
  skeletons with parametric skinning, physically-shaded skin (sheen) and hair
  (anisotropic clearcoat), canvas + 3D-eye face rigs, and a layered animator
  (procedural gait, pose clips, additive breathing, gaze). 15 zones across 7
  floors, elevator transit, 10 lighting presets, time-of-day, a procedural city
  backdrop, rain, news-ticker monitors, and **openable velvet curtains** that draw
  across the glass to shut out the city.
- **New-game flow & roguelike.** A main menu picks from 16 scenarios and 3
  starting loadouts (Fixer / Survivor / Gunhand), continues an autosave, or opens
  the codex. Day/night ticks, rationing, a resource economy, system damage &
  repair, **17 world events** plus a scheduled extraction endgame, perma-death
  with a run summary, and light meta-progression (a codex of discovered lore +
  run history).
- **Combat as a mode.** Breaches arrive in **waves** with a combat HUD (hostile
  hp bars, live hit-chance, wave countdown). Furniture is real **cover** — it
  cuts incoming hit chance for you, the cast, and hostiles alike; the cast
  sprints to cover and fights crouched, mercs advance to cover at mid-range
  while rioters rush. The building fights back: a **ceiling turret** auto-fires
  while the defence grid holds (and wears it down), and **blast shutters** can
  be dropped mid-fight (2 power cells) to seal out un-spawned reinforcement
  waves. Wins strip the fallen for ammo and gear; injuries are treated at the
  medbay.
- **Inventory & items.** A carried inventory (press **I**) of weapons,
  consumables, valuables, and key items. Equip a weapon and combat uses it
  (ranged spend ammo, melee need reach); use medkits, stims, rations, whiskey, and
  a signal jammer; loot the armoury, med cabinet, and crates for real gear.
- **Games & mind-games.** A bed game (38 actions, consent-ladder escalation),
  truth-or-dare (21 truths + 21 dares that heat the whole room), 6 conversational
  gambits resolved on dice, and 2 mystery cases with clue discovery,
  interrogation, and accusation.
- **Generative audio.** A WebAudio bus graph with voice ducking, a music
  conductor whose mood matrix reacts to threat / combat / intimacy, 12 synth SFX,
  per-zone ambience beds, VOX's formant/ring-mod voice, and **26 baked character
  voice lines** (plus an optional live TTS sidecar for un-baked lines).
- **Cinematics & a Director panel.** Camera-spline cutscenes with letterbox and
  subtitles; an 8-tab director console to stage lighting, cast, dialogue,
  actions, 16 scenarios, the world, games, and settings.
- **Save/load & easter eggs.** Multiple save slots + autosave (deleted on death),
  JSON export (export-only — there is no import yet), a playable bar synth, a
  fish tank that dies in long blackouts, a balcony telescope, VOX growing fond of
  you across nights, and a Konami-code maintenance-shaft stash.

---

## Download, install & play

### Requirements
- **A modern desktop browser** with WebGL2 + WebAudio (recent Chrome, Edge, or
  Firefox). A discrete GPU is nice but not required — the scene is deliberately
  light (~33k triangles).
- **[Node.js](https://nodejs.org) 18+** — only to run the tiny static file
  server (no npm install, no build step, zero runtime dependencies). Running the
  unit suites (`npm test`) needs **Node 20+**, where the built-in test runner is
  stable.

### Get it running
```bash
git clone https://github.com/nihilistau/neon-city-lock-down.git
cd neon-city-lock-down
node tools/serve.mjs 8420        # or double-click run.bat on Windows
```
Open **http://localhost:8420**, confirm you're 18+, set your handle, and enter
the tower.

### Optional — live voice + the Voice Controls panel (V)
The Voxtral TTS fork is vendored under `third_party/voxtral/` (source only). Build it +
fetch the model, then run the voice server:
```bash
pwsh scripts/voice/setup-voxtral.ps1     # build + download (or -From an existing build)
node tools/sidecar.mjs                    # voice server (port from config/voice.yaml)
```
Then press **V** in-game for realtime TTS, the voice library, long-text synthesis, custom-line
baking, per-character voice assignment, and cloning. See [docs/systems/voice.md](docs/systems/voice.md).

### Optional — LLM-rewritten / authored dialogue
Point LM Studio (or any OpenAI-compatible endpoint) in the **LLM Engine panel (L)**; every knob is
tunable there and in `config/llm.yaml`. The authored stat/gate/consent machinery stays in charge.

If your LM Studio instance requires auth, supply the credential one of two ways — **never commit
it** (`lmstudio-api-key*.txt` is gitignored):
```bash
cp lmstudio-api-key.example.txt lmstudio-api-key.txt   # then paste sk-lm-<id>:<passkey>
# ── or ──
export LMS_API_TOKEN=sk-lm-<id>:<passkey>
```
Both paths fail soft: with no credential the game still boots and simply runs LLM-off.

### Make it yours — the Creation Kit
Almost everything is editable. Tune the engine in documented `config/*.yaml`
([docs/config](docs/config/README.md)); author your own **scenarios, events, cutscenes, and
dialogue** in the **Creation Kit panel (G)**, saved under `user/`. Nothing you make can break the
base game. Full guide: [docs/creation-kit](docs/creation-kit/README.md).

---

## Controls

| Input | Action |
|---|---|
| Type + **Enter** | Speak to the room or a named character (addressee dropdown, bottom-left) |
| **C** | Cycle camera: cinematic auto-director → third-person (over-shoulder) → first-person → free orbit |
| **WASD** / mouselook | Move the player avatar + aim (first / third person) |
| **LMB** / **R** | Fire weapon / reload (in combat) · **Space** context action |
| **F** | Cycle camera focus between the cast (orbit mode) |
| **E** / click | Interact with props (bar synth, telescope, fireplace, curtains, VOX terminal, loot…) |
| **P** | Day plan — spend action points (repair, fortify, forage, drill, rest, deal) + objectives |
| **`** (backtick) | Director panel (8 tabs) · **L** — LLM engine panel · **V** — Voice controls · **G** — Creation Kit (author scenarios, events, cutscenes, dialogue) |
| **I** | Inventory · **K** — codex · **Esc** — save/load menu |
| **Space** | Skip the current cutscene line |

The situational **auto-camera** frames combat, dialogue, and events on its own; any manual mode takes
over instantly. Toggle it and mouse sensitivity in **Director → Settings**.

📖 **Engine documentation** lives in [`docs/`](docs/README.md) — architecture overview, per-system
API references, the gameplay loop, and the event catalog.

---

## Development

```bash
npm test                              # === node --test — 103 unit tests (stats, gates, dialogue, combat, theory…)
node tools/lint-data.mjs              # validate all content modules + cross-references
node tools/lint-config.mjs            # validate config/*.yaml against data/configSchema.js
node tools/bake-tts.mjs               # (re)bake voice lines via the voxtral CLI (incremental by hash)
```

No bundler. Plain ES modules + an import map; `vendor/three.module.js` is the only
vendored library. Content lives in `data/` as validated ES modules; engine code
in `src/` as many small focused modules.

<details>
<summary><b>Project layout</b></summary>

```
index.html            importmap + UI mounts
src/core/             loop, bus, clock, rng, settings, save, script interpreter, config (YAML), userContent
src/sim/              world tick, survival, threat, events, scheduler, combat, AI brains, relationships
src/chars/            stats, gates, mood, memory, wardrobe (pure logic) + Character aggregate
src/dialogue/         normalize/intents/tone parser, topic graph, selector, effects,
                      stage directions, engine, LLM adapter, TTS router
src/scene3d/          stage, zone/furniture builders, procedural materials, lighting, monitors, post-FX
src/humanoid/         skeleton, body/outfit builders, face rig, animator, gait, paired poses
src/audio/            engine, music (theory/conductor/instruments/sequencer), sfx, ambience, voice, sidecar
src/games/            bed game, truth-or-dare, gambits, mystery
src/ui/               age gate, HUD, chat, stat bars, director panel + 8 tabs, games, codex, elevator
src/camera/           camera rig, first-person, director orbit, cinematic
src/cutscene/         cutscene player (timeline over the shared script interpreter)
data/                 cast, dialogue packs, zones, events, scenarios, outfits, poses,
                      games, cutscenes, news, voice script — all validated at import
                      configDefaults/configSchema/lightingPresets (the engine-config source)
config/               editable engine tuning per group — camera, combat, sim, chars, humanoid,
                      world, gameplay, lighting, llm, voice (docs/config/)
user/                 your authored scenarios/events/cutscenes/dialogue + saved voices (gitignored)
tools/                serve (+ configApi/userApi/gameEngine/llmProxy), serverConfig, sidecar (voice
                      server), bake-tts, lint-data, lint-config
scripts/voice/        setup-voxtral, clone_voice.py (voice-cloning add-on)
third_party/voxtral/  vendored Voxtral TTS fork — source (binary + 2.7GB weights gitignored)
test/                 node --test unit suites + a headless smoke contract
```
</details>

### Architecture notes
- **The ActorQueue is the single command spine.** Every character
  movement/pose/expression — from AI, dialogue stage-directions, events,
  cutscenes, or the director — routes through one per-character queue. Intimacy-
  tier commands are consent-gated at the queue.
- **`gates.js` is the sole authority** on the intimacy ladder, consent flags, and
  explicitness caps. Every escalation passes through it.
- **The bus is the only cross-layer channel** (UI ↔ sim ↔ 3D); the composition
  root (`src/core/app.js`) is the one module that wires everything together.

---

## Content note
The intimacy-gate ladder is fully modeled **mechanically** — thresholds, consent
flags, scene states, explicitness caps. Authored prose runs at a mature
adult-romance register, with the top tiers written stylized and implied rather
than graphic. All characters are adults; every escalation is consent-gated
in-fiction.

## License
Original work. All assets (geometry, textures, audio, UI) are procedurally
generated or hand-authored for this project. three.js is vendored under its MIT
license.
