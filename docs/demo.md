# Neon-City: Lock-Down v0.2.0 — Demo Script (~3 min)

A short presenter walkthrough of the [v0.2.0 Engine + Creation Kit
release](https://github.com/nihilistau/neon-city-lock-down/releases/tag/v0.2.0), tuned to hit the
marquee features in order of "wow."

**Setup:** `node tools/serve.mjs 8420` + `node tools/sidecar.mjs` running; LM Studio optional.
Open http://localhost:8420, pass the 18+ gate, Enter.

---

**0:00 — Cold open**
- *Do:* You're in the neon penthouse, city burning through the glass, three characters around you.
- *Say:* "Neon-City: Lock-Down — an 18+ neon-noir survival RPG where everything is procedurally
  generated. As of v0.2.0 it's not just a game, it's an **engine + creation kit**. Let me show you."

**0:20 — Everything's tunable (config layer)**
- *Do:* Open `config/lighting.yaml`, change `neon_night` accent to a new hex, save, reload the tab.
  The whole room re-tints.
- *Say:* "Every value in the engine lives in editable, documented YAML — 10 groups: camera feel,
  combat balance, event pacing, all the lighting. Edit a file, reload, done. No rebuild. And with
  no config folder at all, it boots on pure defaults — nothing to break."

**0:50 — The voice studio (press V)**
- *Do:* Type a line, pick a voice, hit **Speak** — it plays. Point at the library (20 voices),
  long-text synth, and the character-voice assignment.
- *Say:* "We vendored a Voxtral text-to-speech engine and put a studio on top. Realtime speech in
  20 voices, synthesize a whole script, bake a custom line for a character, even clone a voice from
  a clip — all in-browser."

**1:30 — The Creation Kit (press G)**
- *Do:* On the **Events** tab, tweak the template (change the `vox` line + a stat effect),
  **Save + Register**, then **Play / Test** — the event fires live in the running game.
- *Say:* "And you can author your own content — scenarios, events, cutscenes, dialogue — as JSON
  with a live cheatsheet, register it into the running game, and play it instantly. Bad input just
  shows an error; it never crashes."

**2:10 — Combat feel**
- *Do:* Press **C** to third-person, trigger a breach, aim near a hostile — the reticle sticks;
  show the weapon in-hand.
- *Say:* "Combat got the polish too — over-the-shoulder camera, weapon models, and a continuous
  sticky-aim that adheres to targets but always yields to a real flick."

**2:40 — Close**
- *Say:* "Config-driven, moddable, voiced — and it all runs from a static folder with two vendored
  deps. That's v0.2.0, the Engine + Creation Kit release. Links in the description."

---

**One-liner:** *"v0.2.0 turns Neon-City into an engine + creation kit — every value editable in
YAML, a full Voxtral voice studio, and an in-game toolkit to author scenarios, events, and
dialogue. No rebuild, boots on pure defaults."*

---

## 60-second social cut (vertical, fast)

Hook-first, on-screen captions, quick cuts. VO optional — it reads fine as captions-only.

| Time | Shot | On-screen caption | VO (optional) |
|------|------|-------------------|---------------|
| 0:00–0:03 | **HOOK** — the neon penthouse, city burning through the glass. Hard cut in. | "This whole 3D game is procedurally generated." | "No art assets. All code." |
| 0:03–0:15 | Split-screen: `config/lighting.yaml` on one side, the game on the other. Change a color → **reload → the room re-tints live.** | "Every value is editable YAML." | "Tune the whole engine in a text file. Reload. Done." |
| 0:15–0:28 | Voice panel (V): type a line → **Speak** (play the audio). Flash the 20-voice list. | "Built-in voice studio · 20 voices · cloning" | "Realtime TTS, a voice library, even voice cloning — in the browser." |
| 0:28–0:43 | Kit panel (G): edit an event's JSON → **Save + Register → Play** → the event fires in-game. | "Author scenarios, events & dialogue in-game" | "Make your own content and play it instantly — no rebuild." |
| 0:43–0:52 | Third-person combat: aim near a hostile, the reticle **sticks**; fire; weapon in hand. | "Sticky-aim combat, over-the-shoulder" | — |
| 0:52–0:60 | Title card: **NEON-CITY: LOCK-DOWN — v0.2.0** + the repo/release link. | "Engine + Creation Kit — out now" | "v0.2.0. Link below." |

**Text-post caption:** *"Turned my procedural neon-noir game into a full engine + creation kit —
every value editable in YAML, a built-in voice studio, and an in-game toolkit to author scenarios,
events & dialogue. No rebuild. v0.2.0 out now."*

**Editing notes:** lead with the live re-tint (the clearest "wow"); keep each cut ≤3s; captions
carry it muted (most social autoplays silent); end on the title card + link for ~2s.

---

## GIF storyboards

Frame-by-frame capture plans for the two hero loops — the live lighting re-tint and the Creation
Kit event firing — with real anchor frames, capture specs, and `ffmpeg`/`gifski` assembly commands:
**[GIF Storyboards →](storyboard/README.md)**.
