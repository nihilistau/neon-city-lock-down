# Voxtral TTS — Task Breakdown

Derived from [tts-requirements.md](tts-requirements.md) and [add-tts-spec.md](add-tts-spec.md).

Each task maps to one or more functional requirements, has clear acceptance criteria,
and lists file-level scope. No timelines — just clean technical decomposition.

---

## T-01: TTS Config Parsing

**Requirements:** FR-1

**Description:**
Define TTS-specific config structs and parse them from `params.json`. Three stage
configs (backbone, flow-matching transformer, codec decoder) plus special token IDs
and voice embedding metadata.

**Files to create/modify:**
- Create `src/tts/mod.rs` — module root
- Create `src/tts/config.rs` — TTS config structs

**Acceptance criteria:**
- [x] `TtsBackboneConfig`: 26 layers, 3072 dim, 32Q/8KV GQA, head_dim 128, FFN 9216, RoPE theta 1M, vocab 131072, tied embeddings
- [x] `FmTransformerConfig`: 3 layers, 3072 dim, 32Q/8KV GQA, head_dim 128, FFN 9216, RoPE theta 10K
- [x] `CodecDecoderConfig`: block layout, 1024 dim, 8 MHA heads, ALiBi, sliding windows [2, 4, 8, 16]
- [x] `TtsSpecialTokens`: `audio_token_id` (24), `begin_audio_token_id` (25), BOS (1)
- [x] Voice embedding metadata (preset names, expected dimensions)
- [x] Unit tests: round-trip serde, validation rejects invalid configs (zero layers, mismatched dims)

**Implementation approach:**
- Mirror existing `src/models/config.rs` patterns for serde parsing
- Separate structs per stage so they can be passed independently
- Validate invariants (e.g., `dim % n_heads == 0`) on construction

**Dependencies:** None

---

## T-02: Plain Decoder Layer Mode

**Requirements:** FR-2

**Description:**
Extend `decoder_layer.rs` so the decoder layer can be instantiated without ADA
RMSNorm. The TTS backbone is pure Ministral 3B with no temporal modulation — plain
pre-norm transformer layers.

**Files to modify:**
- `src/models/layers/decoder_layer.rs` — add enum/config variant

**Acceptance criteria:**
- [x] `DecoderLayerConfig` accepts optional `t_cond_dim` — when `None`, no ADA RMSNorm is instantiated
- [x] Plain mode forward: `x → attention_norm → attention → + → ffn_norm → ffn → +`
- [x] Existing ASR path (`t_cond_dim = Some(32)`) continues working unchanged
- [x] Mode determined at construction time — no runtime branch per forward call (use enum dispatch or separate struct)
- [x] Unit tests: both modes produce correct output shapes; plain mode forward doesn't require `t_embed` argument

**Implementation approach:**
- Add an enum `NormMode { Plain, Ada(AdaRmsNorm) }` inside `DecoderLayer`
- The `forward()` signature gains `t_embed: Option<Tensor>` — `None` for plain, `Some` for ADA
- Alternatively, make two forward methods and let the caller choose. Prefer the simplest approach that avoids runtime branching.

**Dependencies:** None

**Test strategy:**
- Construct both variants, pass random tensors, assert output shapes match input shapes
- Verify plain mode panics if given `t_embed` (or gracefully ignores it)

---

## T-03: Backbone Weight Loading

**Requirements:** FR-3

**Description:**
Load all 234 TTS backbone tensors from `consolidated.safetensors` into plain-mode
decoder layers. Reuse existing `weights.rs` loading utilities.

**Files to create/modify:**
- Create `src/tts/backbone.rs` — TTS backbone struct + weight loading
- Modify `src/tts/mod.rs` — export

**Acceptance criteria:**
- [x] Loads 26 layers: `layers.{0..25}.attention.{wq,wk,wv,wo}.weight`, `attention_norm.weight`, `feed_forward.{w1,w2,w3}.weight`, `ffn_norm.weight`
- [x] Loads `norm.weight` (final RMSNorm)
- [x] Loads `tok_embeddings.weight` [131072, 3072] — shared as LM head (tied embeddings)
- [x] Loads `audio_codebook_embeddings.embeddings.weight` [9088, 3072]
- [x] All weights BF16 (or converted to F32 per backend)
- [x] Integration test: load weights from safetensors file, verify all tensor shapes match config

**Implementation approach:**
- Backbone struct holds: `Vec<DecoderLayer>` (plain mode), final `RmsNorm`, `tok_embeddings`, `audio_codebook_embeddings`
- Weight prefix: `mm_audio_embeddings.` for embeddings, bare `layers.` for backbone layers
- Reuse `models::weights::load_tensor()` for all loads

**Dependencies:** T-01 (config), T-02 (plain decoder layer)

---

## T-04: Voice Embedding Loading

**Requirements:** FR-4

**Description:**
Load pre-encoded voice reference embeddings from `.pt` files and expose them as
[N, 3072] tensors for backbone input.

**Files to create/modify:**
- Create `src/tts/voice.rs` — voice preset loading

**Acceptance criteria:**
- [x] Reads SafeTensors voice embedding files (variable-length [N, 3072] BF16)
- [x] Supports all 20 preset voices from `voice_embedding/*.safetensors`
- [x] Voice embeddings in backbone hidden space — no projection needed
- [ ] CLI accepts `--voice <preset_name>` to select
- [x] Error on missing/corrupt voice file with actionable message
- [x] Unit test: load a known voice file, verify shape is [N, 3072]

**Implementation approach:**
- **Decided:** Pre-convert `.pt` → SafeTensors via Python script (`scripts/convert_voice_embeds.py`).
  Reuses existing `safetensors` crate, avoids PyTorch pickle dependency in Rust.
  Document as a one-time post-download step. Ship the conversion script.
- Voice registry: HashMap<String, PathBuf> built from directory listing of `voice_embedding/`

**Dependencies:** T-01 (config for expected dimensions)

---

## T-05: Audio Codebook Embeddings

**Requirements:** FR-5

**Description:**
Implement the audio codebook embedding layer that maps semantic + acoustic token
indices to backbone input vectors. The [9088, 3072] table has three regions:
semantic VQ, acoustic FSQ, and special tokens.

**Files to create/modify:**
- Create `src/tts/embeddings.rs` — audio codebook embedding lookup + summing logic

**Acceptance criteria:**
- [x] Correct index layout with per-codebook special token offsets:
  - Indices 0..1: semantic specials (EMPTY_AUDIO=0, END_AUDIO=1)
  - Indices 2..8193: semantic VQ (8192 entries, offset by +2)
  - Per acoustic codebook: 2 specials + 21 FSQ levels (stride = 23 per codebook)
  - Indices 8194..9021: 36 acoustic codebooks × 23 entries each
  - Indices 9022..9087: alignment padding (unused zeros)
- [x] Per-frame embedding: **sums** all 37 embeddings (1 semantic + 36 acoustic) into one 3072-dim vector
- [x] Indexing: `semantic_global = raw_semantic_idx + 2`, `acoustic_global = 8194 + cb * 23 + (level + 2)`
- [x] Helper to convert (semantic_idx, acoustic_indices[36]) → summed embedding
- [x] Unit test: known indices produce expected embedding values, specials return correct embeddings

**Implementation approach:**
- Embedding table loaded from `audio_codebook_embeddings.embeddings.weight` (T-03 loads it)
- Each codebook reserves 2 leading indices for EMPTY_AUDIO and END_AUDIO specials
- Index arithmetic accounts for the +2 offset per codebook region
- Simple gather + sum — no custom kernel needed

**Dependencies:** T-03 (backbone loads the embedding table)

---

## T-06: Input Sequence Construction

**Requirements:** FR-6

**Description:**
Build the TTS input sequence from voice embeddings and tokenized text, following the
format: `[BOS] [voice_embed_0..N] [<next>=25] [text_tok_0..M] [<repeat>=24] [generated...]`

**Files to create/modify:**
- Create `src/tts/sequence.rs` — input sequence builder

**Acceptance criteria:**
- [x] Correct sequence format per spec
- [x] Text tokenized with existing Tekken tokenizer (vocab 131072)
- [x] Voice embeddings inserted as raw [3072] vectors (not looked up from any table)
- [x] Text tokens embedded via `tok_embeddings.weight`
- [x] Special tokens (`BOS`, `<next>`, `<repeat>`) embedded via `tok_embeddings.weight`
- [x] Returns: tensor [1, seq_len, 3072] ready for backbone input
- [x] Unit test: verify sequence shape and token positions for known input

**Implementation approach:**
- Accept: voice embeddings [N, 3072], text token IDs Vec<u32>, config (special token IDs)
- Embed text tokens and special tokens via the shared `tok_embeddings` table
- Concatenate: [BOS_embed, voice_0..N, next_embed, text_0..M, repeat_embed]
- Return the full input embedding tensor

**Dependencies:** T-04 (voice embeddings), T-05 (audio codebook for generated tokens), T-03 (tok_embeddings)

---

## T-07: Autoregressive Backbone Decoding

**Requirements:** FR-7

**Description:**
Run the backbone autoregressively to produce hidden states. At each step, the
backbone outputs a hidden state `h` (3072-dim). Semantic logits are computed by a
direct linear projection of `h` (via `semantic_codebook_output`), NOT by passing `h`
through the FM transformer layers. The FM transformer is only used for acoustic
token generation.

**Files to modify:**
- `src/tts/backbone.rs` — add autoregressive forward loop

**Acceptance criteria:**
- [x] KV-cache enabled autoregressive decoding (reuse existing `kv_cache.rs`)
- [x] Prefill phase: process entire input sequence at once, cache KV
- [x] Decode phase: one token at a time, producing hidden state `h` [1, 1, 3072]
- [x] Hidden state `h` passed to FM transformer for:
  - Semantic logits: `semantic_codebook_output(h)` — direct projection, no FM layers
  - Acoustic tokens: Euler ODE through FM transformer layers
- [x] Generated audio tokens embedded via audio codebook (T-05) and fed back as next input
- [x] Terminates on EOA token (from semantic logits argmax) or configurable max-length limit
- [x] Integration test: generates non-degenerate hidden state sequences from known input

**Implementation approach:**
- Prefill: forward all input embeddings through 26 layers, cache KV states
- Decode loop: forward one embedding → get `h` → `semantic_codebook_output(h)` for semantic token → Euler ODE for acoustic tokens → embed → next input
- Termination: check semantic argmax for END_AUDIO special token (index 1 in semantic codebook)

**Dependencies:** T-02 (plain decoder), T-03 (backbone weights), T-05 (audio codebook), T-06 (input sequence)

---

## T-08: Flow-Matching Transformer

**Requirements:** FR-8

**Description:**
Build the 3-layer bidirectional transformer that predicts acoustic velocity from
backbone hidden states. Semantic logits use a direct projection of `h` (no FM layers)
but the weight (`semantic_codebook_output`) is namespaced here.

**Files to create/modify:**
- Create `src/tts/flow_matching.rs` — FM transformer struct + forward

**Acceptance criteria:**
- [x] 3 bidirectional (non-causal) transformer layers with GQA (32Q/8KV)
- [x] RoPE with theta=10K (distinct from backbone's 1M)
- [x] Per-frame input sequence (length 3):
  - Position 0: current acoustic state `x_t` via `input_projection` [3072, 36]
  - Position 1: sinusoidal time embedding `t` via `time_projection` [3072→3072]
  - Position 2: backbone hidden `h` via `llm_projection` [3072→3072]
- [x] `predict_velocity()`: runs FM layers, returns `acoustic_codebook_output(hidden[:, 0, :])` → velocity in R^36
- [x] `semantic_logits()`: direct `semantic_codebook_output(h)` → [8320] logits (no FM layers)
  - Mask `EMPTY_AUDIO` (idx 0) to -inf
  - Mask indices ≥ (2 + 8192) to -inf (beyond valid semantic range)
- [x] Loads all 33 FM transformer tensors from safetensors (prefix: `acoustic_transformer.`)
- [x] Unit test: correct output shapes for known hidden state input

**Implementation approach:**
- Reuse existing `Attention`, `SwiGLU`, `RmsNorm`, `RoPE` layers
- Key difference from backbone: **non-causal** attention (no causal mask)
- `predict_velocity()` and `semantic_logits()` are separate methods — semantic doesn't touch FM layers
- `input_projection` is [3072, 36] — projects 36-dim acoustic state up to 3072

**Dependencies:** T-01 (config), T-03 (weight loading), T-09 (time embedding)

---

## T-09: Sinusoidal Time Embedding

**Requirements:** FR-9

**Description:**
Implement sinusoidal positional encoding for the flow-matching time step scalar
`t ∈ [0, 1]`. Standard sin/cos encoding projected through a linear layer.

**Files to create/modify:**
- Create function in `src/tts/flow_matching.rs` (or separate small module)

**Acceptance criteria:**
- [x] Generates 3072-dim sinusoidal embedding for scalar time value `t ∈ [0, 1]`
- [x] Output projected through `time_projection` [3072→3072] before use
- [x] Unit test: verify embedding properties (different times produce different embeddings, correct dimensionality)

**Implementation approach:**
- **Decided:** Reuse existing `src/models/time_embedding.rs` directly. It already supports
  arbitrary dimension (3072), custom theta via `with_theta()`, takes scalar `t: f32`,
  and returns `[1, 1, dim]`. Uses `[cos, sin]` concatenation ordering — verify TTS
  weights expect the same convention (likely yes, same Mistral codebase). If not,
  trivial reorder.
- No new module needed. TTS flow_matching.rs just imports `TimeEmbedding` from `models`.

**Dependencies:** None

---

## T-10: Euler ODE Solver with CFG

**Requirements:** FR-10

**Description:**
Implement the flow-matching inference loop: 8 Euler steps with classifier-free
guidance (CFG alpha=1.2) to predict acoustic tokens from backbone hidden states.

**Files to create/modify:**
- Add to `src/tts/flow_matching.rs` — Euler solver function

**Acceptance criteria:**
- [x] Samples initial noise `x_1 ~ N(0, 1)` in R^36
- [x] 8 Euler steps: `t` in [1.0, 0.875, ..., 0.125], `dt = 1/8`
- [x] Per step:
  - `v_cond = FM(x_t, t, h)` — conditional velocity
  - `v_uncond = FM(x_t, t, zeros)` — unconditional velocity (zeroed hidden state)
  - `v = 1.2 * v_cond + (1 - 1.2) * v_uncond` — CFG
  - `x_{t-dt} = x_t - v * dt`
- [x] Final `x_0` returned for FSQ quantization
- [x] Unit test: ODE solver converges for fixed noise seed (deterministic with seeded RNG)

**Implementation approach:**
- Each step calls the FM transformer twice (cond + uncond) — the main perf bottleneck
- `zeros` = zero tensor [1, 1, 3072] for unconditional hidden state
- CFG alpha could be configurable but default to 1.2

**Dependencies:** T-08 (FM transformer), T-09 (time embedding)

---

## T-11: FSQ Quantization

**Requirements:** FR-11

**Description:**
Implement Finite Scalar Quantization: map continuous 36-dim vectors to 21 discrete
levels per dimension. Used after the Euler ODE solver and for codec decoder input.

**Files to create/modify:**
- Create `src/tts/codec/quantizer.rs` — FSQ + VQ quantization

**Acceptance criteria:**
- [x] Maps each of 36 dimensions to nearest of 21 uniformly-spaced levels
- [x] Produces integer indices [0..20] per dimension (36 indices total per frame)
- [x] Inverse dequantization: integer indices → continuous values (for codec decoder input)
- [x] Unit test: round-trip quantize→dequantize preserves values at level boundaries

**Implementation approach:**
- 21 levels uniformly in [-1, 1]: `levels = linspace(-1, 1, 21)`
- Quantize: `idx = argmin(|x - levels|)` per dimension
- Dequantize: `x = levels[idx]`
- Pure arithmetic — no learned parameters

**Dependencies:** None

---

## T-12: VQ Semantic Codebook Dequantization

**Requirements:** FR-12

**Description:**
Dequantize semantic token indices using the codec's VQ codebook. This maps semantic
token IDs to 256-dim embedding vectors for the codec decoder.

**Files to modify:**
- `src/tts/codec/quantizer.rs` — add VQ codebook lookup

**Acceptance criteria:**
- [x] Loads `audio_tokenizer.quantizer.semantic_codebook.embedding_sum` [8192, 256] and `cluster_usage` [8192]
- [x] Lookup: semantic token index → 256-dim embedding vector
- [x] Normalization: `embedding = embedding_sum[idx] / cluster_usage[idx]` (EMA codebook)
- [x] Unit test: known index produces expected embedding

**Implementation approach:**
- Load two tensors from safetensors
- Simple index + divide operation per token
- Handle edge case: `cluster_usage[idx] == 0` → zero vector or error

**Dependencies:** T-03 (weight loading for codec tensors)

---

## T-13: ALiBi Positional Bias

**Requirements:** FR-13

**Description:**
Implement Attention with Linear Biases for the codec decoder transformer layers.
Replaces RoPE in the codec with relative position bias.

**Files to create/modify:**
- Create `src/tts/codec/alibi.rs`

**Acceptance criteria:**
- [x] Computes per-head bias: `bias[h, i, j] = slope[h] * (j - i)` for relative positions
- [x] Slopes from geometric sequence: `slope[h] = 2^(-8h/n_heads)` for h in 0..n_heads
- [x] No learned parameters — purely computed from head count
- [x] Compatible with causal + sliding window masking (bias added before masking)
- [x] Unit test: verify bias matrix shape [n_heads, seq_len, seq_len] and values for 8 heads

**Implementation approach:**
- Pre-compute slope vector once at construction
- Generate bias matrix lazily or pre-compute for max sequence length
- Add bias to attention scores before softmax (and before causal/window mask)

**Dependencies:** None

---

## T-14: QK-Norm Attention

**Requirements:** FR-14

**Description:**
Implement per-head RMSNorm on Q and K before attention score computation. Used in
the codec decoder layers.

**Files to create/modify:**
- Create `src/tts/codec/qk_norm.rs` — or extend existing attention module

**Acceptance criteria:**
- [x] Applies RMSNorm to Q and K using learned `q_norm.weight` [1024] and `k_norm.weight` [1024]
- [x] Weights are per head_dim element, shared across heads (since n_heads * head_dim = 1024)
- [x] Normalized Q/K used for score computation: `Q_normed @ K_normed^T / sqrt(head_dim)`
- [x] Unit test: verify normalization changes attention scores correctly

**Implementation approach:**
- After projecting Q and K through wq/wk, reshape to [batch, n_heads, seq, head_dim]
- Apply RMSNorm per-head using the shared weight vector
- Proceed with standard dot-product attention
- Could extend existing `Attention` struct with optional QK-norm, or build a codec-specific attention

**Dependencies:** None

---

## T-15: LayerScale

**Requirements:** FR-15

**Description:**
Implement learnable per-channel scaling for attention and FFN residuals in the codec
decoder.

**Files to create/modify:**
- Create `src/tts/codec/layer_scale.rs`

**Acceptance criteria:**
- [x] `x = x + attention_scale * attention(norm(x))` — element-wise channel scaling
- [x] `x = x + ffn_scale * ffn(ffn_norm(x))` — element-wise channel scaling
- [x] Loads `attention_scale` [1024] and `ffn_scale` [1024] per layer
- [x] Unit test: scaling modifies residual contribution correctly

**Implementation approach:**
- Simple: `LayerScale` struct holds a 1D weight tensor [dim]
- Forward: `input * self.scale` (broadcast over batch and sequence dims)
- Loaded from safetensors per layer

**Dependencies:** None

---

## T-16: Weight-Normed Causal Conv1d

**Requirements:** FR-16

**Description:**
Implement causal Conv1d with weight normalization for the codec decoder. Weights are
stored as (magnitude `g`, direction `v`) and fused at load time.

**Files to create/modify:**
- Create `src/tts/codec/conv.rs`

**Acceptance criteria:**
- [x] Weight norm fusion at load: `weight = g * v / ||v||` per output channel
  - `g` (original0): [C_out, 1, 1] magnitude
  - `v` (original1): [C_out, C_in, K] direction
- [x] Causal padding: left-pad by `(K - S)`, no right padding
- [x] Correct shapes: block 0 [1024, 292, 3] stride 1; output [240, 1024, 7] stride 1
- [x] Unit test: causal property — output[t] depends only on input[≤t]

**Implementation approach:**
- Fuse weights at load time into a standard Conv1d weight tensor
- Use Burn's `nn::conv::Conv1d` with manual left-padding
- Left-pad: `pad_left = kernel_size - stride`, pad with zeros on the left of the time dimension

**Dependencies:** None

---

## T-17: Causal ConvTranspose1d (Upsampling)

**Requirements:** FR-17

**Description:**
Implement causal transposed convolution for codec decoder upsampling stages.

**Files to modify:**
- `src/tts/codec/conv.rs` — add ConvTranspose1d

**Acceptance criteria:**
- [x] Weight norm fusion (same as T-16 but kernel shape [C_in, C_out, K])
- [x] Causal output trimming: remove `(K - S)` samples from right of output
- [x] Correct shapes: [1024, 1024, 4], stride 2 for all three upsample blocks
- [x] Each block produces 2x temporal upsampling
- [x] Unit test: output length = input_length * stride after trimming

**Implementation approach:**
- **Decided:** Burn 0.20 has `ConvTranspose1dConfig` in `burn::nn::conv`. Use directly
  with post-trimming for causal behavior. No custom implementation needed.
- Trimming: `output = output[:, :, :output_len - (kernel_size - stride)]`

**Dependencies:** T-16 (shares weight norm fusion code)

---

## T-18: Codec Decoder Layer

**Requirements:** FR-18 (partial — the transformer block portion)

**Description:**
Build the codec decoder transformer layer combining ALiBi, QK-norm, LayerScale,
SwiGLU, and causal+sliding-window attention.

**Files to create/modify:**
- Create `src/tts/codec/block.rs` — codec transformer block
- Create `src/tts/codec/mod.rs` — module root

**Acceptance criteria:**
- [x] Transformer layer: pre-norm → attention (ALiBi, QK-norm, causal, sliding window) → LayerScale → residual → pre-norm → SwiGLU → LayerScale → residual
- [x] 8 MHA heads, 1024 dim, head_dim 128
- [x] Sliding window parameter per block (2, 4, 8, 16)
- [x] Loads all per-layer weights from safetensors (attention, norms, scales, FFN)
- [x] Unit test: correct output shape for known input

**Implementation approach:**
- Codec attention differs from backbone: MHA (not GQA), ALiBi (not RoPE), QK-norm, LayerScale
- Build a `CodecTransformerLayer` struct composing: `RmsNorm` + `CodecAttention` + `LayerScale` + `SwiGLU`
- `CodecAttention` wraps: QK-norm + ALiBi bias + sliding window mask + standard MHA

**Dependencies:** T-13 (ALiBi), T-14 (QK-norm), T-15 (LayerScale)

---

## T-19: Codec Decoder Assembly

**Requirements:** FR-18 (full assembly)

**Description:**
Assemble the full codec decoder pipeline: input projection → 4x (conv + transformer
blocks) → output projection → waveform reshape.

**Files to create/modify:**
- `src/tts/codec/mod.rs` — `CodecDecoder` struct + full forward

**Acceptance criteria:**
- [x] Pipeline: quantized tokens (292-dim) → Conv1d project up [292→1024] → 4x (2 transformer layers + ConvTranspose1d upsample) → output Conv1d [1024→240] → reshape
- [x] Sliding windows: [2, 4, 8, 16] across the four transformer block groups
- [x] Total upsampling: 8x (from 12.5 Hz to 100 Hz)
- [x] Output: 240 samples per patch × 100 Hz = 24,000 Hz
- [x] Loads all 117 codec decoder tensors with weight norm fusion
- [x] Integration test: feed known token sequence through, verify output is 24 kHz audio samples

**Implementation approach:**
- `CodecDecoder` holds: input conv, 4x (Vec<CodecTransformerLayer>, ConvTranspose1d), output conv
- Forward: tokens → dequantize (VQ + FSQ) → concat [256 + 36 = 292 dims] → conv blocks
- Weight loading uses prefix `audio_tokenizer.decoder_blocks.{0..7}` and `audio_tokenizer.output_proj`

**Dependencies:** T-11 (FSQ), T-12 (VQ), T-16 (Conv1d), T-17 (ConvTranspose1d), T-18 (codec layer)

---

## T-20: 24 kHz WAV Output

**Requirements:** FR-19

**Description:**
Verify existing audio I/O supports 24 kHz and add a test. The existing `save_wav()`
already uses `audio.sample_rate` in the WAV header — no hardcoded 16 kHz.

**Files to modify:**
- `src/audio/io.rs` — add 24 kHz round-trip test only

**Acceptance criteria:**
- [x] Unit test: write and read-back 24 kHz WAV, verify sample rate and data integrity
- [x] Verify output is playable by standard tools

**Implementation approach:**
- **Verified:** `save_wav()` at `io.rs:137` already writes `sample_rate: audio.sample_rate`
  into the WAV spec. `AudioBuffer::new(samples, 24000)` + `.save()` should just work.
- Only need to add a 24 kHz test alongside the existing 16 kHz `test_save_and_load_wav`.

**Dependencies:** None

---

## T-21: End-to-End TTS Pipeline

**Requirements:** FR-20

**Description:**
Wire all stages into a single text-to-speech pipeline function.

**Files to create/modify:**
- Create `src/tts/pipeline.rs` — orchestrator

**Acceptance criteria:**
- [x] Input: text string + voice preset name + model path
- [x] Output: `AudioBuffer` at 24 kHz
- [x] Pipeline steps:
  1. Tokenize text (Tekken)
  2. Load voice embedding
  3. Build input sequence (T-06)
  4. Backbone prefill + autoregressive decode (T-07)
  5. Per-step: FM transformer + Euler ODE → semantic + acoustic tokens (T-10)
  6. Collect all token frames
  7. Codec decode → waveform (T-19)
  8. Wrap as AudioBuffer at 24 kHz
- [x] Handles variable-length text
- [x] Terminates on EOA or max length
- [x] Integration test: generate audio from known text, verify non-silent output

**Implementation approach:**
- `TtsPipeline` struct holds backbone, FM transformer, codec decoder, tokenizer, config
- `generate(&self, text: &str, voice: &str) -> Result<AudioBuffer>`
- Internally manages KV cache lifecycle
- Memory: ~15 GB F32 on Metal/WebGPU (no BF16 compute), ~7.5 GB BF16 on Vulkan only

**Dependencies:** T-06 (sequence), T-07 (backbone decode), T-10 (Euler ODE), T-11 (FSQ), T-19 (codec)

---

## T-22: CLI Binary (`voxtral-speak`)

**Requirements:** FR-21

**Description:**
Build a CLI binary for TTS inference, mirroring the style of `voxtral-transcribe`.

**Files to create/modify:**
- Create `src/bin/speak.rs` — CLI entry point
- Modify `Cargo.toml` — add `[[bin]]` entry

**Acceptance criteria:**
- [x] `cargo run --features "wgpu,cli,hub" --bin voxtral-speak -- --text "Hello" --voice casual_female`
- [x] Required args: `--text`, `--voice`, `--model` (path to consolidated.safetensors)
- [x] Optional: `--output` (WAV path, default auto-named), `--tokenizer` (Tekken path)
- [x] `--list-voices` lists available voice presets
- [x] Progress indication during generation (tracing info logs)
- [x] Feature-gated behind `cli` + `native-tokenizer` flags

**Implementation approach:**
- Mirror `src/bin/transcribe.rs` structure
- Clap derive API for args
- Load model → run pipeline → save WAV → print timing stats

**Dependencies:** T-21 (pipeline)

---

## T-23: Code Reuse Verification

**Requirements:** NFR-2

**Description:**
Verify that all shared layers are genuinely reused (not duplicated) and that TTS
code is properly separated from ASR code.

**Acceptance criteria:**
- [x] Backbone uses `attention.rs`, `swiglu.rs`, `rms_norm.rs`, `rope.rs`, `kv_cache.rs` from `src/models/layers/`
- [x] FM transformer reuses same primitives
- [x] Tokenizer path shared with ASR
- [x] New types (ALiBi, QK-norm, LayerScale, conv) are in `src/tts/codec/` and generic
- [x] No TTS-specific changes leak into the ASR inference path
- [x] TTS module lives in `src/tts/`, codec in `src/tts/codec/`

**Implementation approach:**
- Review pass after all other tasks complete
- Check for any duplicated logic that should be extracted to shared layers
- Verify ASR tests still pass

**Dependencies:** All other tasks

---

## Task Dependencies

```
T-01 (config) ←── T-02 (plain decoder)
                   T-03 (backbone weights) ←── T-05 (audio codebook)
                   T-04 (voice embeds)          │
                   T-08 (FM transformer)        │
                                                ↓
T-06 (input sequence) ← T-04, T-05 ──→ T-07 (backbone decode) ← T-02, T-03, T-05
                                                │
T-09 (time embed) ──→ T-10 (Euler ODE) ← T-08 ┘
                              │
T-11 (FSQ) ─────────────────→│
T-12 (VQ dequant) ──────────→│
                              ↓
T-13 (ALiBi) ──────→ T-18 (codec layer) ← T-14, T-15
                              │
                              ↓
T-16 (conv1d) ──→ T-17 (convT1d) ──→ T-19 (codec assembly) ← T-11, T-12, T-18
                                              │
T-20 (24kHz WAV) ──→ T-21 (pipeline) ← T-06, T-07, T-10, T-19
                              │
                              ↓
                       T-22 (CLI binary)
                              │
                              ↓
                       T-23 (reuse verification)
```

### Independent (no prerequisites)

T-01, T-02, T-09, T-11, T-13, T-14, T-15, T-16, T-20

### Critical Path

```
T-01 → T-03 → T-05 → T-06 → T-07 → T-10 → T-21 → T-22
```

### Maximum Parallelism Groups

**Wave 1** (independent):
T-01, T-02, T-09, T-11, T-13, T-14, T-15, T-16, T-20

**Wave 2** (depends on wave 1):
T-03, T-04, T-08, T-12, T-17, T-18

**Wave 3** (depends on wave 2):
T-05, T-06, T-10, T-19

**Wave 4** (depends on wave 3):
T-07, T-21

**Wave 5** (depends on wave 4):
T-22, T-23

---

## Resolved Questions

All open questions have been investigated and resolved. Decisions are inlined into
the relevant tasks above. Summary:

1. **Voice embedding format** (T-04): **Pre-convert to SafeTensors** via Python script.
   Reuses existing `safetensors` crate, avoids pickle dependency.

2. **ConvTranspose1d support** (T-17): **Available in Burn 0.20.** `ConvTranspose1dConfig`
   in `burn::nn::conv`. Use with post-trimming for causal behavior.

3. **BF16 compute** (NFR-1): **Vulkan only.** Metal and WebGPU/WGSL require F32
   conversion at load time (~15 GB). Same pattern as existing ASR path in `weights.rs`.

4. **Semantic head placement** (T-07/T-08): **Direct projection of backbone hidden state.**
   `semantic_codebook_output(h)` is a simple linear head — does NOT pass through FM
   transformer layers. The weight is namespaced under `acoustic_transformer` but
   functionally acts on raw `h`. Confirmed via vLLM-Omni implementation.

5. **Audio codebook padding** (T-05): **Per-codebook special tokens + alignment.**
   Each of 37 codebooks reserves 2 leading indices (EMPTY_AUDIO=0, END_AUDIO=1).
   That's 74 specials. Remaining 66 entries are alignment padding to 9088.
   Indexing: `raw_value + 2` per codebook region.

6. **Time embedding reuse** (T-09): **Directly reusable.** Existing `TimeEmbedding` in
   `src/models/time_embedding.rs` supports arbitrary dim, custom theta, scalar input.
   TTS imports it from `models` — no new module needed.
