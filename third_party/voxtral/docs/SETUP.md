# Setup Guide

## Prerequisites

- **Rust 1.75+** (stable toolchain)
- **GPU with Vulkan support** (NVIDIA, AMD, or Intel — for native builds)
- **wasm-pack** (for browser builds only)
- **Git** with access to the model weights

### Windows

```powershell
# Install Rust (if not already installed)
winget install Rustlang.Rust.MSVC

# Verify
rustc --version   # should be >= 1.75
cargo --version

# For WASM builds, add the target
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

### Linux

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

# Vulkan drivers (Ubuntu/Debian)
sudo apt install mesa-vulkan-drivers vulkan-tools
vulkaninfo | head -5  # verify Vulkan is working
```

### macOS

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
# Metal is used automatically — no extra setup needed
```

## Clone & Build

```bash
git clone https://github.com/nihilistau/voxtral-mini-realtime-rs.git
cd voxtral-mini-realtime-rs

# Native build (ASR + TTS + CLI)
cargo build --features "wgpu,cli,hub"

# Release build (significantly faster inference)
cargo build --release --features "wgpu,cli,hub"

# WASM build
wasm-pack build --target web --no-default-features --features wasm
```

## Model Weights

The models are hosted on HuggingFace. You'll need `huggingface_hub` installed via Python (`pip install huggingface_hub`) or `uv`.

### ASR — Q4 GGUF (recommended, ~2.5 GB)

```bash
uv run --with huggingface_hub hf download TrevorJS/voxtral-mini-realtime-gguf voxtral-q4.gguf --local-dir models
```

### ASR — BF16 SafeTensors (~9 GB)

```bash
uv run --with huggingface_hub hf download mistralai/Voxtral-Mini-4B-Realtime-2602 --local-dir models/voxtral
```

### TTS (~8 GB, includes voice presets)

```bash
uv run --with huggingface_hub hf download mistralai/Voxtral-4B-TTS-2603 --local-dir models/voxtral-tts
```

### WASM Shards (for browser, 5 x ~512 MB)

The WASM path requires sharded weights. Place them at `models/voxtral-q4-shards/shard-{aa..ae}`.

## Verify Installation

```bash
# Run unit tests (no model weights needed)
cargo test --features "wgpu,cli,hub" --lib -- audio:: tokenizer::

# Run GPU tests (needs Vulkan/Metal)
cargo test --features "wgpu,cli,hub" --lib -- gguf::tests

# Transcribe a test file (needs Q4 model)
cargo run --features "wgpu,cli,hub" --bin voxtral -- \
  transcribe --audio test_data/mary_had_lamb.wav --gguf models/voxtral-q4.gguf
```

## Troubleshooting

**"Vulkan not found" or GPU initialization fails:**
- Install or update GPU drivers
- On Linux: `sudo apt install mesa-vulkan-drivers`
- Verify with `vulkaninfo` or `vkcube`

**WASM build fails with "wasm32-unknown-unknown not found":**
```bash
rustup target add wasm32-unknown-unknown
```

**"shared memory bytes" panic during transcription:**
- Audio is too long for a single chunk. Use `--max-mel-frames 800` to chunk it.

**Q4 model outputs gibberish on quiet audio:**
- This is expected — the pipeline applies peak normalization automatically.
- If using the API directly, call `audio.peak_normalize(0.95)` before mel computation.
