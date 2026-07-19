# Voxtral 4B TTS -- Implementation Spec

Adding text-to-speech to `voxtral-mini-realtime-rs` using the
[Voxtral-4B-TTS-2603](https://huggingface.co/mistralai/Voxtral-4B-TTS-2603) weights.

Reference: [Voxtral TTS paper](https://mistral.ai/static/research/voxtral-tts.pdf)

---

## 1. Architecture Overview

Voxtral TTS is a three-stage pipeline:

```
Text + Voice Reference
  --> Decoder Backbone (Ministral 3B, autoregressive)
    --> Semantic tokens (VQ 8192) + hidden states
      --> Flow-Matching Transformer (3 layers, 8 Euler steps)
        --> Acoustic tokens (FSQ 36x21)
          --> Voxtral Codec Decoder (conv-transformer)
            --> 24 kHz waveform
```

### 1.1 Decoder Backbone

Ministral 3B -- identical architecture to our existing ASR decoder:

| Parameter     | Value                    |
|---------------|--------------------------|
| Layers        | 26                       |
| Dim           | 3072                     |
| Heads         | 32Q / 8KV (GQA)         |
| Head dim      | 128                      |
| FFN (SwiGLU)  | 9216                     |
| RoPE theta    | 1,000,000                |
| Sliding window| Not specified in weights |
| Vocab         | 131,072 (Tekken)         |
| Tied embeddings| Yes                     |

**Difference from ASR decoder:** No ADA RMSNorm. The TTS backbone has no
time-conditioned normalization layers -- it's pure Ministral 3B. Our existing
decoder layer code needs a "plain mode" that skips the ADA norm path.

### 1.2 Flow-Matching Transformer

A small **bidirectional** (non-causal) transformer that predicts acoustic tokens
from the backbone's hidden states.

| Parameter     | Value                    |
|---------------|--------------------------|
| Layers        | 3                        |
| Dim           | 3072                     |
| Heads         | 32Q / 8KV (GQA)         |
| Head dim      | 128                      |
| FFN (SwiGLU)  | 9216                     |
| RoPE theta    | 10,000 (different!)      |

**Inputs per frame (sequence length = 3):**

| Position | Content                    | Projection              |
|----------|----------------------------|-------------------------|
| 0        | Backbone hidden state `h`  | `llm_projection` [3072, 3072] |
| 1        | Sinusoidal time step `t`   | `time_projection` [3072, 3072] |
| 2        | Current acoustic state `x_t` (36-dim) | `input_projection` [3072, 36] |

**Output heads:**
- `semantic_codebook_output` [8320, 3072] -- semantic logits (8192 + specials)
- `acoustic_codebook_output` [36, 3072] -- projects back to 36 acoustic dims

**Inference (Euler ODE solver):**
1. Sample `x_1 ~ N(0, 1)` in R^36
2. For `t` in [1.0, 0.875, 0.75, ..., 0.125] (8 steps, dt = 1/8):
   - `v_cond = FM(x_t, t, h)` -- conditional velocity
   - `v_uncond = FM(x_t, t, zeros)` -- unconditional velocity
   - `v = 1.2 * v_cond + (1 - 1.2) * v_uncond` -- CFG alpha=1.2
   - `x_{t-dt} = x_t - v * dt`
3. Quantize `x_0` to 21 FSQ levels per dimension

### 1.3 Voxtral Codec Decoder

Conv-transformer autoencoder that converts tokens back to a 24 kHz waveform.
Only the decoder half is in the checkpoint (encoder not needed for preset
voices).

**Architecture (decoder direction, 12.5 Hz -> 24 kHz):**

```
Quantized tokens (292-dim: 256 semantic + 36 acoustic)
  --> Conv1d(292 -> 1024, k=3, s=1) + weight_norm        [block 0]
  --> 2x Transformer(1024, 8 heads, SW=2) + SwiGLU        [block 1]
  --> ConvTranspose1d(1024 -> 1024, k=4, s=2) + weight_norm [block 2, 2x up]
  --> 2x Transformer(1024, 8 heads, SW=4) + SwiGLU        [block 3]
  --> ConvTranspose1d(1024 -> 1024, k=4, s=2) + weight_norm [block 4, 2x up]
  --> 2x Transformer(1024, 8 heads, SW=8) + SwiGLU        [block 5]
  --> ConvTranspose1d(1024 -> 1024, k=4, s=2) + weight_norm [block 6, 2x up]
  --> 2x Transformer(1024, 8 heads, SW=16) + SwiGLU       [block 7]
  --> Conv1d(1024 -> 240, k=7) + weight_norm               [output_proj]
  --> Reshape patches to waveform (240 samples/patch)
```

Total upsampling: 1x * 2x * 2x * 2x = 8x, from 12.5 Hz to 100 Hz.
Then 100 Hz * 240 samples/patch = 24,000 Hz.

**Codec layer features (not in our existing code):**
- **ALiBi** positional bias (not RoPE)
- **QK-norm**: `q_norm.weight`, `k_norm.weight` (per-head RMSNorm on Q/K)
- **LayerScale**: `attention_scale`, `ffn_scale` (learnable per-channel, init 0.01)
- **Weight normalization**: conv layers stored as `(original0=g, original1=v)`,
  fused at load time as `weight = g * v / ||v||`
- **MHA** (8 heads, 8 KV heads -- not grouped)
- **Causal** attention with sliding window (halved per upsample stage)

### 1.4 Embeddings

**Text embeddings:**
- `tok_embeddings.weight` [131072, 3072] -- standard Tekken, tied with LM head

**Audio codebook embeddings:**
- `audio_codebook_embeddings.embeddings.weight` [9088, 3072] -- concatenated:
  - Indices 0..8191: semantic VQ embeddings (8192 entries)
  - Indices 8192..8947: 36 acoustic FSQ codebooks x 21 levels each (756 entries)
  - Indices 8948..9087: special/padding tokens (140 entries)
- All 37 per-frame embeddings are **summed** (not concatenated) to produce one
  3072-dim vector per audio frame

**Voice reference embeddings:**
- Pre-encoded [N, 3072] BF16 tensors in `voice_embedding/*.pt`
- Variable length (N = frames at 12.5 Hz, so duration = N / 12.5 seconds)
- Already in backbone hidden space -- feed directly as input embeddings
- 20 preset voices available

### 1.5 Input Sequence Format

```
[BOS] [voice_embed_0] ... [voice_embed_N] [<next>] [text_tok_0] ... [text_tok_M] [<repeat>] [generated audio tokens...]
```

Special token IDs from params.json:
- `audio_token_id`: 24
- `begin_audio_token_id`: 25
- BOS: 1

Each generated audio frame produces one semantic token (argmax from 8192+EOA
logits) plus 36 acoustic values (from flow-matching, quantized to 21 levels).
These are embedded via the audio codebook, summed, and fed back as the next
input.

---

## 2. Weight Map

386 tensors in `consolidated.safetensors`, all BF16.

### 2.1 Backbone (234 tensors)

```
layers.{0..25}.attention.{wq,wk,wv,wo}.weight
layers.{0..25}.attention_norm.weight
layers.{0..25}.feed_forward.{w1,w2,w3}.weight
layers.{0..25}.ffn_norm.weight
norm.weight
```

Maps directly to our existing `decoder_layer.rs` minus the ADA RMSNorm.

### 2.2 Flow-Matching Transformer (33 tensors)

```
acoustic_transformer.layers.{0..2}.attention.{wq,wk,wv,wo}.weight
acoustic_transformer.layers.{0..2}.attention_norm.weight
acoustic_transformer.layers.{0..2}.feed_forward.{w1,w2,w3}.weight
acoustic_transformer.layers.{0..2}.ffn_norm.weight
acoustic_transformer.norm.weight
acoustic_transformer.llm_projection.weight        [3072, 3072]
acoustic_transformer.time_projection.weight        [3072, 3072]
acoustic_transformer.input_projection.weight       [3072, 36]
acoustic_transformer.semantic_codebook_output.weight [8320, 3072]
acoustic_transformer.acoustic_codebook_output.weight [36, 3072]
```

### 2.3 Codec Decoder (117 tensors)

```
# Conv blocks (weight-normed): blocks 0, 2, 4, 6
audio_tokenizer.decoder_blocks.{0,2,4,6}.conv.parametrizations.weight.original0  # g: [C_out, 1, 1]
audio_tokenizer.decoder_blocks.{0,2,4,6}.conv.parametrizations.weight.original1  # v: [C_out, C_in, K]

# Transformer blocks: blocks 1, 3, 5, 7 (2 layers each)
audio_tokenizer.decoder_blocks.{1,3,5,7}.layers.{0,1}.attention.{wq,wk,wv,wo}.weight
audio_tokenizer.decoder_blocks.{1,3,5,7}.layers.{0,1}.attention.{q_norm,k_norm}.weight
audio_tokenizer.decoder_blocks.{1,3,5,7}.layers.{0,1}.attention_norm.weight
audio_tokenizer.decoder_blocks.{1,3,5,7}.layers.{0,1}.attention_scale            # LayerScale
audio_tokenizer.decoder_blocks.{1,3,5,7}.layers.{0,1}.feed_forward.{w1,w2,w3}.weight
audio_tokenizer.decoder_blocks.{1,3,5,7}.layers.{0,1}.ffn_norm.weight
audio_tokenizer.decoder_blocks.{1,3,5,7}.layers.{0,1}.ffn_scale                  # LayerScale

# Output projection (weight-normed)
audio_tokenizer.output_proj.conv.parametrizations.weight.original0  [240, 1, 1]
audio_tokenizer.output_proj.conv.parametrizations.weight.original1  [240, 1024, 7]

# VQ codebook (used for dequantizing semantic tokens)
audio_tokenizer.quantizer.semantic_codebook.embedding_sum   [8192, 256]
audio_tokenizer.quantizer.semantic_codebook.cluster_usage   [8192]
```

**Weight norm fusion at load time:**
```
weight = original0 * original1 / ||original1||
```
where `original0` has shape `[C_out, 1, 1]` (magnitude) and `original1` has the
full kernel shape (direction). The norm is computed per output channel.

**Codec conv shapes (decoder direction):**

| Block | Type      | Shape (v)           | Stride | Effect         |
|-------|-----------|---------------------|--------|----------------|
| 0     | Conv1d    | [1024, 292, 3]      | 1      | Project up     |
| 2     | ConvT1d   | [1024, 1024, 4]     | 2      | 2x upsample    |
| 4     | ConvT1d   | [1024, 1024, 4]     | 2      | 2x upsample    |
| 6     | ConvT1d   | [1024, 1024, 4]     | 2      | 2x upsample    |
| out   | Conv1d    | [240, 1024, 7]      | 1      | Patch to audio |

### 2.4 Embeddings (2 tensors)

```
mm_audio_embeddings.tok_embeddings.weight              [131072, 3072]
mm_audio_embeddings.audio_codebook_embeddings.embeddings.weight [9088, 3072]
```

---

## 3. What We Can Reuse

### 3.1 Direct Reuse

| Existing module              | TTS usage                          |
|------------------------------|------------------------------------|
| `models/layers/attention.rs` | Backbone + FM transformer layers   |
| `models/layers/swiglu.rs`    | All three components               |
| `models/layers/rms_norm.rs`  | Backbone + FM norms                |
| `models/layers/rope.rs`      | Backbone (theta=1M) + FM (theta=10K) |
| `models/layers/kv_cache.rs`  | Backbone autoregressive decode     |
| `tokenizer/`                 | Same Tekken tokenizer              |
| `models/weights.rs`          | SafeTensors loading utilities      |
| `audio/io.rs`                | WAV output (extend to 24 kHz)     |

### 3.2 Needs Modification

| Module                         | Change needed                                |
|--------------------------------|----------------------------------------------|
| `models/layers/decoder_layer.rs` | Add plain mode (no ADA RMSNorm)           |
| `models/decoder.rs`            | Separate backbone forward from ASR-specific head |
| `models/config.rs`             | Parse TTS params.json multimodal config    |
| `audio/io.rs`                  | Support 24 kHz sample rate for output      |

### 3.3 New Code Required

| Component                    | Complexity | Notes                           |
|------------------------------|------------|----------------------------------|
| Flow-matching transformer    | Medium     | 3 transformer layers + Euler ODE |
| Codec decoder                | High       | Conv transpose, ALiBi, QK-norm, LayerScale, weight norm |
| FSQ / VQ dequantization      | Low        | Simple lookup + uniform binning  |
| Voice embedding loader       | Low        | Read PyTorch .pt files           |
| Sinusoidal time embedding    | Low        | Standard sin/cos encoding        |
| TTS pipeline orchestrator    | Medium     | Ties everything together         |
| CLI binary                   | Low        | `voxtral-speak` or similar       |

---

## 4. New Layer Types

### 4.1 ALiBi (Attention with Linear Biases)

Used only in the codec. Instead of RoPE, ALiBi adds a learned bias to attention
scores based on relative position:

```
attn_score[i,j] += slope * (j - i)
```

where `slope` is a per-head constant derived from a geometric sequence. No
learned parameters -- purely computed from head index.

### 4.2 QK-Norm

Per-head RMSNorm applied to Q and K before computing attention scores:

```
Q_normed = rms_norm(Q, q_norm_weight)
K_normed = rms_norm(K, k_norm_weight)
scores = Q_normed @ K_normed^T / sqrt(head_dim)
```

Weights: `q_norm.weight [1024]`, `k_norm.weight [1024]` (one scalar per
head_dim element, shared across heads since n_heads * head_dim = 1024).

### 4.3 LayerScale

Learnable per-channel scaling applied after attention and FFN residuals:

```
x = x + attention_scale * attention(norm(x))
x = x + ffn_scale * ffn(ffn_norm(x))
```

Weights: `attention_scale [1024]`, `ffn_scale [1024]`. Initialized to 0.01
during training.

### 4.4 Weight-Normed Conv1d / ConvTranspose1d

PyTorch weight normalization decomposes a weight into magnitude `g` and direction
`v`. At load time, fuse into a single weight:

```rust
// Per output-channel normalization
let v_norm = v.reshape([c_out, -1]).norm_l2(dim=1);  // [c_out]
let weight = g * v / v_norm.reshape([c_out, 1, 1]);
```

For ConvTranspose1d, the kernel shape is `[C_in, C_out, K]` (transposed from
Conv1d's `[C_out, C_in, K]`).

### 4.5 Causal Convolutions

The codec uses causal convolutions: left-padded so output at position `t`
depends only on inputs at positions `<= t`. For kernel size `K` and stride `S`:

```
padding = (K - S)  # left-pad only
```

For transposed convolutions (upsampling), output trimming replaces input
padding:

```
# Remove (K - S) samples from the right of the output
output = conv_transpose(x)[:, :, :-(K-S)]
```

---

## 5. Proposed Module Layout

```
src/
  tts/
    mod.rs                    # pub mod + TtsModel top-level struct
    config.rs                 # TTS config parsing from params.json
    pipeline.rs               # End-to-end: text -> waveform
    backbone.rs               # Decoder backbone (reuses layers/)
    flow_matching.rs          # FM transformer + Euler ODE solver
    codec/
      mod.rs                  # CodecDecoder struct
      block.rs                # Transformer + Conv block pairs
      alibi.rs                # ALiBi positional bias
      qk_norm.rs              # QK normalization
      layer_scale.rs          # LayerScale
      conv.rs                 # Causal Conv1d + ConvTranspose1d
      quantizer.rs            # VQ lookup + FSQ dequantization
    embeddings.rs             # Audio codebook + voice embedding loading
    voice.rs                  # Voice preset loading (.pt reader)
  bin/
    speak.rs                  # CLI: voxtral-speak
```

---

## 6. Implementation Plan

### Phase 1: Backbone + Semantic Token Generation

**Goal:** Generate semantic token sequences from text + voice embeddings.

1. Parse TTS `params.json` into config structs
2. Add plain decoder layer mode (no ADA RMSNorm) to existing `decoder_layer.rs`
3. Load backbone weights from `consolidated.safetensors`
4. Load voice embeddings from `.pt` files (need minimal PyTorch tensor reader)
5. Load audio codebook embeddings (9088 entries)
6. Build input sequence: `[BOS] [voice_embeds] [<next>] [text_tokens] [<repeat>]`
7. Autoregressive decode: generate semantic tokens until EOA
8. **Test:** verify semantic token sequences are non-degenerate

### Phase 2: Flow-Matching Transformer

**Goal:** Generate acoustic tokens alongside semantic tokens.

1. Build FM transformer (3 bidirectional layers, reuse attention/SwiGLU)
2. Implement sinusoidal time embedding
3. Implement Euler ODE solver with CFG (alpha=1.2, 8 NFEs)
4. Implement FSQ quantization (36 dims x 21 levels)
5. Integrate into autoregressive loop: at each step, run FM on backbone hidden
   state to get acoustic tokens
6. **Test:** verify acoustic tokens have reasonable distributions

### Phase 3: Codec Decoder

**Goal:** Convert token sequences to audio waveforms.

1. Implement ALiBi positional bias
2. Implement QK-norm attention variant
3. Implement LayerScale
4. Implement causal Conv1d with weight normalization
5. Implement causal ConvTranspose1d (upsampling)
6. Implement VQ dequantization (semantic codebook lookup)
7. Implement FSQ dequantization (acoustic level mapping)
8. Assemble codec decoder: 4 conv+transformer block pairs + output projection
9. Load weights with weight-norm fusion
10. **Test:** feed known tokens through codec, verify output is 24 kHz audio

### Phase 4: End-to-End Pipeline + CLI

**Goal:** `cargo run --bin voxtral-speak -- --text "Hello" --voice casual_female`

1. Wire up full pipeline: text -> backbone -> FM -> codec -> WAV
2. Add 24 kHz WAV output support
3. Build `voxtral-speak` CLI binary
4. Streaming output support (chunked codec decoding)
5. **Test:** end-to-end transcription roundtrip (TTS -> ASR, check WER)

### Phase 5: WASM / Browser (Stretch)

1. Quantize TTS weights to Q4 GGUF
2. Port codec decoder to Q4 path
3. WASM bindings for TTS
4. Browser demo with audio playback

---

## 7. Open Questions

1. **Codec encoder for zero-shot voice cloning** -- weights are not in the
   checkpoint. Options: (a) only support preset voices initially, (b) find or
   request encoder weights separately, (c) use the Mistral API for voice
   encoding and run decode locally.

2. **PyTorch .pt file reading** -- voice embeddings are in PyTorch's pickle-based
   format. Options: (a) pre-convert to SafeTensors or raw f32 with a Python
   script, (b) add a minimal .pt reader in Rust (e.g. `tch` or `pickle`
   crate), (c) use `safetensors` Python to batch-convert at download time.

3. **Semantic head placement** -- the semantic logits head
   (`semantic_codebook_output`) lives on the `acoustic_transformer`, not the
   backbone. Need to verify: does the backbone hidden state go through the FM
   transformer to produce semantic logits, or is there a separate path? The
   paper says the backbone generates semantic tokens via a linear head, but the
   weights suggest otherwise. Checking the vLLM implementation would clarify.

4. **Audio codebook embedding layout** -- the [9088, 3072] tensor contains 8192
   semantic + 756 acoustic (36x21) = 8948 entries. The remaining 140 entries
   need investigation (special audio tokens? padding?).

5. **ConvTranspose1d in Burn** -- need to verify Burn 0.20 has ConvTranspose1d
   support, or whether we need a custom implementation via the WGPU backend.

6. **BF16 inference** -- the ASR path converts BF16 weights to F32 at load time.
   For TTS (7.5 GB), keeping BF16 throughout would halve memory. Check if Burn's
   WGPU backend supports BF16 compute.
