# Voxtral TTS — Requirements

Extracted from [add-tts-spec.md](add-tts-spec.md). Each requirement has acceptance
criteria and dependency links.

---

## Functional Requirements

### FR-1: TTS Config Parsing

Parse TTS-specific `params.json` into config structs covering all three stages
(backbone, flow-matching transformer, codec decoder).

**Acceptance Criteria:**

- [ ] Parses backbone config: 26 layers, 3072 dim, 32Q/8KV GQA, head_dim 128,
      FFN 9216, RoPE theta 1M, vocab 131072, tied embeddings
- [ ] Parses FM transformer config: 3 layers, 3072 dim, 32Q/8KV GQA, head_dim 128,
      FFN 9216, RoPE theta 10K
- [ ] Parses codec decoder config: block layout, 1024 dim, 8 MHA heads, ALiBi,
      sliding windows [2, 4, 8, 16]
- [ ] Parses special token IDs: `audio_token_id` (24), `begin_audio_token_id` (25),
      BOS (1)
- [ ] Loads and validates voice embedding metadata (preset names, dimensions)
- [ ] Unit tests cover round-trip serialization and validation of invalid configs

**Dependencies:** None

---

### FR-2: Plain Decoder Layer Mode

Extend existing `decoder_layer.rs` to support a "plain" mode that skips ADA
RMSNorm time-conditioning, since the TTS backbone is pure Ministral 3B with no
temporal modulation.

**Acceptance Criteria:**

- [ ] `DecoderLayer` can be instantiated without ADA RMSNorm (no `t_cond_dim`)
- [ ] Plain mode forward pass: `x → attention_norm → attention → + → ffn_norm → ffn → +`
- [ ] Existing ASR path with ADA RMSNorm continues to work unchanged
- [ ] Unit tests verify both plain and ADA modes produce correct shapes
- [ ] No runtime branch on every forward call — mode determined at construction

**Dependencies:** None

---

### FR-3: Backbone Weight Loading

Load the 234 TTS backbone tensors from `consolidated.safetensors` into the
plain-mode decoder layers.

**Acceptance Criteria:**

- [ ] Loads all 26 layers: `layers.{0..25}.attention.{wq,wk,wv,wo}.weight`,
      `attention_norm.weight`, `feed_forward.{w1,w2,w3}.weight`, `ffn_norm.weight`
- [ ] Loads `norm.weight` (final RMSNorm)
- [ ] Loads `tok_embeddings.weight` [131072, 3072] with tied LM head
- [ ] Loads `audio_codebook_embeddings.embeddings.weight` [9088, 3072]
- [ ] All weights loaded as BF16 (or converted to F32 if backend requires)
- [ ] Integration test: load weights, verify tensor shapes match config

**Dependencies:** FR-1, FR-2

---

### FR-4: Voice Embedding Loading

Load pre-encoded voice reference embeddings from `.pt` files and feed them as
backbone input embeddings.

**Acceptance Criteria:**

- [ ] Reads PyTorch `.pt` tensor files (variable-length [N, 3072] BF16)
- [ ] Supports all 20 preset voices from `voice_embedding/*.pt`
- [ ] Voice embeddings are in backbone hidden space — no projection needed
- [ ] CLI accepts `--voice <preset_name>` to select a voice
- [ ] Error on missing/corrupt voice file with actionable message

**Dependencies:** FR-1

**Open Question:** `.pt` files use PyTorch's pickle format. Options: (a) pre-convert
to SafeTensors with a Python script, (b) minimal Rust `.pt` reader, (c) batch-convert
at download time. Decision needed before implementation.

---

### FR-5: Audio Codebook Embeddings

Implement the audio codebook embedding layer that maps semantic + acoustic tokens
to backbone input vectors.

**Acceptance Criteria:**

- [ ] Indexes into [9088, 3072] embedding table with correct layout:
  - Indices 0..8191: semantic VQ (8192 entries)
  - Indices 8192..8947: acoustic FSQ (36 codebooks × 21 levels = 756 entries)
  - Indices 8948..9087: special/padding tokens (140 entries)
- [ ] **Sums** all 37 per-frame embeddings (1 semantic + 36 acoustic) into one
      3072-dim vector — not concatenation
- [ ] Unit test: known token indices produce expected embedding vector

**Dependencies:** FR-3

---

### FR-6: Input Sequence Construction

Build the TTS input sequence from voice embeddings and tokenized text.

**Acceptance Criteria:**

- [ ] Sequence format: `[BOS] [voice_embed_0..N] [<next>=25] [text_tok_0..M] [<repeat>=24] [generated...]`
- [ ] Text tokenized with existing Tekken tokenizer (vocab 131072)
- [ ] Voice embeddings inserted as raw [3072] vectors (no token lookup)
- [ ] Correct handling of special token IDs from config
- [ ] Unit test: verify sequence shape and token positions for known input

**Dependencies:** FR-4, FR-5

---

### FR-7: Autoregressive Backbone Decoding

Run the backbone autoregressively to generate semantic tokens and hidden states.

**Acceptance Criteria:**

- [ ] KV-cache enabled autoregressive decoding (reuse existing `kv_cache.rs`)
- [ ] At each step, produces hidden state `h` (3072-dim) for the FM transformer
- [ ] Semantic token selection deferred to FM transformer's `semantic_codebook_output`
      head (per weight layout — semantic logits come from the acoustic transformer,
      not the backbone directly)
- [ ] Generated audio tokens are embedded via audio codebook and fed back as next input
- [ ] Terminates on EOA token or max-length limit
- [ ] Integration test: generates non-degenerate token sequences from known input

**Dependencies:** FR-2, FR-3, FR-5, FR-6

---

### FR-8: Flow-Matching Transformer

Build the 3-layer bidirectional transformer that produces both semantic logits and
acoustic tokens from backbone hidden states.

**Acceptance Criteria:**

- [ ] 3 bidirectional (non-causal) transformer layers with GQA (32Q/8KV)
- [ ] RoPE with theta=10K (distinct from backbone's 1M)
- [ ] Per-frame input sequence of length 3:
  - Position 0: backbone hidden `h` via `llm_projection` [3072→3072]
  - Position 1: sinusoidal time embedding `t` via `time_projection` [3072→3072]
  - Position 2: current acoustic state `x_t` via `input_projection` [36→3072]
- [ ] Output heads:
  - `semantic_codebook_output` [8320, 3072] → semantic logits (8192 + specials)
  - `acoustic_codebook_output` [3072, 36] → acoustic prediction
- [ ] Loads all 33 FM transformer tensors
- [ ] Unit test: correct output shapes for known hidden state input

**Dependencies:** FR-1, FR-3

---

### FR-9: Sinusoidal Time Embedding

Implement sinusoidal positional encoding for the flow-matching time step.

**Acceptance Criteria:**

- [ ] Generates 3072-dim sinusoidal embedding for scalar time value `t ∈ [0, 1]`
- [ ] Standard sin/cos encoding (even dims = sin, odd dims = cos)
- [ ] Output projected through `time_projection` [3072→3072] before use
- [ ] Unit test: verify embedding properties (orthogonality, frequency spread)

**Dependencies:** None

---

### FR-10: Euler ODE Solver with CFG

Implement the flow-matching inference loop using Euler integration with
classifier-free guidance.

**Acceptance Criteria:**

- [ ] Samples initial noise `x_1 ~ N(0, 1)` in R^36
- [ ] 8 Euler steps: `t` in [1.0, 0.875, 0.75, ..., 0.125], `dt = 1/8`
- [ ] At each step:
  - `v_cond = FM(x_t, t, h)` — conditional velocity (with backbone hidden state)
  - `v_uncond = FM(x_t, t, zeros)` — unconditional velocity (zeroed hidden state)
  - `v = 1.2 * v_cond + (1 - 1.2) * v_uncond` — CFG with alpha=1.2
  - `x_{t-dt} = x_t - v * dt`
- [ ] Final `x_0` quantized to FSQ levels
- [ ] Unit test: ODE solver converges to known output for fixed noise seed

**Dependencies:** FR-8, FR-9

---

### FR-11: FSQ Quantization

Implement Finite Scalar Quantization: map continuous 36-dim vectors to 21 discrete
levels per dimension.

**Acceptance Criteria:**

- [ ] Maps each of 36 dimensions to nearest of 21 uniformly-spaced levels
- [ ] Produces integer indices suitable for codec decoder input
- [ ] Inverse dequantization: integer indices → continuous values for codec
- [ ] Unit test: round-trip quantize→dequantize preserves values at level boundaries

**Dependencies:** None

---

### FR-12: VQ Semantic Codebook Dequantization

Dequantize semantic token indices using the codec's VQ codebook.

**Acceptance Criteria:**

- [ ] Loads `audio_tokenizer.quantizer.semantic_codebook.embedding_sum` [8192, 256]
      and `cluster_usage` [8192]
- [ ] Lookup: semantic token index → 256-dim embedding vector
- [ ] Normalization by cluster usage (EMA codebook)
- [ ] Unit test: known index produces expected embedding

**Dependencies:** FR-3

---

### FR-13: ALiBi Positional Bias

Implement Attention with Linear Biases for the codec decoder transformer layers.

**Acceptance Criteria:**

- [ ] Computes per-head bias: `slope * (j - i)` for relative positions
- [ ] Slopes from geometric sequence based on head count (8 heads)
- [ ] No learned parameters — purely computed from head index
- [ ] Compatible with causal + sliding window masking
- [ ] Unit test: verify bias matrix shape and values for known head count

**Dependencies:** None

---

### FR-14: QK-Norm Attention

Implement per-head RMSNorm on Q and K before attention score computation.

**Acceptance Criteria:**

- [ ] Applies RMSNorm to Q and K using learned `q_norm.weight` and `k_norm.weight`
      (both [1024], shared across heads since n_heads × head_dim = 1024)
- [ ] Normalized Q/K used for score computation: `Q_normed @ K_normed^T / sqrt(head_dim)`
- [ ] Unit test: verify normalization changes attention scores correctly

**Dependencies:** None

---

### FR-15: LayerScale

Implement learnable per-channel scaling for attention and FFN residuals.

**Acceptance Criteria:**

- [ ] `x = x + attention_scale * attention(norm(x))`
- [ ] `x = x + ffn_scale * ffn(ffn_norm(x))`
- [ ] Loads `attention_scale` [1024] and `ffn_scale` [1024] per layer
- [ ] Unit test: scaling modifies residual contribution correctly

**Dependencies:** None

---

### FR-16: Weight-Normed Causal Conv1d

Implement causal Conv1d with weight normalization for the codec decoder.

**Acceptance Criteria:**

- [ ] Weight norm fusion at load time: `weight = g * v / ||v||` per output channel
  - `g` (original0): [C_out, 1, 1] magnitude
  - `v` (original1): [C_out, C_in, K] direction
- [ ] Causal padding: left-pad by `(K - S)`, no right padding
- [ ] Correct shapes per spec:
  - Block 0: [1024, 292, 3], stride 1 (project up)
  - Output: [240, 1024, 7], stride 1 (patch to audio)
- [ ] Unit test: causal property — output[t] depends only on input[≤t]

**Dependencies:** None

---

### FR-17: Causal ConvTranspose1d (Upsampling)

Implement causal transposed convolution for codec decoder upsampling stages.

**Acceptance Criteria:**

- [ ] Weight norm fusion (same as FR-16 but kernel shape [C_in, C_out, K])
- [ ] Causal output trimming: remove `(K - S)` samples from right of output
- [ ] Correct shapes: [1024, 1024, 4], stride 2 for all three upsample blocks
- [ ] Each block produces 2× temporal upsampling
- [ ] Unit test: output length = input_length × stride after trimming

**Dependencies:** FR-16

**Open Question:** Verify Burn 0.20 has ConvTranspose1d support. If not, implement
via WGPU backend or find alternative.

---

### FR-18: Codec Decoder Assembly

Assemble the full codec decoder: 4 conv+transformer block pairs plus output
projection.

**Acceptance Criteria:**

- [ ] Pipeline: quantized tokens (292-dim) → conv project up → [4× (transformer +
      conv upsample)] → output conv → reshape to waveform
- [ ] Transformer blocks use: ALiBi (FR-13), QK-norm (FR-14), LayerScale (FR-15),
      SwiGLU, causal attention with sliding window
- [ ] Sliding windows halve per stage: [2, 4, 8, 16] (doubled per upsample)
- [ ] Total upsampling: 8× (from 12.5 Hz to 100 Hz)
- [ ] Output: 240 samples per patch × 100 Hz = 24,000 Hz
- [ ] Loads all 117 codec decoder tensors with weight norm fusion
- [ ] Integration test: feed known token sequence, verify output is valid 24 kHz audio

**Dependencies:** FR-12, FR-13, FR-14, FR-15, FR-16, FR-17

---

### FR-19: 24 kHz WAV Output

Extend existing audio I/O to support 24 kHz sample rate for TTS output.

**Acceptance Criteria:**

- [ ] `save_wav()` supports 24 kHz sample rate (currently 16 kHz for ASR)
- [ ] Output is valid WAV file playable by standard audio tools
- [ ] Unit test: write and read-back 24 kHz WAV, verify sample rate and data

**Dependencies:** None

---

### FR-20: End-to-End TTS Pipeline

Wire all stages into a single text-to-speech pipeline.

**Acceptance Criteria:**

- [ ] Input: text string + voice preset name
- [ ] Output: 24 kHz WAV audio file
- [ ] Pipeline: tokenize → build input sequence → backbone decode → FM transformer
      (per step) → collect tokens → codec decode → WAV output
- [ ] Handles variable-length text input
- [ ] Terminates cleanly on EOA or max length
- [ ] Integration test: generate audio from known text, verify non-silent output

**Dependencies:** FR-6, FR-7, FR-10, FR-11, FR-18, FR-19

---

### FR-21: CLI Binary (`voxtral-speak`)

Build a CLI binary for TTS inference.

**Acceptance Criteria:**

- [ ] `cargo run --bin voxtral-speak -- --text "Hello" --voice casual_female`
- [ ] Required args: `--text`, `--voice`, `--model` (path to consolidated.safetensors)
- [ ] Optional: `--output` (WAV path, default stdout or auto-named),
      `--tokenizer` (Tekken path)
- [ ] Lists available voice presets with `--list-voices`
- [ ] Progress indication during generation
- [ ] Feature-gated behind `cli` flag

**Dependencies:** FR-20

---

## Non-Functional Requirements

### NFR-1: Memory Efficiency

- [ ] BF16 weights total ~7.5 GB — keep BF16 throughout inference where backend
      supports it, rather than converting to F32 (which doubles to ~15 GB)
- [ ] Codec decoder weights (~117 tensors) loaded only when needed
- [ ] Voice embeddings loaded on demand per selected preset

**Open Question:** Verify Burn WGPU backend supports BF16 compute. If not, F32
conversion is required and memory budget doubles.

---

### NFR-2: Code Reuse

- [ ] Backbone reuses existing `attention.rs`, `swiglu.rs`, `rms_norm.rs`, `rope.rs`,
      `kv_cache.rs` — no duplication
- [ ] FM transformer layers reuse the same attention/SwiGLU primitives
- [ ] Tokenizer path shared with ASR
- [ ] New layer types (ALiBi, QK-norm, LayerScale, weight-norm conv) are generic
      and reusable

---

### NFR-3: Architecture Separation

- [ ] TTS code lives in `src/tts/` module, cleanly separated from ASR in `src/models/`
- [ ] Shared layers remain in `src/models/layers/`
- [ ] No TTS-specific changes leak into ASR inference path
- [ ] Codec decoder has its own submodule `src/tts/codec/`

---

### NFR-4: Test Coverage

- [ ] Unit tests for every new layer type (ALiBi, QK-norm, LayerScale, conv variants)
- [ ] Unit tests for quantization (FSQ round-trip, VQ lookup)
- [ ] Integration tests for each pipeline stage with known inputs
- [ ] End-to-end test: TTS→ASR roundtrip to verify intelligibility (WER check)

---

## Requirement Dependencies

```
FR-1 (config) ←── FR-2 (plain decoder)
                   FR-3 (backbone weights) ←── FR-5 (audio codebook)
                   FR-4 (voice embeds)          │
                   FR-8 (FM transformer)        │
                                                ↓
FR-6 (input sequence) ← FR-4, FR-5 ──→ FR-7 (backbone decode) ← FR-2, FR-3, FR-5
                                                │
FR-9 (time embed) ──→ FR-10 (Euler ODE) ← FR-8 ┘
                              │
FR-11 (FSQ) ─────────────────→│
FR-12 (VQ dequant) ──────────→│
                              ↓
FR-13 (ALiBi) ──────→ FR-18 (codec assembly) ← FR-16, FR-17
FR-14 (QK-norm) ────→         │
FR-15 (LayerScale) ─→         │
                              ↓
FR-19 (24kHz WAV) ──→ FR-20 (pipeline) ← FR-6, FR-7, FR-10, FR-11, FR-18
                              │
                              ↓
                       FR-21 (CLI binary)
```

### Independent (no prerequisites)

- FR-1, FR-2, FR-9, FR-11, FR-13, FR-14, FR-15, FR-16, FR-19

### Critical Path

```
FR-1 → FR-3 → FR-5 → FR-6 → FR-7 → FR-10 → FR-20 → FR-21
```

### Open Questions (decisions needed before implementation)

1. **Voice embedding format** (FR-4): `.pt` reading strategy — pre-convert vs Rust reader
2. **ConvTranspose1d support** (FR-17): Burn 0.20 compatibility check needed
3. **BF16 compute** (NFR-1): WGPU backend capability verification
4. **Semantic head placement** (FR-7/FR-8): Confirm semantic logits come from FM transformer, not backbone
5. **Audio codebook padding** (FR-5): Investigate purpose of 140 extra entries (indices 8948..9087)
