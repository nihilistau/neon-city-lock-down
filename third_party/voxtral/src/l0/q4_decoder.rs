//! Pure Level Zero Q4 decoder — bypasses Burn/wgpu entirely.
//!
//! This module implements the full 26-layer Voxtral decoder using:
//! - L0 USM for KV cache (true zero-copy VHT2)
//! - L0 compute kernels for Q4 matmul (attention projections)
//! - CPU for RMSNorm, RoPE, SwiGLU (these are bandwidth-bound, not compute-bound)
//!
//! # Architecture
//!
//! ```text
//! ┌────────────────────────────────────────────────────────┐
//! │  Per Decode Step (per layer):                          │
//! │                                                        │
//! │  1. RMSNorm (CPU)          — ~0.003 ms                │
//! │  2. Q/K/V projections      — 3× Q4 matmul (GPU L0)    │
//! │  3. RoPE (CPU)             — ~0.001 ms                │
//! │  4. KV cache update        — write to USM + VHT2      │
//! │  5. Attention scores       — Q×K^T / sqrt(d) (CPU)    │
//! │  6. Softmax (CPU)          — bandwidth-bound           │
//! │  7. Attention output       — scores × V (CPU)          │
//! │  8. Output projection      — Q4 matmul (GPU L0)       │
//! │  9. Residual add (CPU)     — trivial                   │
//! │  10. FFN: RMSNorm + SwiGLU — 3× Q4 matmul (GPU L0)   │
//! │  11. Residual add (CPU)    — trivial                   │
//! │                                                        │
//! │  Total per layer: ~6× Q4 matmul + CPU attention        │
//! │  Total per token: 26 × above + LM head                 │
//! └────────────────────────────────────────────────────────┘
//! ```
//!
//! # Key Design Decisions
//!
//! - CPU handles RMSNorm, RoPE, softmax, residual adds, attention scores (fast on i9)
//! - GPU handles Q4 dequant+matmul (compute-bound, benefits from 32 EUs)
//! - KV cache in USM: both CPU (VHT2) and GPU (read for future GPU attention) access same pointer
//! - Attention scores/output on CPU for now (single-token decode is memory-bound, not compute)
//! - No Burn, no wgpu, no staging buffers — minimal abstraction overhead

use super::decode::{L0DecodeConfig, L0DecodeContext};
use super::usm::{UsmAllocation, UsmAllocator};
use crate::models::layers::shannon_prime::{compress_kv_vector, decompress_kv_vector, BandConfig};
use anyhow::{bail, Context, Result};

// ───────────────────────────────────────────────────────────────────
// Configuration
// ───────────────────────────────────────────────────────────────────

/// Decoder configuration.
#[derive(Clone)]
pub struct DecoderConfig {
    pub n_layers: usize,
    pub hidden_dim: usize,
    pub q_heads: usize,
    pub kv_heads: usize,
    pub head_dim: usize,
    pub ffn_dim: usize,
    pub vocab_size: usize,
    pub max_seq_len: usize,
    pub rope_theta: f32,
}

impl DecoderConfig {
    /// Voxtral Mini decoder configuration.
    pub fn voxtral_mini() -> Self {
        DecoderConfig {
            n_layers: 26,
            hidden_dim: 3072,
            q_heads: 32,
            kv_heads: 8,
            head_dim: 96, // 3072 / 32 = 96
            ffn_dim: 8192,
            vocab_size: 131072,
            max_seq_len: 8192,
            rope_theta: 1000000.0,
        }
    }

    /// GQA group size (number of Q heads per KV head).
    pub fn gqa_groups(&self) -> usize {
        self.q_heads / self.kv_heads
    }

    /// Bytes needed for one layer's Q4 weights.
    pub fn layer_weight_bytes(&self) -> usize {
        let q4_block = 18; // 32 elements per block: 2 byte scale + 16 bytes data
        let blocks = |rows: usize, cols: usize| -> usize { rows * (cols / 32) * q4_block };

        let q = blocks(self.q_heads * self.head_dim, self.hidden_dim);
        let k = blocks(self.kv_heads * self.head_dim, self.hidden_dim);
        let v = blocks(self.kv_heads * self.head_dim, self.hidden_dim);
        let o = blocks(self.hidden_dim, self.q_heads * self.head_dim);
        let gate = blocks(self.ffn_dim, self.hidden_dim);
        let up = blocks(self.ffn_dim, self.hidden_dim);
        let down = blocks(self.hidden_dim, self.ffn_dim);

        q + k + v + o + gate + up + down
    }

    /// Total model size in bytes (Q4 weights only).
    pub fn total_weight_bytes(&self) -> usize {
        let per_layer = self.layer_weight_bytes();
        let lm_head = self.vocab_size * (self.hidden_dim / 32) * 18;
        let tok_embed = self.vocab_size * (self.hidden_dim / 32) * 18;
        per_layer * self.n_layers + lm_head + tok_embed
    }
}

// ───────────────────────────────────────────────────────────────────
// Weight Structures
// ───────────────────────────────────────────────────────────────────

/// Weights for a single decoder layer, stored in USM for L0 access.
pub struct Q4LayerWeights {
    // Attention projections (Q4 bytes in USM — GPU reads these)
    pub q_proj: UsmAllocation<u8>,  // Q4 [q_heads * head_dim, hidden_dim]
    pub k_proj: UsmAllocation<u8>,  // Q4 [kv_heads * head_dim, hidden_dim]
    pub v_proj: UsmAllocation<u8>,  // Q4 [kv_heads * head_dim, hidden_dim]
    pub o_proj: UsmAllocation<u8>,  // Q4 [hidden_dim, q_heads * head_dim]

    // FFN (SwiGLU) projections
    pub gate_proj: UsmAllocation<u8>, // Q4 [ffn_dim, hidden_dim] — w1
    pub up_proj: UsmAllocation<u8>,   // Q4 [ffn_dim, hidden_dim] — w3
    pub down_proj: UsmAllocation<u8>, // Q4 [hidden_dim, ffn_dim] — w2

    // Norms (f32, small — CPU access only)
    pub attn_norm: Vec<f32>, // [hidden_dim]
    pub ffn_norm: Vec<f32>,  // [hidden_dim]

    // Dimensions for this layer's matmuls
    pub q_out_dim: usize, // q_heads * head_dim
    pub kv_out_dim: usize, // kv_heads * head_dim
}

/// Full decoder model weights.
pub struct Q4DecoderWeights {
    pub layers: Vec<Q4LayerWeights>,
    pub final_norm: Vec<f32>,              // [hidden_dim]
    pub lm_head: UsmAllocation<u8>,        // Q4 [vocab_size, hidden_dim]
    pub tok_embeddings_q4: UsmAllocation<u8>, // Q4 [vocab_size, hidden_dim]
}

// ───────────────────────────────────────────────────────────────────
// Full Decoder
// ───────────────────────────────────────────────────────────────────

/// The complete L0-native decoder: weights + runtime state.
pub struct L0Decoder {
    pub config: DecoderConfig,
    pub weights: Q4DecoderWeights,
    pub decode_ctx: L0DecodeContext,
    pub band_config: BandConfig,

    // Scratch buffers (pre-allocated, reused each step)
    // These are USM-allocated so the GPU can read/write them for Q4 matmul.
    scratch_input: UsmAllocation<f32>,  // [hidden_dim] — input to matmul
    scratch_q: UsmAllocation<f32>,      // [q_heads * head_dim] — Q output
    scratch_k: UsmAllocation<f32>,      // [kv_heads * head_dim] — K output
    scratch_v: UsmAllocation<f32>,      // [kv_heads * head_dim] — V output
    scratch_attn_out: UsmAllocation<f32>, // [q_heads * head_dim] — attention concat
    scratch_o: UsmAllocation<f32>,      // [hidden_dim] — output projection result
    scratch_gate: UsmAllocation<f32>,   // [ffn_dim] — gate proj output
    scratch_up: UsmAllocation<f32>,     // [ffn_dim] — up proj output
    scratch_down: UsmAllocation<f32>,   // [hidden_dim] — down proj output
    scratch_logits: UsmAllocation<f32>, // [vocab_size] — LM head output
}

impl L0Decoder {
    /// Create a properly-sized L0DecodeContext for the given config.
    ///
    /// The KV cache is sized for ALL layers by multiplexing: effective_heads = n_layers * kv_heads.
    /// Use the returned context's `allocator` field to load weights before calling `L0Decoder::new`.
    pub fn create_decode_context(config: &DecoderConfig, band_config: &BandConfig) -> Result<L0DecodeContext> {
        let decode_config = L0DecodeConfig {
            batch: 1,
            kv_heads: config.n_layers * config.kv_heads,
            max_seq_len: config.max_seq_len,
            head_dim: config.head_dim,
            band_config: band_config.clone(),
        };
        L0DecodeContext::new(decode_config)
    }

    /// Create the L0 decoder with a pre-initialized decode context and pre-loaded weights.
    ///
    /// Use `create_decode_context()` to build the context with the right KV cache size,
    /// then load weights using `decode_ctx.allocator`, then pass both here.
    pub fn new(
        config: DecoderConfig,
        weights: Q4DecoderWeights,
        decode_ctx: L0DecodeContext,
        band_config: BandConfig,
    ) -> Result<Self> {
        let allocator = &decode_ctx.allocator;

        // Allocate scratch buffers in USM
        let scratch_input = allocator.alloc_shared::<f32>(config.hidden_dim)?;
        let scratch_q = allocator.alloc_shared::<f32>(config.q_heads * config.head_dim)?;
        let scratch_k = allocator.alloc_shared::<f32>(config.kv_heads * config.head_dim)?;
        let scratch_v = allocator.alloc_shared::<f32>(config.kv_heads * config.head_dim)?;
        let scratch_attn_out = allocator.alloc_shared::<f32>(config.q_heads * config.head_dim)?;
        let scratch_o = allocator.alloc_shared::<f32>(config.hidden_dim)?;
        let scratch_gate = allocator.alloc_shared::<f32>(config.ffn_dim)?;
        let scratch_up = allocator.alloc_shared::<f32>(config.ffn_dim)?;
        let scratch_down = allocator.alloc_shared::<f32>(config.hidden_dim)?;
        let scratch_logits = allocator.alloc_shared::<f32>(config.vocab_size)?;

        Ok(L0Decoder {
            config,
            weights,
            decode_ctx,
            band_config,
            scratch_input,
            scratch_q,
            scratch_k,
            scratch_v,
            scratch_attn_out,
            scratch_o,
            scratch_gate,
            scratch_up,
            scratch_down,
            scratch_logits,
        })
    }

    /// Reset for a new sequence.
    pub fn reset(&mut self) {
        self.decode_ctx.reset();
    }

    /// Current sequence position.
    pub fn seq_len(&self) -> usize {
        self.decode_ctx.seq_len()
    }

    /// Decode one token: given hidden state [hidden_dim], produce logits [vocab_size].
    ///
    /// `hidden` is the input hidden state (from token embedding or adapter output).
    /// `pos` is the sequence position for RoPE.
    ///
    /// Returns the argmax token ID and writes logits to internal scratch.
    pub fn decode_step(&mut self, hidden: &mut Vec<f32>, pos: usize) -> Result<u32> {
        let n_layers = self.config.n_layers;
        let hidden_dim = self.config.hidden_dim;
        let vocab_size = self.config.vocab_size;
        debug_assert_eq!(hidden.len(), hidden_dim);

        // Process each decoder layer
        for layer_idx in 0..n_layers {
            self.decode_layer(hidden, layer_idx, pos)?;
        }

        // Advance KV cache position (all layers wrote to seq_len, now bump it)
        self.decode_ctx.kv_cache.current_len += 1;

        // Final RMSNorm
        rms_norm(hidden, &self.weights.final_norm, 1e-5);

        // LM head projection: hidden [hidden_dim] → logits [vocab_size]
        unsafe {
            let inp = self.scratch_input.as_mut_slice();
            inp.copy_from_slice(hidden);
        }

        self.decode_ctx.q4_matmul(
            self.weights.lm_head.ptr(),
            self.scratch_input.ptr(),
            self.scratch_logits.ptr() as *mut f32,
            1,  // B
            1,  // M
            hidden_dim as u32,
            vocab_size as u32,
        )?;

        // Argmax on CPU
        let logits = unsafe { self.scratch_logits.as_slice() };
        let mut best_id = 0u32;
        let mut best_val = f32::NEG_INFINITY;
        for (i, &v) in logits.iter().enumerate() {
            if v > best_val {
                best_val = v;
                best_id = i as u32;
            }
        }

        Ok(best_id)
    }

    /// Process a single decoder layer (attention + FFN with residual connections).
    ///
    /// Uses batched GPU dispatch to minimize fence synchronizations:
    /// - Batch 1: Q + K + V projections (3 matmuls, 1 fence)
    /// - Batch 2: O projection (1 matmul, 1 fence)
    /// - Batch 3: gate + up projections (2 matmuls, 1 fence)
    /// - Batch 4: down projection (1 matmul, 1 fence)
    /// Total: 4 fences per layer (was 6 without batching)
    fn decode_layer(
        &mut self,
        hidden: &mut Vec<f32>,
        layer_idx: usize,
        pos: usize,
    ) -> Result<()> {
        let hidden_dim = self.config.hidden_dim;
        let q_heads = self.config.q_heads;
        let kv_heads = self.config.kv_heads;
        let head_dim = self.config.head_dim;
        let ffn_dim = self.config.ffn_dim;
        let rope_theta = self.config.rope_theta;
        let q_dim = (q_heads * head_dim) as u32;
        let kv_dim = (kv_heads * head_dim) as u32;

        // ─── Attention Block ───────────────────────────────────────────────

        // 1. Pre-attention RMSNorm → scratch_input
        unsafe {
            let inp = self.scratch_input.as_mut_slice();
            inp.copy_from_slice(hidden);
            rms_norm(inp, &self.weights.layers[layer_idx].attn_norm, 1e-5);
        }

        // 2. Batched Q/K/V projections (3 matmuls, 1 fence)
        let q_proj_ptr = self.weights.layers[layer_idx].q_proj.ptr();
        let k_proj_ptr = self.weights.layers[layer_idx].k_proj.ptr();
        let v_proj_ptr = self.weights.layers[layer_idx].v_proj.ptr();
        let input_ptr = self.scratch_input.ptr();
        let q_out_ptr = self.scratch_q.ptr() as *mut f32;
        let k_out_ptr = self.scratch_k.ptr() as *mut f32;
        let v_out_ptr = self.scratch_v.ptr() as *mut f32;

        self.decode_ctx.q4_matmul_batch(&[
            (q_proj_ptr, input_ptr, q_out_ptr, 1, 1, hidden_dim as u32, q_dim),
            (k_proj_ptr, input_ptr, k_out_ptr, 1, 1, hidden_dim as u32, kv_dim),
            (v_proj_ptr, input_ptr, v_out_ptr, 1, 1, hidden_dim as u32, kv_dim),
        ])?;

        // 3. RoPE on Q and K (CPU)
        unsafe {
            let q = self.scratch_q.as_mut_slice();
            let k = self.scratch_k.as_mut_slice();
            apply_rope(q, k, q_heads, kv_heads, head_dim, pos, rope_theta);
        }

        // 4. Append K/V to USM cache with VHT2 (zero-copy, no heap alloc)
        unsafe {
            let kv_heads = self.config.kv_heads;
            let head_dim = self.config.head_dim;
            let seq_idx = self.decode_ctx.seq_len();

            let k_data = self.scratch_k.as_slice();
            let v_data = self.scratch_v.as_slice();

            for h in 0..kv_heads {
                let src_offset = h * head_dim;
                let effective_head = layer_idx * kv_heads + h;

                // Key — write to USM, apply VHT2 in-place
                let key_slice = self.decode_ctx.kv_cache.key_slice_mut(0, effective_head, seq_idx);
                key_slice.copy_from_slice(&k_data[src_offset..src_offset + head_dim]);
                vht2_compress_slice(key_slice, &self.band_config);

                // Value
                let val_slice = self.decode_ctx.kv_cache.value_slice_mut(0, effective_head, seq_idx);
                val_slice.copy_from_slice(&v_data[src_offset..src_offset + head_dim]);
                vht2_compress_slice(val_slice, &self.band_config);
            }
        }

        // 5. Attention: Q × K^T / sqrt(d), softmax, × V (CPU for single-token decode)
        unsafe {
            self.compute_attention(layer_idx, pos)?;
        }

        // 6. Output projection (1 matmul, 1 fence)
        let o_proj_ptr = self.weights.layers[layer_idx].o_proj.ptr();
        let attn_out_ptr = self.scratch_attn_out.ptr();
        let o_out_ptr = self.scratch_o.ptr() as *mut f32;
        self.decode_ctx.q4_matmul(
            o_proj_ptr, attn_out_ptr, o_out_ptr,
            1, 1, q_dim, hidden_dim as u32,
        )?;

        // 7. Residual add
        unsafe {
            let o = self.scratch_o.as_slice();
            for i in 0..hidden_dim {
                hidden[i] += o[i];
            }
        }

        // ─── FFN Block ─────────────────────────────────────────────────────

        // 8. Pre-FFN RMSNorm → scratch_input
        unsafe {
            let inp = self.scratch_input.as_mut_slice();
            inp.copy_from_slice(hidden);
            rms_norm(inp, &self.weights.layers[layer_idx].ffn_norm, 1e-5);
        }

        // 9. Batched gate + up projections (2 matmuls, 1 fence)
        let gate_proj_ptr = self.weights.layers[layer_idx].gate_proj.ptr();
        let up_proj_ptr = self.weights.layers[layer_idx].up_proj.ptr();
        let input_ptr = self.scratch_input.ptr();
        let gate_out_ptr = self.scratch_gate.ptr() as *mut f32;
        let up_out_ptr = self.scratch_up.ptr() as *mut f32;

        self.decode_ctx.q4_matmul_batch(&[
            (gate_proj_ptr, input_ptr, gate_out_ptr, 1, 1, hidden_dim as u32, ffn_dim as u32),
            (up_proj_ptr, input_ptr, up_out_ptr, 1, 1, hidden_dim as u32, ffn_dim as u32),
        ])?;

        // 10. SwiGLU: gate = gate * silu(up) (CPU)
        unsafe {
            let gate = self.scratch_gate.as_mut_slice();
            let up = self.scratch_up.as_slice();
            swiglu_inplace(gate, up);
        }

        // 11. Down projection (1 matmul, 1 fence)
        let down_proj_ptr = self.weights.layers[layer_idx].down_proj.ptr();
        let gate_ptr = self.scratch_gate.ptr();
        let down_out_ptr = self.scratch_down.ptr() as *mut f32;
        self.decode_ctx.q4_matmul(
            down_proj_ptr, gate_ptr, down_out_ptr,
            1, 1, ffn_dim as u32, hidden_dim as u32,
        )?;

        // 12. Residual add
        unsafe {
            let down = self.scratch_down.as_slice();
            for i in 0..hidden_dim {
                hidden[i] += down[i];
            }
        }

        Ok(())
    }

    /// Write K/V to per-layer KV cache position.
    /// Compute multi-head attention on CPU for single-token decode.
    ///
    /// For single-token decode (M=1), attention is memory-bound, not compute-bound.
    /// CPU can do this efficiently since the data is already in USM (same DRAM).
    ///
    /// GQA: each KV head serves `gqa_groups` Q heads.
    unsafe fn compute_attention(&mut self, layer_idx: usize, _pos: usize) -> Result<()> {
        let cfg = &self.config;
        let seq_len = self.decode_ctx.seq_len() + 1; // Include current token
        let kv_cache = &self.decode_ctx.kv_cache;
        let gqa_groups = cfg.gqa_groups();
        let scale = 1.0 / (cfg.head_dim as f32).sqrt();

        let q_buf = self.scratch_q.as_slice();
        let attn_out = self.scratch_attn_out.as_mut_slice();

        // Temporary buffer for attention scores (on stack/heap, not USM)
        let mut scores = vec![0.0f32; seq_len];

        // Process each Q head
        for qh in 0..cfg.q_heads {
            let kv_head = qh / gqa_groups;
            let effective_head = layer_idx * cfg.kv_heads + kv_head;

            let q_slice = &q_buf[qh * cfg.head_dim..(qh + 1) * cfg.head_dim];

            // Compute Q × K^T for all cached positions
            for s in 0..seq_len {
                let k_slice = kv_cache.key_slice_mut(0, effective_head, s);
                let k_slice = &*(k_slice as *const [f32]); // immutable borrow
                let mut dot = 0.0f32;
                for d in 0..cfg.head_dim {
                    dot += q_slice[d] * k_slice[d];
                }
                scores[s] = dot * scale;
            }

            // Softmax
            softmax_inplace(&mut scores[..seq_len]);

            // Weighted sum of V
            let out_slice = &mut attn_out[qh * cfg.head_dim..(qh + 1) * cfg.head_dim];
            out_slice.fill(0.0);
            for s in 0..seq_len {
                let v_slice = kv_cache.value_slice_mut(0, effective_head, s);
                let v_slice = &*(v_slice as *const [f32]); // immutable borrow
                let w = scores[s];
                for d in 0..cfg.head_dim {
                    out_slice[d] += w * v_slice[d];
                }
            }
        }

        Ok(())
    }

    /// Embed a token ID using Q4 embeddings (CPU dequant).
    pub fn embed_token(&self, token_id: u32) -> Vec<f32> {
        let cfg = &self.config;
        let blocks_per_row = cfg.hidden_dim / 32;
        let row_bytes = blocks_per_row * 18; // 18 bytes per Q4 block
        let offset = (token_id as usize) * row_bytes;

        let embed_bytes = unsafe { self.weights.tok_embeddings_q4.as_slice() };
        let row = &embed_bytes[offset..offset + row_bytes];

        // Dequantize Q4 row to f32
        let mut output = vec![0.0f32; cfg.hidden_dim];
        for block_idx in 0..blocks_per_row {
            let block_offset = block_idx * 18;
            // First 2 bytes: fp16 scale
            let scale_bits = u16::from_le_bytes([row[block_offset], row[block_offset + 1]]);
            let scale = half::f16::from_bits(scale_bits).to_f32();
            // Next 16 bytes: 32 nibbles
            for byte_idx in 0..16 {
                let byte = row[block_offset + 2 + byte_idx];
                let lo = (byte & 0x0F) as i8 - 8;
                let hi = ((byte >> 4) & 0x0F) as i8 - 8;
                let out_idx = block_idx * 32 + byte_idx * 2;
                output[out_idx] = lo as f32 * scale;
                output[out_idx + 1] = hi as f32 * scale;
            }
        }
        output
    }

    /// Get raw logits slice (for temperature sampling etc).
    pub fn logits(&self) -> &[f32] {
        unsafe { self.scratch_logits.as_slice() }
    }
}

// ───────────────────────────────────────────────────────────────────
// GGUF Weight Loader (requires wgpu feature for gguf module access)
// ───────────────────────────────────────────────────────────────────

/// Load decoder weights from a GGUF file into USM allocations.
///
/// This reads Q4 bytes from the GGUF and copies them directly into USM-shared
/// memory so the L0 GPU kernels can access them without any staging buffer.
#[cfg(feature = "wgpu")]
pub fn load_decoder_weights_from_gguf<R: std::io::Read + std::io::Seek>(
    reader: &mut crate::gguf::reader::GgufReader<R>,
    allocator: &UsmAllocator,
    config: &DecoderConfig,
) -> Result<Q4DecoderWeights> {
    let mut layers = Vec::with_capacity(config.n_layers);

    println!("Loading {} decoder layers into USM...", config.n_layers);

    for i in 0..config.n_layers {
        let layer = load_layer_weights(reader, allocator, config, i)
            .with_context(|| format!("Failed to load layer {i}"))?;
        layers.push(layer);

        if (i + 1) % 5 == 0 || i == config.n_layers - 1 {
            println!("  Loaded {}/{} layers", i + 1, config.n_layers);
        }
    }

    // Final norm
    let final_norm = load_f32_tensor(reader, "norm.weight")?;

    // LM head (output.weight — may be tied to tok_embeddings)
    let lm_head_name = if reader.tensor_info("output.weight").is_some() {
        "output.weight"
    } else {
        // Tied weights — use token embeddings as LM head
        "mm_streams_embeddings.embedding_module.tok_embeddings.weight"
    };
    let lm_head = load_q4_to_usm(reader, allocator, lm_head_name)?;

    // Token embeddings
    let tok_embed_name = "mm_streams_embeddings.embedding_module.tok_embeddings.weight";
    let tok_embeddings_q4 = load_q4_to_usm(reader, allocator, tok_embed_name)?;

    println!("All weights loaded into USM.");
    Ok(Q4DecoderWeights {
        layers,
        final_norm,
        lm_head,
        tok_embeddings_q4,
    })
}

/// Load weights for a single decoder layer.
#[cfg(feature = "wgpu")]
fn load_layer_weights<R: std::io::Read + std::io::Seek>(
    reader: &mut crate::gguf::reader::GgufReader<R>,
    allocator: &UsmAllocator,
    config: &DecoderConfig,
    layer_idx: usize,
) -> Result<Q4LayerWeights> {
    let prefix = format!("layers.{}", layer_idx);

    // Attention projections (Q4)
    let q_proj = load_q4_to_usm(reader, allocator, &format!("{}.attention.wq.weight", prefix))?;
    let k_proj = load_q4_to_usm(reader, allocator, &format!("{}.attention.wk.weight", prefix))?;
    let v_proj = load_q4_to_usm(reader, allocator, &format!("{}.attention.wv.weight", prefix))?;
    let o_proj = load_q4_to_usm(reader, allocator, &format!("{}.attention.wo.weight", prefix))?;

    // FFN projections (Q4)
    let gate_proj = load_q4_to_usm(reader, allocator, &format!("{}.feed_forward.w1.weight", prefix))?;
    let down_proj = load_q4_to_usm(reader, allocator, &format!("{}.feed_forward.w2.weight", prefix))?;
    let up_proj = load_q4_to_usm(reader, allocator, &format!("{}.feed_forward.w3.weight", prefix))?;

    // Norms (f32)
    let attn_norm = load_f32_tensor(reader, &format!("{}.attention_norm.weight", prefix))?;
    let ffn_norm = load_f32_tensor(reader, &format!("{}.ffn_norm.weight", prefix))?;

    Ok(Q4LayerWeights {
        q_proj,
        k_proj,
        v_proj,
        o_proj,
        gate_proj,
        up_proj,
        down_proj,
        attn_norm,
        ffn_norm,
        q_out_dim: config.q_heads * config.head_dim,
        kv_out_dim: config.kv_heads * config.head_dim,
    })
}

/// Load Q4 tensor bytes from GGUF directly into USM.
#[cfg(feature = "wgpu")]
fn load_q4_to_usm<R: std::io::Read + std::io::Seek>(
    reader: &mut crate::gguf::reader::GgufReader<R>,
    allocator: &UsmAllocator,
    name: &str,
) -> Result<UsmAllocation<u8>> {
    let bytes = reader
        .tensor_data(name)
        .with_context(|| format!("Failed to read tensor '{name}' from GGUF"))?;

    let usm_buf = allocator
        .alloc_shared::<u8>(bytes.len())
        .with_context(|| format!("USM alloc failed for '{name}' ({} bytes)", bytes.len()))?;

    // Copy Q4 bytes into USM
    unsafe {
        usm_buf.write_at(0, &bytes);
    }

    Ok(usm_buf)
}

/// Load an f32/f16 tensor from GGUF as Vec<f32>.
#[cfg(feature = "wgpu")]
fn load_f32_tensor<R: std::io::Read + std::io::Seek>(
    reader: &mut crate::gguf::reader::GgufReader<R>,
    name: &str,
) -> Result<Vec<f32>> {
    let info = reader
        .tensor_info(name)
        .with_context(|| format!("Tensor '{name}' not found"))?
        .clone();

    let bytes = reader.tensor_data(name)?;

    let data: Vec<f32> = match info.dtype() {
        crate::gguf::reader::GgmlDtype::F32 => bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect(),
        crate::gguf::reader::GgmlDtype::F16 => bytes
            .chunks_exact(2)
            .map(|b| {
                let bits = u16::from_le_bytes([b[0], b[1]]);
                half::f16::from_bits(bits).to_f32()
            })
            .collect(),
        other => bail!("Unexpected dtype {:?} for tensor '{}'", other, name),
    };

    Ok(data)
}

// ───────────────────────────────────────────────────────────────────
// VHT2 Helper
// ───────────────────────────────────────────────────────────────────

/// Apply VHT2 compress+decompress to a KV slice.
///
/// Supports any dimension that factors into 2s and 3s (including 96 = 2^5 × 3).
/// VHT2 now handles composite orders natively via mixed-radix butterflies.
#[inline]
fn vht2_compress_slice(slice: &mut [f32], band_config: &BandConfig) {
    compress_kv_vector(slice, band_config);
    decompress_kv_vector(slice);
}

// ───────────────────────────────────────────────────────────────────
// CPU Kernel Functions
// ───────────────────────────────────────────────────────────────────

/// RMS normalization on CPU (operates on f32 buffer in-place).
pub fn rms_norm(x: &mut [f32], weight: &[f32], eps: f32) {
    let n = x.len();
    debug_assert_eq!(n, weight.len());

    let sum_sq: f32 = x.iter().map(|&v| v * v).sum();
    let rms = (sum_sq / n as f32 + eps).sqrt();
    let inv_rms = 1.0 / rms;

    for i in 0..n {
        x[i] = x[i] * inv_rms * weight[i];
    }
}

/// Apply RoPE to Q/K vectors (operates on f32 buffers).
pub fn apply_rope(
    q: &mut [f32], // [q_heads * head_dim]
    k: &mut [f32], // [kv_heads * head_dim]
    q_heads: usize,
    kv_heads: usize,
    head_dim: usize,
    pos: usize,
    theta: f32,
) {
    let half_dim = head_dim / 2;

    // Apply to Q heads
    for head in 0..q_heads {
        let buf = &mut q[head * head_dim..(head + 1) * head_dim];
        rope_head(buf, half_dim, head_dim, pos, theta);
    }
    // Apply to K heads
    for head in 0..kv_heads {
        let buf = &mut k[head * head_dim..(head + 1) * head_dim];
        rope_head(buf, half_dim, head_dim, pos, theta);
    }
}

#[inline]
fn rope_head(buf: &mut [f32], half_dim: usize, head_dim: usize, pos: usize, theta: f32) {
    for i in 0..half_dim {
        let freq = 1.0 / theta.powf(2.0 * i as f32 / head_dim as f32);
        let angle = pos as f32 * freq;
        let cos_val = angle.cos();
        let sin_val = angle.sin();

        let x0 = buf[i];
        let x1 = buf[i + half_dim];
        buf[i] = x0 * cos_val - x1 * sin_val;
        buf[i + half_dim] = x0 * sin_val + x1 * cos_val;
    }
}

/// SwiGLU activation: gate = gate * silu(up)
/// where silu(x) = x * sigmoid(x)
pub fn swiglu_inplace(gate: &mut [f32], up: &[f32]) {
    debug_assert_eq!(gate.len(), up.len());
    for i in 0..gate.len() {
        let sigmoid = 1.0 / (1.0 + (-up[i]).exp());
        let silu = up[i] * sigmoid;
        gate[i] *= silu;
    }
}

/// Softmax over a slice (numerically stable).
pub fn softmax_inplace(x: &mut [f32]) {
    let max_val = x.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let mut sum = 0.0f32;
    for v in x.iter_mut() {
        *v = (*v - max_val).exp();
        sum += *v;
    }
    let inv_sum = 1.0 / sum;
    for v in x.iter_mut() {
        *v *= inv_sum;
    }
}

/// Print model size summary.
pub fn print_model_summary() {
    let config = DecoderConfig::voxtral_mini();
    let per_layer = config.layer_weight_bytes();
    let total = config.total_weight_bytes();

    println!("Voxtral Mini Decoder (Q4_0, L0 Backend):");
    println!(
        "  Layers: {}, Hidden: {}, Heads: {}Q/{}KV, HeadDim: {}",
        config.n_layers, config.hidden_dim, config.q_heads, config.kv_heads, config.head_dim
    );
    println!("  FFN: {}, Vocab: {}", config.ffn_dim, config.vocab_size);
    println!(
        "  Per-layer weights: {:.1} MiB",
        per_layer as f64 / (1024.0 * 1024.0)
    );
    println!(
        "  Total weights: {:.1} MiB ({:.2} GiB)",
        total as f64 / (1024.0 * 1024.0),
        total as f64 / (1024.0 * 1024.0 * 1024.0)
    );
    println!(
        "  KV cache (USM, all layers): {:.1} MiB",
        (2 * config.n_layers * config.kv_heads * config.max_seq_len * config.head_dim * 4) as f64
            / (1024.0 * 1024.0)
    );
}
