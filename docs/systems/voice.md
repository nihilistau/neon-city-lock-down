# Voice (Voxtral TTS)

Character speech is a 4-tier router (`src/dialogue/ttsRouter.js`): baked WAV → procedural VOX
synth → **live Voxtral voice server** → silent mouth-flutter. This doc covers the Voxtral
engine, the voice server, and setup. Tuning lives in `config/voice.yaml`
([docs/config](../config/README.md) is the key reference).

## The engine (vendored fork)

The Voxtral fork is vendored at **`third_party/voxtral/`** (Rust, Burn + wgpu/WebGPU). Only the
**source** is committed; the 38 MB binary and ~2.7 GB model weights are gitignored.

### Setup

```
# copy an existing build (fastest if you have one):
pwsh scripts/voice/setup-voxtral.ps1 -From 'D:\path\to\voxtral-mini-realtime-rs'
#   or  scripts/voice/setup-voxtral.sh /path/to/voxtral-mini-realtime-rs

# …or build + download from scratch (slow — release LTO):
pwsh scripts/voice/setup-voxtral.ps1
#   cargo build --release --features "wgpu,cli,hub"  +  huggingface-cli download
```

For quick local testing without copying weights, point the server at an existing build:
`VOXTRAL_DIR=/path/to/voxtral-mini-realtime-rs node tools/sidecar.mjs`.

Assets it expects (under `voxtralDir`): `target/release/voxtral.exe`, `models/voxtral-tts-q4.gguf`
(Q4 TTS, 2.7 GB), `models/voxtral-tts/tekken.json`, and `models/voxtral-tts/voice_embedding/*.safetensors`
(20 preset voices). Needs a working GPU adapter (WebGPU/Vulkan/Metal).

### CLI contract (`voxtral speak`)

`voxtral speak --text <str> --gguf <q4.gguf> --voice <name> --voices-dir <dir> --output <wav>
--euler-steps <3|4|8> --max-frames <n>` → **WAV, 24 kHz / 16-bit / mono** (batch, not streamed).
`--euler-steps 3` is real-time-ish (RTF ≈ 0.97). A voice is a `<name>.safetensors` file holding
one tensor `embedding` of shape `[N, 3072]` BF16.

## The voice server (`tools/sidecar.mjs`)

A localhost HTTP server (port from `config/voice.yaml`, default 8425) that shells the CLI and
manages voices. Config-driven via `tools/serverConfig.mjs`; `env VOXTRAL_DIR` overrides the
engine location. Start it alongside the game: `node tools/sidecar.mjs`.

| Method | Route | Purpose |
|--------|-------|---------|
| GET  | `/health` | `{ ok, voices:[{name,kind}], voxtralDir }` |
| GET  | `/voices` | all `*.safetensors` in the preset + user voice dirs |
| POST | `/speak` `{text, voice, euler?}` | one line → `audio/wav` (cached) |
| POST | `/synthLong` `{text, voice, euler?, save?, name?}` | long text/file → sentence-chunked, concatenated `audio/wav` |
| POST | `/save` `{wavBase64, name}` **or** `{wavBase64, char, lineId, text}` | save a clip to `user/voices/`, **or** bake a character line into `assets/voice/` + manifest |
| GET  | `/library` | saved clips + available voices |
| GET  | `/clip?file=<name.wav>` | play back a saved clip |
| POST | `/clone` `{refPath\|refWavBase64, name}` | reference clip → voice embedding (Python add-on) or `501` |

The browser reaches it at `settings.tts.sidecarUrl` (CORS `*`), caching WAVs in IndexedDB.

## Voice cloning (optional add-on)

`voxtral speak` only *consumes* embeddings — turning a reference clip into one needs an extra
step. `scripts/voice/clone_voice.py` provides it:

- `--from-pt <file.pt>` — wrap an existing `.pt` embedding into `<name>.safetensors` (works today).
- `--ref <clip>` — extract an embedding from a reference clip. This needs the Voxtral speech
  encoder wired into `from_reference()` (see the fork's `scripts/reference_*.py` + mistral-common);
  until then it errors clearly and the server returns `501`, so the game and panel fall back to the
  20 presets + drop-in `.safetensors` embeddings.

Install: `pip install -r scripts/voice/requirements.txt`.

## Config

Everything above is tuned in **`config/voice.yaml`**: `voxtralDir`, `binary`, `gguf`, `voicesDir`,
`eulerSteps` (speed↔quality), `maxFrames`, `sampleRate`, `port`, the `cast` map (character → voice
preset), and `userVoicesDir` / `userDialogueDir`.
