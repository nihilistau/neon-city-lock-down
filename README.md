# NEON-CITY: LOCK-DOWN

A standalone, adults-only (18+) neon-noir 3D roleplay + survival game. Three
dangerous acquaintances — **Lola Voss** (dominant fixer), **Aria Chen** (shy →
playful street-girl), **Kai Mercer** (patient watcher) — plus the tower's living
AI, **VOX**, are trapped in a luxury penthouse while Neon-City riots below. Chat
freely with any of them; they reply in character and drive a live three.js scene.
Survive the lockdown: ration food and ammo, repair systems, fend off breaches,
navigate mind-games, violence, and intimacy — however the night plays out.

Everything here is **procedurally generated or hand-authored** — geometry, textures,
music, sound effects, UI. The only third-party runtime dependency is three.js
(vendored). Character voices are baked with a local
[voxtral](https://huggingface.co/mistralai/Voxtral-4B-TTS-2603) TTS model.

## Run it

```bash
node tools/serve.mjs 8420      # or double-click run.bat on Windows
# open http://localhost:8420
```

No build step. Plain ES modules + import map.

### Optional: live voice for un-baked lines
```bash
node tools/sidecar.mjs 8425    # wraps the voxtral CLI; auto-detected in Settings
```

### Optional: LLM-rewritten dialogue
Configure an OpenAI-compatible endpoint in the Director → Settings tab. The
authored stat/gate/consent systems stay authoritative; the LLM only restyles
surface text.

## Controls
- **Chat** — type to the room or a named character (addressee dropdown, bottom-left)
- **C** — toggle first-person (WASD, mouselook, E interact, Space action) / director orbit cam
- **F** — cycle camera focus between cast · **E / click** — interact with props
- **`** (backtick) — Director panel (8 tabs) · **K** — codex · **Esc** — save/load
- Cutscenes: **Space** skips the current line

## Systems
- **12-stat emotion model** per character + compliance + derived mood; **7-tier
  intimacy-gate ladder** (`light_touch → … → depraved`) with in-fiction consent
  flags and a global explicitness cap (Suggestive / Mature / Full).
- **Chat-first dialogue engine**: keyword/intent parser, topic graph, mood-reactive
  line variants, per-character memory, tone side-effects, fallback ladders, optional
  LLM adapter. Lines carry inline `[[stage:directions]]` that drive animation,
  facial expression, movement, lighting, camera, and sound.
- **Procedural humanoids**: 34-bone skeletons, parametrically skinned bodies,
  canvas + 3D-eye face rigs, a layered animator (gait / clip / additive / gaze),
  10 outfit states each.
- **15 zones across 7 floors** (elevator transit), 10 lighting presets, time-of-day,
  procedural city backdrop + rain, news-ticker monitors.
- **Survival roguelike**: day/night ticks, rationing, resource economy, system
  damage/repair, 16 world events + scheduled extraction endgame, perma-death with
  run summary, light meta-progression (codex + run history).
- **Combat**: real-time-lite encounters, pure hit/damage/injury resolver, medbay
  treatment.
- **Games**: bed game (38 actions, consent-ladder escalation), truth-or-dare (21+21),
  6 conversational gambits (dice), 2 mystery cases.
- **Audio**: WebAudio bus graph + ducking, generative music conductor (mood matrix),
  12 synth SFX, per-zone ambience, VOX formant voice, baked + live TTS.
- **Cinematics**: camera-spline cutscenes with letterbox, subtitles, voiced lines.

## Project layout
```
index.html            importmap + UI mounts
src/core/             loop, bus, clock, rng, settings, save, script interpreter
src/sim/              world tick, survival, threat, events, scheduler, combat, AI brains
src/chars/            stats, gates, mood, memory, wardrobe (pure logic)
src/dialogue/         parser, topics, selector, effects, stage directions, engine
src/scene3d/          stage, zone/furniture builders, materials, lighting, monitors, postfx
src/humanoid/         skeleton, body/outfit builders, face, animator, gait, paired poses
src/audio/            engine, music (theory/conductor/instruments), sfx, voice, sidecar
src/games/            bed game, truth-or-dare, gambits, mystery
src/ui/               gate, hud, chat, stat bars, director panel + 8 tabs, games, codex
data/                 all content as validated ES modules (cast, dialogue, zones, events,
                      scenarios, outfits, poses, games, cutscenes, voice script)
tools/                serve, bake-tts, sidecar, lint-data
test/                 node --test unit suites
```

## Development
```bash
node --test "test/unit/*.test.mjs"    # 44 unit tests (pure logic)
node tools/lint-data.mjs              # validate all content + references
node tools/bake-tts.mjs               # (re)bake voice lines (needs the voxtral CLI)
```

Content register: the intimacy-gate ladder is fully modeled mechanically; authored
prose runs at a mature adult-romance register, with the top tiers written stylized
and implied. All characters are adults; every escalation is consent-gated in-fiction.
