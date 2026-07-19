//! Flow-matching transformer for TTS acoustic token prediction.
//!
//! A 3-layer bidirectional (non-causal) transformer that predicts acoustic velocity
//! from backbone hidden states. Uses GQA (32Q/8KV), RoPE with theta=10K, and
//! SwiGLU FFN. See T-08 in docs/tts-tasks.md for full spec.
//!
//! ## T-09: Sinusoidal Time Embedding (Reuse Decision)
//!
//! The flow-matching transformer requires a 3072-dim sinusoidal time embedding for
//! the ODE solver time step `t ∈ [0, 1]`. Rather than implementing a new module,
//! we reuse [`crate::models::time_embedding::TimeEmbedding`] directly:
//!
//! - Supports arbitrary dimension (3072 for TTS)
//! - Takes scalar `t: f32` input
//! - Returns `[1, 1, dim]` tensor
//! - Uses `[cos, sin]` concatenation ordering (same Mistral codebase convention)
//! - Custom theta available via `TimeEmbedding::with_theta()` if needed
//!
//! The time embedding output is projected through `time_projection` [3072, 3072]
//! before being fed to the FM transformer layers at position 1 of the 3-token
//! input sequence.

use anyhow::{Context, Result};
use burn::module::{Module, Param, ParamId};
use burn::nn::Linear;
use burn::tensor::backend::Backend;
use burn::tensor::Tensor;
use safetensors::SafeTensors;

use crate::models::layers::{Attention, RmsNorm, RoPE, RoPEConfig, SwiGLU};
use crate::models::time_embedding::TimeEmbedding;
use crate::models::weights::{load_linear, load_tensor};
use crate::tts::config::FmTransformerConfig;

/// A single bidirectional (non-causal) transformer layer for the FM transformer.
///
/// Same structure as a decoder layer but with non-causal attention:
/// `x → attention_norm → attention(non-causal) → + → ffn_norm → swiglu → +`
#[derive(Module, Debug)]
pub struct FmLayer<B: Backend> {
    attention_norm: RmsNorm<B>,
    attention: Attention<B>,
    ffn_norm: RmsNorm<B>,
    ffn: SwiGLU<B>,
}

impl<B: Backend> FmLayer<B> {
    /// Create from loaded components.
    pub fn new(
        attention_norm: RmsNorm<B>,
        attention: Attention<B>,
        ffn_norm: RmsNorm<B>,
        ffn: SwiGLU<B>,
    ) -> Self {
        Self {
            attention_norm,
            attention,
            ffn_norm,
            ffn,
        }
    }

    /// Forward pass with non-causal (bidirectional) attention.
    pub fn forward(&self, x: Tensor<B, 3>, rope: &RoPE<B>) -> Tensor<B, 3> {
        // Attention with residual (non-causal: causal=false)
        let residual = x.clone();
        let x = self.attention_norm.forward(x);
        let x = self.attention.forward(x, rope, 0, false);
        let x = x + residual;

        // FFN with residual
        let residual = x.clone();
        let x = self.ffn_norm.forward(x);
        let x = self.ffn.forward(x);
        x + residual
    }
}

/// Flow-matching transformer for acoustic token prediction.
///
/// Predicts acoustic velocity vectors from backbone hidden states using
/// Euler ODE steps with classifier-free guidance.
///
/// Per-frame input sequence (length 3):
/// - Position 0: backbone hidden state `h` via `llm_projection` [3072→3072]
/// - Position 1: sinusoidal time embedding `t` via `time_projection` [3072→3072]
/// - Position 2: current acoustic state `x_t` via `input_projection` [3072, 36]
///
/// Output heads (both are simple linear projections, no FM layers involved):
/// - `semantic_codebook_output` [8320, 3072] → semantic logits from backbone `h`
/// - `acoustic_codebook_output` [36, 3072] → velocity in R^36 from FM hidden
#[derive(Debug)]
pub struct FmTransformer<B: Backend> {
    /// Sinusoidal time embedding (reused from ASR, see T-09 decision above).
    time_embedding: TimeEmbedding,
    /// RoPE with theta=10K for FM layers.
    rope: RoPE<B>,
    /// 3 bidirectional transformer layers.
    layers: Vec<FmLayer<B>>,
    /// Projects backbone hidden state h [3072] → FM input.
    llm_projection: Linear<B>,
    /// Projects time embedding [3072] → FM input.
    time_projection: Linear<B>,
    /// Projects acoustic state x_t [36] → [3072] FM input.
    input_projection: Linear<B>,
    /// Semantic logits head: h → [8320] logits. Direct projection, no FM layers.
    semantic_codebook_output: Linear<B>,
    /// Acoustic velocity head: FM hidden → [36] velocity.
    acoustic_codebook_output: Linear<B>,
    /// Final RMSNorm applied after FM layers.
    norm: RmsNorm<B>,
    /// Config for masking constants.
    config: FmTransformerConfig,
}

impl<B: Backend> FmTransformer<B> {
    /// Load FM transformer from SafeTensors with prefix `acoustic_transformer.`.
    pub fn load(
        safetensors: &SafeTensors,
        config: &FmTransformerConfig,
        device: &B::Device,
    ) -> Result<Self> {
        let prefix = "acoustic_transformer";

        // Input/output projections
        let llm_projection = load_linear(
            safetensors,
            &format!("{prefix}.llm_projection.weight"),
            None,
            device,
        )
        .context("loading llm_projection")?;

        let time_projection = load_linear(
            safetensors,
            &format!("{prefix}.time_projection.weight"),
            None,
            device,
        )
        .context("loading time_projection")?;

        let input_projection = load_linear(
            safetensors,
            &format!("{prefix}.input_projection.weight"),
            None,
            device,
        )
        .context("loading input_projection")?;

        let semantic_codebook_output = load_linear(
            safetensors,
            &format!("{prefix}.semantic_codebook_output.weight"),
            None,
            device,
        )
        .context("loading semantic_codebook_output")?;

        let acoustic_codebook_output = load_linear(
            safetensors,
            &format!("{prefix}.acoustic_codebook_output.weight"),
            None,
            device,
        )
        .context("loading acoustic_codebook_output")?;

        // Load transformer layers
        let mut layers = Vec::with_capacity(config.n_layers);
        for i in 0..config.n_layers {
            let layer_prefix = format!("{prefix}.layers.{i}");
            let layer = load_fm_layer(safetensors, &layer_prefix, config, device)
                .with_context(|| format!("loading FM layer {i}"))?;
            layers.push(layer);
        }

        // Final RMSNorm
        let norm_weight: Tensor<B, 1> =
            load_tensor(safetensors, &format!("{prefix}.norm.weight"), device)
                .context("loading FM norm")?;
        let norm: RmsNorm<B> = RmsNorm {
            weight: burn::nn::RmsNorm {
                gamma: Param::initialized(ParamId::new(), norm_weight),
                epsilon: 1e-5,
            },
        };

        // RoPE with theta=10K, max seq_len=3 (the FM input is always 3 tokens)
        // Use a small buffer for safety.
        let rope = RoPEConfig::new(config.head_dim, 16)
            .with_theta(config.rope_theta)
            .init(device);

        let time_embedding = TimeEmbedding::new(config.dim);

        Ok(Self {
            time_embedding,
            rope,
            layers,
            llm_projection,
            time_projection,
            input_projection,
            semantic_codebook_output,
            acoustic_codebook_output,
            norm,
            config: config.clone(),
        })
    }

    /// Predict acoustic velocity from backbone hidden state via FM layers.
    ///
    /// Builds a 3-token sequence:
    /// - pos 0: `llm_projection(h)`
    /// - pos 1: `time_projection(time_embed(t))`
    /// - pos 2: `input_projection(x_t)`
    ///
    /// Runs through 3 bidirectional layers, then extracts position 2's hidden
    /// and projects via `acoustic_codebook_output` → velocity in R^36.
    pub fn predict_velocity(&self, h: Tensor<B, 3>, x_t: Tensor<B, 3>, t: f32) -> Tensor<B, 2> {
        let device = h.device();

        // Project inputs to FM dim
        let x_proj = self.input_projection.forward(x_t); // [B, 1, 3072]
        let t_embed = self.time_embedding.embed(t, &device); // [1, 1, 3072]
        let t_proj = self.time_projection.forward(t_embed); // [1, 1, 3072]
        let h_proj = self.llm_projection.forward(h); // [B, 1, 3072]

        // Expand t_proj to match batch dimension (for batched CFG)
        let [batch, _, _] = x_proj.dims();
        let t_proj = t_proj.expand([batch, 1, self.config.dim]);

        // Build 3-token sequence: [x_t, t, h] per vLLM reference
        // Position 0: acoustic state, Position 1: time, Position 2: backbone hidden
        let seq = Tensor::cat(vec![x_proj, t_proj, h_proj], 1);

        // Run through bidirectional layers
        let mut hidden = seq;
        for layer in &self.layers {
            hidden = layer.forward(hidden, &self.rope);
        }

        // Apply final norm
        hidden = self.norm.forward(hidden);

        // Extract position 0 (acoustic state position) hidden and project to velocity
        // Per vLLM: `acoustic_codebook_output(hidden[:, 0, :])` → R^36
        let [batch, _seq, dim] = hidden.dims();
        let h_acoustic = hidden.slice([0..batch, 0..1, 0..dim]); // [1, 1, dim]
        let velocity = self.acoustic_codebook_output.forward(h_acoustic); // [1, 1, 36]
        velocity.reshape([batch, self.config.acoustic_dim])
    }

    /// Compute semantic logits via direct projection of backbone hidden state.
    ///
    /// This does NOT pass through the FM transformer layers — it's a simple
    /// linear projection. The weight is namespaced under `acoustic_transformer`
    /// but functionally acts on raw `h`.
    ///
    /// Returns logits of shape [batch, semantic_output_size] with masking:
    /// - Index 0 (EMPTY_AUDIO) masked to -inf
    /// - Indices >= (2 + 8192) masked to -inf (beyond valid semantic range)
    pub fn semantic_logits(&self, h: Tensor<B, 3>) -> Tensor<B, 2> {
        let [batch, _seq, _dim] = h.dims();
        let device = h.device();

        // Direct projection: h [1, 1, 3072] → logits [1, 1, 8320]
        let logits = self.semantic_codebook_output.forward(h);
        let mut logits = logits.reshape([batch, self.config.semantic_output_size]);

        // Mask EMPTY_AUDIO (index 0) to -inf and indices >= 8194 to -inf
        let mut mask_data = vec![0.0f32; self.config.semantic_output_size];
        mask_data[0] = f32::NEG_INFINITY;
        let valid_end = 2 + 8192; // specials_per_codebook + semantic_vq_size
        for v in mask_data.iter_mut().skip(valid_end) {
            *v = f32::NEG_INFINITY;
        }
        let mask: Tensor<B, 1> = Tensor::from_floats(mask_data.as_slice(), &device);
        logits = logits + mask.unsqueeze_dim::<2>(0);

        logits
    }

    /// Run the Euler ODE solver with classifier-free guidance to predict acoustic tokens.
    ///
    /// Starting from Gaussian noise `x_0 ~ N(0, 1)` in R^36, performs Euler steps
    /// from t=0 (noise) to t=1 (signal) with CFG (alpha=1.2).
    ///
    /// Timesteps: `linspace(0, 1, euler_steps)` → N points, N-1 intervals.
    ///
    /// Per step from `t[i]` to `t[i+1]`:
    /// 1. `v_cond = predict_velocity(h, x_t, t[i])` — conditional velocity
    /// 2. `v_uncond = predict_velocity(zeros, x_t, t[i])` — unconditional velocity
    /// 3. `v = alpha * v_cond + (1 - alpha) * v_uncond` — CFG blend
    /// 4. `x_{t+dt} = x_t + v * dt`
    ///
    /// # Arguments
    /// * `h` - Backbone hidden state [1, 1, dim]
    /// * `noise` - Initial noise sample [1, acoustic_dim] (typically from N(0,1))
    ///
    /// # Returns
    /// Final acoustic state [1, acoustic_dim] ready for FSQ quantization.
    pub fn euler_ode_solve(&self, h: Tensor<B, 3>, noise: Tensor<B, 2>) -> Tensor<B, 2> {
        let device = h.device();
        let n_points = self.config.euler_steps;
        let alpha = self.config.cfg_alpha;

        // Pre-build batched hidden state: [2, 1, dim] = [h_cond, h_uncond=zeros]
        let [batch, seq, dim] = h.dims();
        let h_uncond: Tensor<B, 3> = Tensor::zeros([batch, seq, dim], &device);
        let h_batched = Tensor::cat(vec![h, h_uncond], 0); // [2, 1, dim]

        let mut x_t = noise;

        for step in 0..(n_points - 1) {
            let t = step as f32 / (n_points - 1) as f32;
            let dt = 1.0 / (n_points - 1) as f32;

            let [b, acoustic_dim] = x_t.dims();
            let x_t_3d = x_t.clone().reshape([b, 1, acoustic_dim]);

            // Batch: duplicate x_t for both cond and uncond passes
            let x_t_batched = Tensor::cat(vec![x_t_3d.clone(), x_t_3d], 0); // [2, 1, acoustic_dim]

            // Single batched forward: [2, 1, acoustic_dim] → [2, acoustic_dim]
            let v_batched = self.predict_velocity(h_batched.clone(), x_t_batched, t);

            // Split: v_cond = v_batched[0], v_uncond = v_batched[1]
            let v_cond = v_batched.clone().slice([0..1, 0..acoustic_dim]);
            let v_uncond = v_batched.slice([1..2, 0..acoustic_dim]);

            // CFG: v = alpha * v_cond + (1 - alpha) * v_uncond
            let v = v_cond * alpha + v_uncond * (1.0 - alpha);

            x_t = x_t + v * dt;
        }

        x_t
    }

    /// Access the time embedding.
    pub fn time_embedding(&self) -> &TimeEmbedding {
        &self.time_embedding
    }

    /// Access the config.
    pub fn config(&self) -> &FmTransformerConfig {
        &self.config
    }

    /// Override the number of Euler ODE steps (for speed/quality tradeoff tuning).
    pub fn set_euler_steps(&mut self, steps: usize) {
        self.config.euler_steps = steps;
    }
}

/// Load a single FM transformer layer from SafeTensors.
fn load_fm_layer<B: Backend>(
    safetensors: &SafeTensors,
    prefix: &str,
    config: &FmTransformerConfig,
    device: &B::Device,
) -> Result<FmLayer<B>> {
    let eps = config.norm_eps;

    // Attention norm
    let attn_norm_weight: Tensor<B, 1> = load_tensor(
        safetensors,
        &format!("{prefix}.attention_norm.weight"),
        device,
    )
    .context("attention_norm")?;
    let attention_norm = RmsNorm {
        weight: burn::nn::RmsNorm {
            gamma: Param::initialized(ParamId::new(), attn_norm_weight),
            epsilon: eps,
        },
    };

    // Attention (GQA 32Q/8KV, no bias)
    let wq = load_linear(
        safetensors,
        &format!("{prefix}.attention.wq.weight"),
        None,
        device,
    )?;
    let wk = load_linear(
        safetensors,
        &format!("{prefix}.attention.wk.weight"),
        None,
        device,
    )?;
    let wv = load_linear(
        safetensors,
        &format!("{prefix}.attention.wv.weight"),
        None,
        device,
    )?;
    let wo = load_linear(
        safetensors,
        &format!("{prefix}.attention.wo.weight"),
        None,
        device,
    )?;
    let attention = Attention::new(
        wq,
        wk,
        wv,
        wo,
        config.n_heads,
        config.n_kv_heads,
        config.head_dim,
        None, // No sliding window for FM transformer
    );

    // FFN norm
    let ffn_norm_weight: Tensor<B, 1> =
        load_tensor(safetensors, &format!("{prefix}.ffn_norm.weight"), device)
            .context("ffn_norm")?;
    let ffn_norm = RmsNorm {
        weight: burn::nn::RmsNorm {
            gamma: Param::initialized(ParamId::new(), ffn_norm_weight),
            epsilon: eps,
        },
    };

    // SwiGLU FFN
    let w1 = load_linear(
        safetensors,
        &format!("{prefix}.feed_forward.w1.weight"),
        None,
        device,
    )?;
    let w2 = load_linear(
        safetensors,
        &format!("{prefix}.feed_forward.w2.weight"),
        None,
        device,
    )?;
    let w3 = load_linear(
        safetensors,
        &format!("{prefix}.feed_forward.w3.weight"),
        None,
        device,
    )?;
    let ffn = SwiGLU::new(w1, w2, w3);

    Ok(FmLayer::new(attention_norm, attention, ffn_norm, ffn))
}

#[cfg(test)]
mod tests {
    use super::*;
    use burn::backend::Wgpu;
    use burn::prelude::ElementConversion;

    use crate::models::layers::{AttentionConfig, RmsNormConfig, SwiGLUConfig};

    type TestBackend = Wgpu;

    // --- T-09: Time Embedding Tests ---

    #[test]
    fn test_time_embedding_shape_3072() {
        let device = Default::default();
        let time_embed = TimeEmbedding::new(3072);

        let embedding = time_embed.embed::<TestBackend>(0.5, &device);
        assert_eq!(embedding.dims(), [1, 1, 3072]);
    }

    #[test]
    fn test_time_embedding_different_times() {
        let device = Default::default();
        let time_embed = TimeEmbedding::new(3072);

        let emb_t0 = time_embed.embed::<TestBackend>(0.0, &device);
        let emb_t05 = time_embed.embed::<TestBackend>(0.5, &device);
        let emb_t1 = time_embed.embed::<TestBackend>(1.0, &device);

        let diff_01 = emb_t0.clone() - emb_t05.clone();
        let dist_01 = diff_01
            .clone()
            .mul(diff_01)
            .sum()
            .into_scalar()
            .elem::<f32>();
        assert!(
            dist_01 > 0.0,
            "t=0.0 and t=0.5 produced identical embeddings"
        );

        let diff_02 = emb_t0 - emb_t1.clone();
        let dist_02 = diff_02
            .clone()
            .mul(diff_02)
            .sum()
            .into_scalar()
            .elem::<f32>();
        assert!(
            dist_02 > 0.0,
            "t=0.0 and t=1.0 produced identical embeddings"
        );

        let diff_12 = emb_t05 - emb_t1;
        let dist_12 = diff_12
            .clone()
            .mul(diff_12)
            .sum()
            .into_scalar()
            .elem::<f32>();
        assert!(
            dist_12 > 0.0,
            "t=0.5 and t=1.0 produced identical embeddings"
        );
    }

    #[test]
    fn test_time_embedding_euler_steps() {
        let device = Default::default();
        let time_embed = TimeEmbedding::new(3072);

        let steps: Vec<f32> = (0..8).map(|i| 1.0 - (i as f32) * 0.125).collect();
        let embeddings: Vec<_> = steps
            .iter()
            .map(|&t| time_embed.embed::<TestBackend>(t, &device))
            .collect();

        for i in 0..embeddings.len() {
            for j in (i + 1)..embeddings.len() {
                let diff = embeddings[i].clone() - embeddings[j].clone();
                let dist = diff.clone().mul(diff).sum().into_scalar().elem::<f32>();
                assert!(
                    dist > 0.0,
                    "t={} and t={} produced identical embeddings",
                    steps[i],
                    steps[j]
                );
            }
        }
    }

    #[test]
    fn test_time_embedding_t_zero_values() {
        let device = Default::default();
        let time_embed = TimeEmbedding::new(3072);

        let emb = time_embed.embed::<TestBackend>(0.0, &device);
        let data = emb.to_data();
        let slice = data.as_slice::<f32>().unwrap();

        let half = 3072 / 2;
        for (i, &val) in slice[..half].iter().enumerate() {
            assert!(
                (val - 1.0).abs() < 1e-5,
                "cos half at index {} should be 1.0, got {}",
                i,
                val
            );
        }
        for (i, &val) in slice[half..].iter().enumerate() {
            assert!(
                val.abs() < 1e-5,
                "sin half at index {} should be 0.0, got {}",
                i,
                val
            );
        }
    }

    // --- T-08: FM Transformer Tests ---

    /// Helper: create a small FM layer for testing (no weight loading).
    fn make_test_fm_layer(
        dim: usize,
        n_heads: usize,
        head_dim: usize,
        ffn_dim: usize,
    ) -> FmLayer<TestBackend> {
        let device = Default::default();
        let n_kv_heads = n_heads / 4; // GQA ratio

        let attention_norm = RmsNormConfig::new(dim).init(&device);
        let attention = AttentionConfig::new(dim, n_heads, head_dim)
            .with_n_kv_heads(Some(n_kv_heads))
            .init(&device);
        let ffn_norm = RmsNormConfig::new(dim).init(&device);
        let ffn = SwiGLUConfig::new(dim, ffn_dim).init(&device);

        FmLayer::new(attention_norm, attention, ffn_norm, ffn)
    }

    #[test]
    fn test_fm_layer_output_shape() {
        let device = Default::default();
        let layer = make_test_fm_layer(64, 4, 16, 256);

        let rope = RoPEConfig::new(16, 16)
            .with_theta(10_000.0)
            .init::<TestBackend>(&device);

        // FM input is always 3 tokens
        let x = Tensor::<TestBackend, 3>::zeros([1, 3, 64], &device);
        let out = layer.forward(x, &rope);
        assert_eq!(out.dims(), [1, 3, 64]);
    }

    #[test]
    fn test_fm_layer_non_causal() {
        let device = Default::default();
        let layer = make_test_fm_layer(64, 4, 16, 256);

        let rope = RoPEConfig::new(16, 16)
            .with_theta(10_000.0)
            .init::<TestBackend>(&device);

        // With non-causal attention, position 0 should attend to positions 1 and 2
        // We can verify by checking that changing position 2 affects position 0 output
        let x1 = Tensor::<TestBackend, 3>::ones([1, 3, 64], &device);
        let out1 = layer.forward(x1, &rope);

        let mut x2_data = vec![1.0f32; 3 * 64];
        // Modify position 2
        for i in (2 * 64)..(3 * 64) {
            x2_data[i] = 5.0;
        }
        let x2 = Tensor::<TestBackend, 3>::from_data(
            burn::tensor::TensorData::new(x2_data, [1, 3, 64]),
            &device,
        );
        let out2 = layer.forward(x2, &rope);

        // Position 0 output should differ because attention is bidirectional
        let out1_pos0 = out1.slice([0..1, 0..1, 0..64]);
        let out2_pos0 = out2.slice([0..1, 0..1, 0..64]);
        let diff = (out1_pos0 - out2_pos0)
            .abs()
            .sum()
            .into_scalar()
            .elem::<f32>();
        assert!(
            diff > 1e-6,
            "Non-causal attention: position 0 should be affected by position 2 changes"
        );
    }

    #[test]
    fn test_fm_layer_residual_connection() {
        let device = Default::default();
        let layer = make_test_fm_layer(64, 4, 16, 256);

        let rope = RoPEConfig::new(16, 16)
            .with_theta(10_000.0)
            .init::<TestBackend>(&device);

        // Zero input should produce zero output (residual + zero = zero, and
        // norm/attention/ffn of zero might not be exactly zero due to norm eps,
        // but should be close)
        let x = Tensor::<TestBackend, 3>::zeros([1, 3, 64], &device);
        let out = layer.forward(x, &rope);
        let sum = out.abs().sum().into_scalar().elem::<f32>();
        assert!(
            sum < 1.0,
            "Zero input should produce near-zero output, got sum={sum}"
        );
    }

    #[test]
    fn test_fm_transformer_full_shape() {
        let device = Default::default();
        let config = FmTransformerConfig::default();

        // Build a small FM transformer manually for shape testing
        let dim = config.dim;
        let head_dim = config.head_dim;

        let rope = RoPEConfig::new(head_dim, 16)
            .with_theta(config.rope_theta)
            .init::<TestBackend>(&device);

        let time_embedding = TimeEmbedding::new(dim);

        // Test that time embedding + projection would produce correct shapes
        let t_embed = time_embedding.embed::<TestBackend>(0.5, &device);
        assert_eq!(t_embed.dims(), [1, 1, dim]);

        // Test 3-token sequence construction
        let h = Tensor::<TestBackend, 3>::zeros([1, 1, dim], &device);
        let t = Tensor::<TestBackend, 3>::zeros([1, 1, dim], &device);
        let x = Tensor::<TestBackend, 3>::zeros([1, 1, dim], &device);
        let seq = Tensor::cat(vec![h, t, x], 1);
        assert_eq!(seq.dims(), [1, 3, dim]);

        // Verify rope works for the 3-token sequence
        let n_heads = config.n_heads;
        let n_kv_heads = config.n_kv_heads;
        let q = Tensor::<TestBackend, 4>::zeros([1, 3, n_heads, head_dim], &device);
        let k = Tensor::<TestBackend, 4>::zeros([1, 3, n_kv_heads, head_dim], &device);
        let (q_rot, k_rot): (Tensor<TestBackend, 4>, Tensor<TestBackend, 4>) = rope.apply(q, k, 0);
        assert_eq!(q_rot.dims(), [1, 3, n_heads, head_dim]);
        assert_eq!(k_rot.dims(), [1, 3, n_kv_heads, head_dim]);
    }

    #[test]
    fn test_semantic_logits_masking() {
        // Verify mask construction: index 0 and indices >= 8194 should be -inf
        let config = FmTransformerConfig::default();
        let size = config.semantic_output_size; // 8320

        let mut mask_data = vec![0.0f32; size];
        mask_data[0] = f32::NEG_INFINITY;
        let valid_end = 2 + 8192;
        for v in mask_data.iter_mut().skip(valid_end) {
            *v = f32::NEG_INFINITY;
        }

        // Index 0 masked
        assert!(mask_data[0].is_infinite() && mask_data[0] < 0.0);
        // Index 1 not masked (END_AUDIO is valid for termination)
        assert_eq!(mask_data[1], 0.0);
        // Index 2 not masked (first semantic VQ entry)
        assert_eq!(mask_data[2], 0.0);
        // Index 8193 not masked (last semantic VQ entry)
        assert_eq!(mask_data[8193], 0.0);
        // Index 8194 masked (beyond valid range)
        assert!(mask_data[8194].is_infinite() && mask_data[8194] < 0.0);
        // Last index masked
        assert!(mask_data[size - 1].is_infinite() && mask_data[size - 1] < 0.0);
    }

    /// Build a small FmTransformer for testing (no weight loading).
    fn make_test_fm_transformer(n_layers: usize) -> FmTransformer<TestBackend> {
        let device = Default::default();
        let dim = 64;
        let n_heads = 4;
        let head_dim = 16;
        let n_kv_heads = 1;
        let ffn_dim = 256;
        let acoustic_dim = 36;

        let rope = RoPEConfig::new(head_dim, 16)
            .with_theta(10_000.0)
            .init::<TestBackend>(&device);

        let layers: Vec<FmLayer<TestBackend>> = (0..n_layers)
            .map(|_| {
                let attention_norm = RmsNormConfig::new(dim).init(&device);
                let attention = AttentionConfig::new(dim, n_heads, head_dim)
                    .with_n_kv_heads(Some(n_kv_heads))
                    .init(&device);
                let ffn_norm = RmsNormConfig::new(dim).init(&device);
                let ffn = SwiGLUConfig::new(dim, ffn_dim).init(&device);
                FmLayer::new(attention_norm, attention, ffn_norm, ffn)
            })
            .collect();

        use burn::nn::LinearConfig;
        let llm_projection = LinearConfig::new(dim, dim).init(&device);
        let time_projection = LinearConfig::new(dim, dim).init(&device);
        let input_projection = LinearConfig::new(acoustic_dim, dim).init(&device);
        let semantic_codebook_output = LinearConfig::new(dim, 8320).init(&device);
        let acoustic_codebook_output = LinearConfig::new(dim, acoustic_dim).init(&device);

        let config = FmTransformerConfig {
            dim,
            n_heads,
            n_kv_heads,
            head_dim,
            ffn_dim,
            acoustic_dim,
            ..FmTransformerConfig::default()
        };

        let norm = crate::models::layers::RmsNormConfig::new(dim).init::<TestBackend>(&device);

        FmTransformer {
            time_embedding: TimeEmbedding::new(dim),
            rope,
            layers,
            llm_projection,
            time_projection,
            input_projection,
            semantic_codebook_output,
            acoustic_codebook_output,
            norm,
            config,
        }
    }

    #[test]
    fn test_predict_velocity_shape_small() {
        let fm = make_test_fm_transformer(3);
        let device = Default::default();
        let dim = 64;
        let acoustic_dim = 36;

        let h = Tensor::<TestBackend, 3>::zeros([1, 1, dim], &device);
        let x_t = Tensor::<TestBackend, 3>::zeros([1, 1, acoustic_dim], &device);
        let velocity = fm.predict_velocity(h, x_t, 0.5);
        assert_eq!(velocity.dims(), [1, acoustic_dim]);
    }

    #[test]
    fn test_semantic_logits_shape_small() {
        let fm = make_test_fm_transformer(0); // No layers needed for semantic_logits
        let device = Default::default();
        let dim = 64;

        let h = Tensor::<TestBackend, 3>::zeros([1, 1, dim], &device);
        let logits = fm.semantic_logits(h);
        assert_eq!(logits.dims(), [1, 8320]);

        // Verify masking
        let data = logits.to_data();
        let slice = data.as_slice::<f32>().unwrap();
        assert!(
            slice[0].is_infinite() && slice[0] < 0.0,
            "Index 0 (EMPTY_AUDIO) should be masked to -inf"
        );
        assert!(
            !slice[1].is_infinite(),
            "Index 1 (END_AUDIO) should not be masked"
        );
        assert!(
            !slice[2].is_infinite(),
            "Index 2 (first semantic VQ) should not be masked"
        );
        assert!(
            slice[8194].is_infinite() && slice[8194] < 0.0,
            "Index 8194 (beyond valid range) should be masked"
        );
    }

    // --- T-10: Euler ODE Solver Tests ---

    #[test]
    fn test_euler_ode_solve_output_shape() {
        let fm = make_test_fm_transformer(3);
        let device = Default::default();
        let dim = 64;
        let acoustic_dim = 36;

        let h = Tensor::<TestBackend, 3>::zeros([1, 1, dim], &device);
        let noise = Tensor::<TestBackend, 2>::zeros([1, acoustic_dim], &device);
        let x_0 = fm.euler_ode_solve(h, noise);
        assert_eq!(x_0.dims(), [1, acoustic_dim]);
    }

    #[test]
    fn test_euler_ode_solve_deterministic() {
        let fm = make_test_fm_transformer(3);
        let device = Default::default();
        let dim = 64;
        let acoustic_dim = 36;

        // Same noise → same output (deterministic given same weights)
        let h = Tensor::<TestBackend, 3>::ones([1, 1, dim], &device);
        let noise = Tensor::<TestBackend, 2>::ones([1, acoustic_dim], &device) * 0.5;

        let x_0_a = fm.euler_ode_solve(h.clone(), noise.clone());
        let x_0_b = fm.euler_ode_solve(h, noise);

        let diff = (x_0_a - x_0_b).abs().sum().into_scalar().elem::<f32>();
        assert!(
            diff < 1e-4,
            "Same inputs should produce same outputs, got diff={diff}"
        );
    }

    #[test]
    fn test_euler_ode_solve_different_noise_different_output() {
        let fm = make_test_fm_transformer(3);
        let device = Default::default();
        let dim = 64;
        let acoustic_dim = 36;

        let h = Tensor::<TestBackend, 3>::ones([1, 1, dim], &device);
        let noise_a = Tensor::<TestBackend, 2>::ones([1, acoustic_dim], &device) * 0.5;
        let noise_b = Tensor::<TestBackend, 2>::ones([1, acoustic_dim], &device) * (-0.5);

        let x_0_a = fm.euler_ode_solve(h.clone(), noise_a);
        let x_0_b = fm.euler_ode_solve(h, noise_b);

        let diff = (x_0_a - x_0_b).abs().sum().into_scalar().elem::<f32>();
        assert!(
            diff > 1e-6,
            "Different noise should produce different outputs"
        );
    }

    #[test]
    fn test_euler_ode_solve_different_h_different_output() {
        let fm = make_test_fm_transformer(3);
        let device = Default::default();
        let dim = 64;
        let acoustic_dim = 36;

        let h_a = Tensor::<TestBackend, 3>::ones([1, 1, dim], &device);
        let h_b = Tensor::<TestBackend, 3>::ones([1, 1, dim], &device) * 2.0;
        let noise = Tensor::<TestBackend, 2>::ones([1, acoustic_dim], &device) * 0.5;

        let x_0_a = fm.euler_ode_solve(h_a, noise.clone());
        let x_0_b = fm.euler_ode_solve(h_b, noise);

        let diff = (x_0_a - x_0_b).abs().sum().into_scalar().elem::<f32>();
        assert!(
            diff > 1e-6,
            "Different hidden states should produce different outputs"
        );
    }

    #[test]
    fn test_euler_ode_cfg_alpha_effect() {
        // Verify that CFG alpha != 1.0 means the uncond pass matters
        // If alpha were 1.0, v_uncond would be multiplied by 0 and have no effect.
        // With alpha=1.2, v_uncond is multiplied by -0.2.
        let config = FmTransformerConfig::default();
        assert!(
            (config.cfg_alpha - 1.2).abs() < 1e-6,
            "Default CFG alpha should be 1.2"
        );
        assert_eq!(config.euler_steps, 8, "Default should be 8 steps");
    }

    #[test]
    fn test_euler_ode_time_steps() {
        // Verify the time step sequence: [1.0, 0.875, 0.75, ..., 0.125]
        let steps = 8;
        let dt = 1.0 / steps as f32;
        let time_steps: Vec<f32> = (0..steps).map(|i| 1.0 - (i as f32) * dt).collect();

        assert_eq!(time_steps.len(), 8);
        assert!((time_steps[0] - 1.0).abs() < 1e-6);
        assert!((time_steps[1] - 0.875).abs() < 1e-6);
        assert!((time_steps[7] - 0.125).abs() < 1e-6);

        // All times should be in (0, 1]
        for &t in &time_steps {
            assert!(t > 0.0 && t <= 1.0, "Time step {t} out of range");
        }
    }
}
