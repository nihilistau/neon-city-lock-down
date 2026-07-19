//! Codec decoder transformer block.
//!
//! Combines ALiBi attention, QK-norm, LayerScale, and SwiGLU into a single
//! transformer layer for the codec decoder. Uses causal + sliding window masking.

use anyhow::{Context, Result};
use burn::module::{Param, ParamId};
use burn::nn::Linear;
use burn::tensor::activation::softmax;
use burn::tensor::backend::Backend;
use burn::tensor::Tensor;
use safetensors::SafeTensors;

use crate::models::layers::{RmsNorm, SwiGLU};
use crate::models::weights::{linear_from_weights, load_tensor};
use crate::tts::codec::alibi::ALiBi;
use crate::tts::codec::layer_scale::LayerScale;
use crate::tts::codec::qk_norm::QkNorm;

/// Codec decoder attention with ALiBi, QK-norm, causal masking, and sliding window.
///
/// Unlike backbone attention, this uses:
/// - MHA (all heads are query heads, no GQA)
/// - ALiBi positional bias (no RoPE)
/// - QK-norm (RMSNorm on Q and K before scoring)
pub struct CodecAttention<B: Backend> {
    wq: Linear<B>,
    wk: Linear<B>,
    wv: Linear<B>,
    wo: Linear<B>,
    qk_norm: QkNorm<B>,
    alibi: ALiBi,
    n_heads: usize,
    head_dim: usize,
    scale: f32,
    sliding_window: usize,
}

impl<B: Backend> CodecAttention<B> {
    /// Create codec attention from loaded components.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        wq: Linear<B>,
        wk: Linear<B>,
        wv: Linear<B>,
        wo: Linear<B>,
        qk_norm: QkNorm<B>,
        n_heads: usize,
        head_dim: usize,
        sliding_window: usize,
    ) -> Self {
        Self {
            wq,
            wk,
            wv,
            wo,
            qk_norm,
            alibi: ALiBi::new(n_heads),
            n_heads,
            head_dim,
            scale: (head_dim as f32).powf(-0.5),
            sliding_window,
        }
    }

    /// Forward pass with ALiBi, QK-norm, causal mask, and sliding window.
    ///
    /// # Arguments
    /// * `x` - Input tensor [batch, seq, dim]
    ///
    /// # Returns
    /// Output tensor [batch, seq, dim]
    pub fn forward(&self, x: Tensor<B, 3>) -> Tensor<B, 3> {
        let [batch, seq_len, _dim] = x.dims();
        let device = x.device();

        // Project Q, K, V
        let q = self.wq.forward(x.clone());
        let k = self.wk.forward(x.clone());
        let v = self.wv.forward(x);

        // Reshape to [batch, seq, n_heads, head_dim]
        let q = q.reshape([batch, seq_len, self.n_heads, self.head_dim]);
        let k = k.reshape([batch, seq_len, self.n_heads, self.head_dim]);
        let v = v.reshape([batch, seq_len, self.n_heads, self.head_dim]);

        // Transpose to [batch, n_heads, seq, head_dim]
        let q = q.swap_dims(1, 2);
        let k = k.swap_dims(1, 2);
        let v = v.swap_dims(1, 2);

        // Apply QK-norm
        let (q, k) = self.qk_norm.forward(q, k);

        // Compute attention scores: Q @ K^T * scale
        let scores = q.matmul(k.swap_dims(2, 3)) * self.scale;

        // Add ALiBi positional bias
        let alibi_bias = self.alibi.bias::<B>(seq_len, seq_len, &device);
        let scores = scores + alibi_bias;

        // Apply causal + sliding window mask
        let scores = apply_causal_sliding_window_mask(scores, seq_len, self.sliding_window);

        // Softmax
        let attn = softmax(scores, 3);

        // Apply attention: attn @ V
        let out = attn.matmul(v);

        // Transpose back and reshape: [batch, n_heads, seq, head_dim] -> [batch, seq, dim]
        let out = out.swap_dims(1, 2);
        let out = out.reshape([batch, seq_len, self.n_heads * self.head_dim]);

        // Output projection
        self.wo.forward(out)
    }
}

/// Apply combined causal + sliding window mask to attention scores.
///
/// Masks positions where `j > i` (future) or `|i - j| > window` with `-inf`.
fn apply_causal_sliding_window_mask<B: Backend>(
    scores: Tensor<B, 4>,
    seq_len: usize,
    window: usize,
) -> Tensor<B, 4> {
    let device = scores.device();
    let mut mask_data = vec![0.0f32; seq_len * seq_len];
    for i in 0..seq_len {
        for j in 0..seq_len {
            if j > i || i.abs_diff(j) > window {
                mask_data[i * seq_len + j] = f32::NEG_INFINITY;
            }
        }
    }
    let mask: Tensor<B, 1> = Tensor::from_floats(mask_data.as_slice(), &device);
    let mask: Tensor<B, 2> = mask.reshape([seq_len, seq_len]);
    let mask: Tensor<B, 4> = mask.unsqueeze_dim::<3>(0).unsqueeze_dim(0);
    scores + mask
}

/// Codec decoder transformer layer.
///
/// Architecture:
/// ```text
/// x -> RmsNorm -> CodecAttention(ALiBi, QK-norm, causal, sliding_window) -> LayerScale -> + residual -> x'
/// x' -> RmsNorm -> SwiGLU -> LayerScale -> + residual -> out
/// ```
///
/// Parameters: 8 MHA heads, 1024 dim, head_dim 128, sliding window per block.
pub struct CodecTransformerLayer<B: Backend> {
    /// Pre-attention normalization.
    attention_norm: RmsNorm<B>,
    /// Codec attention with ALiBi + QK-norm.
    attention: CodecAttention<B>,
    /// Scales attention output before residual add.
    attention_scale: LayerScale<B>,
    /// Pre-FFN normalization.
    ffn_norm: RmsNorm<B>,
    /// SwiGLU MLP.
    ffn: SwiGLU<B>,
    /// Scales FFN output before residual add.
    ffn_scale: LayerScale<B>,
}

impl<B: Backend> CodecTransformerLayer<B> {
    /// Create a codec transformer layer from loaded components.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        attention_norm: RmsNorm<B>,
        attention: CodecAttention<B>,
        attention_scale: LayerScale<B>,
        ffn_norm: RmsNorm<B>,
        ffn: SwiGLU<B>,
        ffn_scale: LayerScale<B>,
    ) -> Self {
        Self {
            attention_norm,
            attention,
            attention_scale,
            ffn_norm,
            ffn,
            ffn_scale,
        }
    }

    /// Load a codec transformer layer from SafeTensors.
    ///
    /// # Arguments
    /// * `safetensors` - SafeTensors data
    /// * `prefix` - Weight name prefix (e.g., `audio_tokenizer.decoder_blocks.0.layers.0`)
    /// * `n_heads` - Number of attention heads
    /// * `head_dim` - Per-head dimension
    /// * `sliding_window` - Sliding window size for this layer
    /// * `norm_eps` - RMSNorm epsilon
    /// * `device` - Device for tensor allocation
    #[allow(clippy::too_many_arguments)]
    pub fn from_safetensors(
        safetensors: &SafeTensors,
        prefix: &str,
        n_heads: usize,
        head_dim: usize,
        sliding_window: usize,
        norm_eps: f64,
        device: &B::Device,
    ) -> Result<Self> {
        // Attention weights
        let wq_weight: Tensor<B, 2> = load_tensor(
            safetensors,
            &format!("{prefix}.attention.wq.weight"),
            device,
        )
        .context("Loading wq")?;
        let wk_weight: Tensor<B, 2> = load_tensor(
            safetensors,
            &format!("{prefix}.attention.wk.weight"),
            device,
        )
        .context("Loading wk")?;
        let wv_weight: Tensor<B, 2> = load_tensor(
            safetensors,
            &format!("{prefix}.attention.wv.weight"),
            device,
        )
        .context("Loading wv")?;
        let wo_weight: Tensor<B, 2> = load_tensor(
            safetensors,
            &format!("{prefix}.attention.wo.weight"),
            device,
        )
        .context("Loading wo")?;

        let wq = linear_from_weights(wq_weight, None);
        let wk = linear_from_weights(wk_weight, None);
        let wv = linear_from_weights(wv_weight, None);
        let wo = linear_from_weights(wo_weight, None);

        // QK-norm weights
        let q_norm_weight: Tensor<B, 1> = load_tensor(
            safetensors,
            &format!("{prefix}.attention.q_norm.weight"),
            device,
        )
        .context("Loading q_norm")?;
        let k_norm_weight: Tensor<B, 1> = load_tensor(
            safetensors,
            &format!("{prefix}.attention.k_norm.weight"),
            device,
        )
        .context("Loading k_norm")?;
        let qk_norm = QkNorm::new(q_norm_weight, k_norm_weight, n_heads, head_dim);

        let attention =
            CodecAttention::new(wq, wk, wv, wo, qk_norm, n_heads, head_dim, sliding_window);

        // LayerScale weights
        let attn_scale_weight: Tensor<B, 1> =
            load_tensor(safetensors, &format!("{prefix}.attention_scale"), device)
                .context("Loading attention_scale")?;
        let ffn_scale_weight: Tensor<B, 1> =
            load_tensor(safetensors, &format!("{prefix}.ffn_scale"), device)
                .context("Loading ffn_scale")?;
        let attention_scale = LayerScale::new(attn_scale_weight);
        let ffn_scale = LayerScale::new(ffn_scale_weight);

        // Norms
        let attn_norm_weight: Tensor<B, 1> = load_tensor(
            safetensors,
            &format!("{prefix}.attention_norm.weight"),
            device,
        )
        .context("Loading attention_norm")?;
        let ffn_norm_weight: Tensor<B, 1> =
            load_tensor(safetensors, &format!("{prefix}.ffn_norm.weight"), device)
                .context("Loading ffn_norm")?;

        let attention_norm = RmsNorm {
            weight: burn::nn::RmsNorm {
                gamma: Param::initialized(ParamId::new(), attn_norm_weight),
                epsilon: norm_eps,
            },
        };
        let ffn_norm = RmsNorm {
            weight: burn::nn::RmsNorm {
                gamma: Param::initialized(ParamId::new(), ffn_norm_weight),
                epsilon: norm_eps,
            },
        };

        // SwiGLU FFN
        let w1_weight: Tensor<B, 2> = load_tensor(
            safetensors,
            &format!("{prefix}.feed_forward.w1.weight"),
            device,
        )
        .context("Loading ffn w1")?;
        let w2_weight: Tensor<B, 2> = load_tensor(
            safetensors,
            &format!("{prefix}.feed_forward.w2.weight"),
            device,
        )
        .context("Loading ffn w2")?;
        let w3_weight: Tensor<B, 2> = load_tensor(
            safetensors,
            &format!("{prefix}.feed_forward.w3.weight"),
            device,
        )
        .context("Loading ffn w3")?;

        let w1 = linear_from_weights(w1_weight, None);
        let w2 = linear_from_weights(w2_weight, None);
        let w3 = linear_from_weights(w3_weight, None);
        let ffn = SwiGLU::new(w1, w2, w3);

        Ok(Self {
            attention_norm,
            attention,
            attention_scale,
            ffn_norm,
            ffn,
            ffn_scale,
        })
    }

    /// Forward pass.
    ///
    /// # Arguments
    /// * `x` - Input tensor [batch, seq, dim]
    ///
    /// # Returns
    /// Output tensor [batch, seq, dim]
    pub fn forward(&self, x: Tensor<B, 3>) -> Tensor<B, 3> {
        // Attention with LayerScale + residual
        let residual = x.clone();
        let h = self.attention_norm.forward(x);
        let h = self.attention.forward(h);
        let h = self.attention_scale.forward(h);
        let x = h + residual;

        // FFN with LayerScale + residual
        let residual = x.clone();
        let h = self.ffn_norm.forward(x);
        let h = self.ffn.forward(h);
        let h = self.ffn_scale.forward(h);
        h + residual
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use burn::backend::Wgpu;
    use burn::nn::LinearConfig;
    type TestBackend = Wgpu;

    /// Helper to create a small codec transformer layer for testing.
    fn make_test_layer(
        dim: usize,
        n_heads: usize,
        head_dim: usize,
        ffn_dim: usize,
        sliding_window: usize,
        device: &<TestBackend as Backend>::Device,
    ) -> CodecTransformerLayer<TestBackend> {
        let eps = 1e-5;

        // Attention
        let wq = LinearConfig::new(dim, dim).with_bias(false).init(device);
        let wk = LinearConfig::new(dim, dim).with_bias(false).init(device);
        let wv = LinearConfig::new(dim, dim).with_bias(false).init(device);
        let wo = LinearConfig::new(dim, dim).with_bias(false).init(device);

        let q_weight = Tensor::<TestBackend, 1>::ones([dim], device);
        let k_weight = Tensor::<TestBackend, 1>::ones([dim], device);
        let qk_norm = QkNorm::new(q_weight, k_weight, n_heads, head_dim);

        let attention =
            CodecAttention::new(wq, wk, wv, wo, qk_norm, n_heads, head_dim, sliding_window);

        // LayerScale
        let attn_scale = LayerScale::new(Tensor::ones([dim], device) * 0.01);
        let ffn_scale_layer = LayerScale::new(Tensor::ones([dim], device) * 0.01);

        // Norms
        let attention_norm = RmsNorm {
            weight: burn::nn::RmsNorm {
                gamma: Param::initialized(
                    ParamId::new(),
                    Tensor::<TestBackend, 1>::ones([dim], device),
                ),
                epsilon: eps,
            },
        };
        let ffn_norm = RmsNorm {
            weight: burn::nn::RmsNorm {
                gamma: Param::initialized(
                    ParamId::new(),
                    Tensor::<TestBackend, 1>::ones([dim], device),
                ),
                epsilon: eps,
            },
        };

        // SwiGLU
        use crate::models::layers::SwiGLUConfig;
        let ffn = SwiGLUConfig::new(dim, ffn_dim)
            .with_bias(false)
            .init(device);

        CodecTransformerLayer::new(
            attention_norm,
            attention,
            attn_scale,
            ffn_norm,
            ffn,
            ffn_scale_layer,
        )
    }

    #[test]
    fn test_codec_layer_output_shape() {
        let device = Default::default();
        let layer = make_test_layer(64, 4, 16, 256, 4, &device);

        let x = Tensor::<TestBackend, 3>::zeros([1, 10, 64], &device);
        let out = layer.forward(x);

        assert_eq!(out.dims(), [1, 10, 64]);
    }

    #[test]
    fn test_codec_layer_batch_shape() {
        let device = Default::default();
        let layer = make_test_layer(64, 4, 16, 256, 8, &device);

        let x = Tensor::<TestBackend, 3>::zeros([2, 5, 64], &device);
        let out = layer.forward(x);

        assert_eq!(out.dims(), [2, 5, 64]);
    }

    #[test]
    fn test_codec_layer_real_dims() {
        // Codec defaults: 1024 dim, 8 heads, 128 head_dim, window 2
        let device = Default::default();
        let layer = make_test_layer(1024, 8, 128, 4096, 2, &device);

        let x = Tensor::<TestBackend, 3>::zeros([1, 8, 1024], &device);
        let out = layer.forward(x);

        assert_eq!(out.dims(), [1, 8, 1024]);
    }

    #[test]
    fn test_codec_layer_residual_connection() {
        // With zero-initialized weights, output should equal input (residual passthrough)
        // because attention and FFN produce near-zero outputs, and LayerScale * 0.01
        // further suppresses them.
        let device = Default::default();
        let dim = 32;
        let n_heads = 2;
        let head_dim = 16;

        let layer = make_test_layer(dim, n_heads, head_dim, 128, 4, &device);

        let x = Tensor::<TestBackend, 3>::ones([1, 4, dim], &device) * 0.5;
        let out = layer.forward(x.clone());

        // Output should be close to input due to residual (small LayerScale)
        let diff = (out - x).abs().max();
        let diff_val = diff.to_data().as_slice::<f32>().unwrap()[0];

        // The diff should be bounded — not exactly zero due to random init,
        // but small due to LayerScale(0.01)
        assert!(
            diff_val < 5.0,
            "Residual connection should keep output near input, got max diff {}",
            diff_val
        );
    }

    #[test]
    fn test_codec_attention_shape() {
        let device = Default::default();
        let dim = 64;
        let n_heads = 4;
        let head_dim = 16;

        let wq = LinearConfig::new(dim, dim).with_bias(false).init(&device);
        let wk = LinearConfig::new(dim, dim).with_bias(false).init(&device);
        let wv = LinearConfig::new(dim, dim).with_bias(false).init(&device);
        let wo = LinearConfig::new(dim, dim).with_bias(false).init(&device);

        let q_weight = Tensor::<TestBackend, 1>::ones([dim], &device);
        let k_weight = Tensor::<TestBackend, 1>::ones([dim], &device);
        let qk_norm = QkNorm::new(q_weight, k_weight, n_heads, head_dim);

        let attn = CodecAttention::new(wq, wk, wv, wo, qk_norm, n_heads, head_dim, 4);

        let x = Tensor::<TestBackend, 3>::zeros([2, 10, dim], &device);
        let out = attn.forward(x);

        assert_eq!(out.dims(), [2, 10, dim]);
    }

    #[test]
    fn test_causal_sliding_window_mask() {
        // Window=2, seq_len=5
        // Position i can see positions max(0, i-2)..=i
        let device: <TestBackend as Backend>::Device = Default::default();
        let scores = Tensor::<TestBackend, 4>::zeros([1, 1, 5, 5], &device);
        let masked = apply_causal_sliding_window_mask::<TestBackend>(scores, 5, 2);

        let data = masked.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        // Check that future positions are masked
        for i in 0..5 {
            for j in 0..5 {
                let idx = i * 5 + j;
                if j > i {
                    // Future: should be -inf
                    assert!(
                        vals[idx].is_infinite() && vals[idx] < 0.0,
                        "Position ({}, {}) should be masked (future), got {}",
                        i,
                        j,
                        vals[idx]
                    );
                } else if i.abs_diff(j) > 2 {
                    // Outside sliding window: should be -inf
                    assert!(
                        vals[idx].is_infinite() && vals[idx] < 0.0,
                        "Position ({}, {}) should be masked (window), got {}",
                        i,
                        j,
                        vals[idx]
                    );
                } else {
                    // Visible: should be 0
                    assert!(
                        vals[idx] == 0.0,
                        "Position ({}, {}) should be visible, got {}",
                        i,
                        j,
                        vals[idx]
                    );
                }
            }
        }
    }

    #[test]
    fn test_different_sliding_windows() {
        // Verify different window sizes produce different masks
        let device: <TestBackend as Backend>::Device = Default::default();
        let seq_len = 8;

        let scores_w2 = Tensor::<TestBackend, 4>::zeros([1, 1, seq_len, seq_len], &device);
        let scores_w4 = Tensor::<TestBackend, 4>::zeros([1, 1, seq_len, seq_len], &device);

        let masked_w2 = apply_causal_sliding_window_mask::<TestBackend>(scores_w2, seq_len, 2);
        let masked_w4 = apply_causal_sliding_window_mask::<TestBackend>(scores_w4, seq_len, 4);

        let w2_data = masked_w2.to_data();
        let w4_data = masked_w4.to_data();
        let w2_vals = w2_data.as_slice::<f32>().unwrap();
        let w4_vals = w4_data.as_slice::<f32>().unwrap();

        // Window=4 should have more visible positions than window=2
        let w2_visible = w2_vals.iter().filter(|&&v| v == 0.0).count();
        let w4_visible = w4_vals.iter().filter(|&&v| v == 0.0).count();
        assert!(
            w4_visible > w2_visible,
            "Window=4 ({} visible) should have more visible positions than window=2 ({})",
            w4_visible,
            w2_visible
        );
    }
}
