# Usage Guide

## CLI — Speech Recognition (ASR)

### Basic transcription

```bash
# Q4 quantized (fast, ~2.5 GB model)
voxtral transcribe --audio recording.wav --gguf models/voxtral-q4.gguf

# BF16 full precision (slower, ~9 GB model)
voxtral transcribe --audio recording.wav --model models/voxtral
```

### With TUI waveform display

```bash
voxtral transcribe --audio recording.wav --gguf models/voxtral-q4.gguf --tui
```

This opens a terminal interface showing a live waveform and transcription text. Press `q` to exit.

### Multiple files

```bash
voxtral transcribe --audio file1.wav --audio file2.wav --gguf models/voxtral-q4.gguf
```

### From a file list

```bash
echo "audio1.wav\naudio2.wav" > files.txt
voxtral transcribe --audio-list files.txt --gguf models/voxtral-q4.gguf
```

### Tuning parameters

```bash
# Lower latency (less lookahead, faster but slightly less accurate)
voxtral transcribe --audio file.wav --gguf models/voxtral-q4.gguf --delay 3

# Longer audio (chunk into smaller pieces)
voxtral transcribe --audio long_file.wav --gguf models/voxtral-q4.gguf --max-mel-frames 800
```

## CLI — Text-to-Speech (TTS)

### Basic synthesis

```bash
# BF16 (higher quality)
voxtral speak --text "Hello, how are you today?" --voice casual_female

# Q4 quantized (faster, real-time capable)
voxtral speak --text "Hello, how are you today?" --gguf models/voxtral-tts-q4.gguf --euler-steps 3
```

### List available voices

```bash
voxtral speak --list-voices
# Output: 20 voices across 9 languages
```

### Output options

```bash
# Custom output path
voxtral speak --text "Hello" --voice warm_male --output greeting.wav

# More Euler steps = higher quality, slower
voxtral speak --text "Hello" --voice casual_female --euler-steps 8
```

## Browser (WASM + WebGPU)

### Quick start

1. Build the WASM package:
   ```bash
   wasm-pack build --target web --no-default-features --features wasm
   cp -r pkg/ space/pkg/
   ```

2. Start the dev server:
   ```bash
   bun serve.mjs
   # or: node serve.mjs
   ```

3. Open `https://localhost:3000` in Chrome 113+ (WebGPU required)

4. Click "Load Weights" — downloads ~2.5 GB Q4 model (cached after first load)

5. Record from microphone or select an audio file

The browser interface includes a real-time waveform visualizer that shows audio amplitude during recording (orange) and file playback (blue).

### Requirements

- Chrome 113+, Edge 113+, or Firefox Nightly with WebGPU enabled
- HTTPS (required for WebGPU secure context) — `serve.mjs` provides self-signed cert
- ~4 GB free RAM (WASM address space constraint)

## Rust API

### Transcription (native)

```rust
use voxtral_mini_realtime::audio::{load_wav, resample_to_16k, AudioBuffer};
use voxtral_mini_realtime::audio::mel::{MelConfig, MelSpectrogram};
use voxtral_mini_realtime::gguf::loader::Q4ModelLoader;
use voxtral_mini_realtime::tokenizer::VoxtralTokenizer;

// Load model
let mut loader = Q4ModelLoader::from_file("models/voxtral-q4.gguf")?;
let model = loader.load(&device)?;

// Load and process audio
let mut audio = load_wav("recording.wav")?;
audio = resample_to_16k(&audio)?;
audio.peak_normalize(0.95);

// Compute mel spectrogram and run inference
let mel = MelSpectrogram::new(MelConfig::voxtral());
// ... (see src/bin/voxtral/transcribe.rs for full pipeline)
```

### Ring buffer (for visualization)

```rust
use voxtral_mini_realtime::audio::RingBuffer;

let mut rb = RingBuffer::from_duration_secs(3.0, 16000);
rb.push_slice(&audio_samples);

// Get peaks for rendering (e.g., 80 columns wide)
let peaks = rb.snapshot_peaks(80);
```

### TUI state (for custom integrations)

```rust
use voxtral_mini_realtime::tui::TuiState;

let state = TuiState::new();
state.push_audio(&samples);
state.set_transcription("Hello world");
state.set_status("listening...");

// Run on main thread (blocks until user quits)
voxtral_mini_realtime::tui::run_tui(&state)?;
```
