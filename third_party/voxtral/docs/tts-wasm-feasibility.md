# TTS WASM / WebGPU Feasibility

Assessment of what's needed to run the TTS pipeline in the browser via WASM + WebGPU,
following the same approach as the existing ASR Q4 GGUF path.

---

## Current State

The ASR path already runs in the browser:
- Q4 GGUF weights (~2.5 GB) sharded to ≤512 MB chunks
- Custom WGSL shader fuses dequantization + matmul
- `ShardedCursor` for 2 GB per-allocation limit
- Two-phase loading to stay under 4 GB address space
- Async GPU readback (`into_data_async().await`) throughout
- Tokenizer loaded from JSON string (no file I/O)

The TTS pipeline is **native-only** — uses synchronous file I/O, `into_scalar().elem()`
in the decode loop, and loads 8 GB BF16 SafeTensors from disk.

---

## Blockers

| Issue | Severity | Location | Required Change |
|-------|----------|----------|-----------------|
| BF16 model is 8 GB | CRITICAL | `consolidated.safetensors` | Q4 quantize to GGUF (~1.7 GB), shard to ≤512 MB |
| `into_scalar().elem()` in decode loop | CRITICAL | `backbone.rs:281` | Convert to async `into_data_async().await` |
| `std::fs` file I/O for weights | HIGH | `pipeline.rs`, `voice.rs` | HTTP fetch from server endpoints |
| `memmap2::Mmap` SafeTensors loading | HIGH | `weights.rs` | Load from `&[u8]` fetched via HTTP |
| Synchronous pipeline API | HIGH | `pipeline.rs:114` | Async `generate()` with yield points |

## Already WASM-Compatible

| Component | Status | Notes |
|-----------|--------|-------|
| Flow-matching transformer | Ready | Pure tensor ops, no file I/O |
| Codec decoder (ConvTranspose1d) | Ready | Burn/WebGPU supports Conv1d and ConvTranspose1d |
| FSQ quantization | Ready | Pure arithmetic |
| Tekken encoder (tiktoken-rs) | Ready | Pure Rust, `from_json()` exists |
| Voice embeddings | Ready (tiny) | 50-200 KB each, trivial to HTTP fetch |
| ALiBi, QK-norm, LayerScale | Ready | Pure tensor ops |

---

## Memory Budget

| Component | BF16 | Q4 (estimated) |
|-----------|------|-----------------|
| Backbone (Ministral 3B, 26 layers) | ~6.6 GB | ~1.65 GB |
| Flow-matching (3 layers) | ~100 MB | ~25 MB |
| Codec decoder (117 tensors) | ~150 MB | ~37 MB |
| Voice embeddings (20 presets) | ~1-4 MB | ~1-4 MB |
| **Total** | **~8 GB** | **~1.7 GB** |

Q4 total fits comfortably within 4 GB WASM address space. Each shard ≤512 MB
stays within the 2 GB per-allocation limit.

---

## Implementation Approach

### Phase 1: Q4 Quantization

Quantize `consolidated.safetensors` to Q4_0 GGUF format:

1. Write a quantization script (Python or extend existing GGUF tooling)
2. Quantize all linear layer weights to Q4_0 (backbone + FM + codec)
3. Keep embeddings at higher precision (Q8 or f16) for quality
4. Shard the GGUF into ≤512 MB files
5. Verify: native Q4 inference matches BF16 output quality

This is the biggest unknown — the codec decoder has unusual layer types
(weight-normed convolutions, ConvTranspose1d) that need Q4 kernel support.
The existing Q4 WGSL shader handles matmul only; conv ops would need either:
- (a) Dequantize conv weights to f32 at load time (simplest, small memory cost since codec is only ~37 MB)
- (b) Custom Q4 conv kernel (not worth it for ~37 MB of weights)

**Recommended:** Q4 quantize backbone + FM linear layers only. Keep codec weights
as f32 (~150 MB) — small relative to the 1.7 GB total.

### Phase 2: Async Decode Loop

Mirror the ASR pattern in `web/bindings.rs`:

```rust
// Current (blocking — panics in WASM):
let semantic_idx_val: i32 = semantic_idx.into_scalar().elem();

// Required (async — WASM-safe):
let semantic_idx_data = semantic_idx.into_data_async().await;
let semantic_idx_val: i32 = semantic_idx_data.as_slice::<i32>().unwrap()[0];
```

The entire `generate()` method becomes `async fn generate()`. This propagates
up to the pipeline and WASM bindings.

### Phase 3: HTTP Weight + Voice Delivery

Extend `serve.mjs` and `web/worker.js`:

```javascript
// New endpoints:
// GET /api/tts-shards  → list of shard filenames
// GET /models/tts-shards/{name}  → shard bytes
// GET /models/voices/{name}.safetensors  → voice embedding

// In worker.js, new message types:
// "loadTtsModel" → sequential shard download → appendTtsShard → loadTtsFromShards
// "loadVoice" → fetch voice embedding → pass to WASM
// "synthesize" → run TTS pipeline → return audio samples
```

Voice embeddings are fetched on-demand per synthesis request (~200 KB each).

### Phase 4: WASM Bindings

New `TtsQ4` struct in `src/web/bindings.rs` alongside `VoxtralQ4`:

```rust
#[wasm_bindgen]
pub struct VoxtralTts {
    backbone: TtsBackboneQ4<Wgpu>,
    fm: FmTransformerQ4<Wgpu>,
    codec: CodecDecoder<Wgpu>,  // f32 weights, not Q4
    codebook: AudioCodebookEmbeddings<Wgpu>,
}

#[wasm_bindgen]
impl VoxtralTts {
    pub async fn synthesize(&self, token_ids: &[u32], voice_bytes: &[u8]) -> Vec<f32> { ... }
}
```

### Phase 5: Integration Testing

Extend `tests/e2e_browser.spec.ts` with a TTS test:
- Load TTS shards
- Load a voice embedding
- Synthesize a short phrase
- Verify output contains non-silent audio samples

---

## Risks & Open Questions

1. **Q4 quality for TTS** — ASR is tolerant of quantization noise because it's
   classification (argmax). TTS generates continuous waveforms where quantization
   artifacts are audible. May need Q8 for the codec or flow-matching components.

2. **Decode loop latency** — Each frame requires 2 FM transformer passes (cond + uncond
   for CFG). With 8 Euler steps per frame, that's 16 FM forwards per audio frame.
   WebGPU dispatch overhead may make this slow for real-time streaming.

3. **Streaming audio** — The codec decoder processes all frames at once. For streaming,
   would need chunked codec decoding (process N frames at a time) with Web Audio API
   playback. This is a UX improvement, not a blocker.

4. **Model size for download** — Even at Q4, ~1.7 GB is a significant download.
   Consider progressive loading: start with backbone shards, begin generating while
   codec shards download in background.
