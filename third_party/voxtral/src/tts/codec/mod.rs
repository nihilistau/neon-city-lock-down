//! Codec decoder for TTS waveform synthesis.
//!
//! Converts quantized audio tokens (semantic VQ + acoustic FSQ) into 24 kHz waveform
//! via transformer blocks with ALiBi attention and causal convolution upsampling.
//!
//! Pipeline:
//! ```text
//! quantized tokens (292-dim: 256 semantic + 36 acoustic)
//!   → Conv1d [292→1024, k=3, s=1]          (block 0: input projection)
//!   → 2× Transformer(SW=2) + ConvT(2×up)   (blocks 1,2)
//!   → 2× Transformer(SW=4) + ConvT(2×up)   (blocks 3,4)
//!   → 2× Transformer(SW=8) + ConvT(2×up)   (blocks 5,6)
//!   → 2× Transformer(SW=16)                (block 7)
//!   → Conv1d [1024→240, k=7]               (output projection)
//!   → reshape patches to waveform
//! ```

pub mod alibi;
pub mod block;
pub mod conv;
pub mod layer_scale;
pub mod qk_norm;
pub mod quantizer;

use anyhow::{Context, Result};
use burn::tensor::backend::Backend;
use burn::tensor::Tensor;
use safetensors::SafeTensors;

use crate::tts::config::CodecDecoderConfig;
use block::CodecTransformerLayer;
use conv::{CausalConv1d, CausalConvTranspose1d};
use quantizer::{Fsq, VqCodebook};

/// A transformer block group: 2 transformer layers sharing the same sliding window.
struct TransformerGroup<B: Backend> {
    layers: Vec<CodecTransformerLayer<B>>,
}

impl<B: Backend> TransformerGroup<B> {
    fn forward(&self, mut x: Tensor<B, 3>) -> Tensor<B, 3> {
        for layer in &self.layers {
            x = layer.forward(x);
        }
        x
    }
}

/// Full codec decoder: conv-transformer autoencoder producing 24 kHz audio.
///
/// Loads 117 tensors from SafeTensors with weight norm fusion.
/// The decoder_blocks layout is:
/// - Even blocks (0, 2, 4, 6): convolution (input proj or upsample)
/// - Odd blocks (1, 3, 5, 7): transformer groups (2 layers each)
/// - Output: weight-normed Conv1d [1024→240, k=7]
pub struct CodecDecoder<B: Backend> {
    /// Input Conv1d [292→1024, k=3, s=1] (block 0).
    input_conv: CausalConv1d<B>,
    /// 4 transformer groups (blocks 1, 3, 5, 7), each with 2 layers.
    transformer_groups: Vec<TransformerGroup<B>>,
    /// 3 upsample ConvTranspose1d [1024→1024, k=4, s=2] (blocks 2, 4, 6).
    upsample_convs: Vec<CausalConvTranspose1d<B>>,
    /// Output Conv1d [1024→240, k=7, s=1].
    output_conv: CausalConv1d<B>,
    /// VQ semantic codebook for dequantizing semantic tokens.
    vq_codebook: VqCodebook<B>,
}

impl<B: Backend> CodecDecoder<B> {
    /// Create a codec decoder from pre-loaded components (for GGUF loading).
    ///
    /// `transformer_group_layers` is a Vec of 4 groups, each a Vec of layers.
    pub fn from_components(
        input_conv: CausalConv1d<B>,
        transformer_group_layers: Vec<Vec<CodecTransformerLayer<B>>>,
        upsample_convs: Vec<CausalConvTranspose1d<B>>,
        output_conv: CausalConv1d<B>,
        vq_codebook: VqCodebook<B>,
    ) -> Self {
        let transformer_groups = transformer_group_layers
            .into_iter()
            .map(|layers| TransformerGroup { layers })
            .collect();

        Self {
            input_conv,
            transformer_groups,
            upsample_convs,
            output_conv,
            vq_codebook,
        }
    }

    /// Load the full codec decoder from SafeTensors.
    ///
    /// # Arguments
    /// * `safetensors` - SafeTensors data containing all codec weights
    /// * `config` - Codec decoder configuration
    /// * `device` - Device for tensor allocation
    pub fn from_safetensors(
        safetensors: &SafeTensors,
        config: &CodecDecoderConfig,
        device: &B::Device,
    ) -> Result<Self> {
        let prefix = "audio_tokenizer";

        // Block 0: Input Conv1d [292→1024, k=3, s=1]
        let input_conv = CausalConv1d::from_safetensors(
            safetensors,
            &format!("{prefix}.decoder_blocks.0.conv"),
            1, // stride
            device,
        )
        .context("Loading input conv (block 0)")?;

        // Blocks 1,3,5,7: Transformer groups
        let transformer_block_indices = [1, 3, 5, 7];
        let mut transformer_groups = Vec::with_capacity(4);
        for (group_idx, &block_idx) in transformer_block_indices.iter().enumerate() {
            let sliding_window = config.sliding_windows[group_idx];
            let mut layers = Vec::with_capacity(config.layers_per_block);
            for layer_idx in 0..config.layers_per_block {
                let layer_prefix =
                    format!("{prefix}.decoder_blocks.{block_idx}.layers.{layer_idx}");
                let layer = CodecTransformerLayer::from_safetensors(
                    safetensors,
                    &layer_prefix,
                    config.n_heads,
                    config.head_dim,
                    sliding_window,
                    config.norm_eps,
                    device,
                )
                .with_context(|| {
                    format!("Loading transformer block {block_idx} layer {layer_idx}")
                })?;
                layers.push(layer);
            }
            transformer_groups.push(TransformerGroup { layers });
        }

        // Blocks 2,4,6: Upsample ConvTranspose1d [1024→1024, k=4, s=2]
        let upsample_block_indices = [2, 4, 6];
        let mut upsample_convs = Vec::with_capacity(3);
        for &block_idx in &upsample_block_indices {
            let conv_t = CausalConvTranspose1d::from_safetensors(
                safetensors,
                &format!("{prefix}.decoder_blocks.{block_idx}.conv"),
                2, // stride (2x upsample)
                device,
            )
            .with_context(|| format!("Loading upsample conv (block {block_idx})"))?;
            upsample_convs.push(conv_t);
        }

        // Output Conv1d [1024→240, k=7, s=1]
        let output_conv = CausalConv1d::from_safetensors(
            safetensors,
            &format!("{prefix}.output_proj.conv"),
            1, // stride
            device,
        )
        .context("Loading output conv")?;

        // VQ codebook
        let vq_codebook =
            VqCodebook::from_safetensors(safetensors, device).context("Loading VQ codebook")?;

        Ok(Self {
            input_conv,
            transformer_groups,
            upsample_convs,
            output_conv,
            vq_codebook,
        })
    }

    /// Decode quantized tokens into a 24 kHz waveform.
    ///
    /// # Arguments
    /// * `semantic_indices` - Semantic token indices per frame, each in [0, 8191]. Shape: [N]
    /// * `acoustic_indices` - Acoustic FSQ indices per frame [N, 36], each in [0, 20] as f32
    ///
    /// # Returns
    /// Audio samples [1, total_samples] at 24 kHz.
    pub fn decode(
        &self,
        semantic_indices: &[usize],
        acoustic_indices: Tensor<B, 2>,
    ) -> Tensor<B, 2> {
        let n_frames = semantic_indices.len();

        // Step 1: Dequantize tokens to continuous features
        // Semantic: VQ codebook lookup → [N, 256]
        let semantic_embeds = self.vq_codebook.dequantize(semantic_indices);

        // Acoustic: FSQ dequantize indices → continuous values [N, 36]
        let acoustic_values = Fsq::dequantize(acoustic_indices);

        // Step 2: Concatenate semantic + acoustic → [N, input_channels]
        let features = Tensor::cat(vec![semantic_embeds, acoustic_values], 1);
        let input_channels = features.dims()[1];

        // Step 3: Reshape to conv format [1, input_channels, N] (batch, channels, time)
        let x = features
            .reshape([1, n_frames, input_channels])
            .swap_dims(1, 2);

        // Step 4: Input projection [1, 292, N] → [1, 1024, N]
        let x = self.input_conv.forward(x);

        // Step 5: 4 rounds of (transformer group + upsample)
        // Group 0 (SW=2) → upsample 2x
        // Group 1 (SW=4) → upsample 2x
        // Group 2 (SW=8) → upsample 2x
        // Group 3 (SW=16) → no upsample (last group)
        let mut x = x;
        for (i, group) in self.transformer_groups.iter().enumerate() {
            // Transformer expects [batch, seq, dim], conv uses [batch, dim, time]
            let x_seq = x.swap_dims(1, 2); // [batch, time, channels]
            let x_seq = group.forward(x_seq);
            x = x_seq.swap_dims(1, 2); // back to [batch, channels, time]

            // Upsample (only for first 3 groups)
            if i < self.upsample_convs.len() {
                x = self.upsample_convs[i].forward(x);
            }
        }

        // Step 6: Output projection [1, 1024, T] → [1, 240, T]
        let x = self.output_conv.forward(x);

        // Step 7: Reshape patches to waveform
        // x: [1, 240, T_patches] → [1, 240 * T_patches]
        let [_batch, patch_size, n_patches] = x.dims();
        let x = x.swap_dims(1, 2); // [1, T_patches, 240]
        x.reshape([1, n_patches * patch_size])
    }

    /// Access the VQ codebook (for external use).
    pub fn vq_codebook(&self) -> &VqCodebook<B> {
        &self.vq_codebook
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use burn::backend::Wgpu;
    use burn::tensor::TensorData;

    type TestBackend = Wgpu;

    /// Helper to create a small codec decoder for testing (no safetensors needed).
    fn make_test_decoder(device: &<TestBackend as Backend>::Device) -> CodecDecoder<TestBackend> {
        // Use tiny dimensions for fast testing
        let input_channels = 6; // instead of 292
        let dim = 8; // instead of 1024
        let n_heads = 2;
        let head_dim = 4; // dim = n_heads * head_dim
        let ffn_dim = 32;
        let output_patch_size = 4; // instead of 240

        // Input conv: [input_channels → dim, k=3, s=1]
        let g = Tensor::<TestBackend, 3>::ones([dim, 1, 1], device);
        let v = Tensor::<TestBackend, 3>::ones([dim, input_channels, 3], device);
        let input_conv = CausalConv1d::from_weight_norm(g, v, 1, device);

        // 4 transformer groups
        let windows = [2, 4, 8, 16];
        let mut transformer_groups = Vec::new();
        for &window in &windows {
            let mut layers = Vec::new();
            for _ in 0..2 {
                use block::CodecAttention;
                use burn::nn::LinearConfig;

                let wq = LinearConfig::new(dim, dim).with_bias(false).init(device);
                let wk = LinearConfig::new(dim, dim).with_bias(false).init(device);
                let wv = LinearConfig::new(dim, dim).with_bias(false).init(device);
                let wo = LinearConfig::new(dim, dim).with_bias(false).init(device);

                let q_weight = Tensor::<TestBackend, 1>::ones([dim], device);
                let k_weight = Tensor::<TestBackend, 1>::ones([dim], device);
                let qk_norm = qk_norm::QkNorm::new(q_weight, k_weight, n_heads, head_dim);

                let attention =
                    CodecAttention::new(wq, wk, wv, wo, qk_norm, n_heads, head_dim, window);

                let attn_scale = layer_scale::LayerScale::new(Tensor::ones([dim], device) * 0.01);
                let ffn_scale = layer_scale::LayerScale::new(Tensor::ones([dim], device) * 0.01);

                use crate::models::layers::{RmsNorm, SwiGLUConfig};
                use burn::module::{Param, ParamId};

                let attention_norm = RmsNorm {
                    weight: burn::nn::RmsNorm {
                        gamma: Param::initialized(
                            ParamId::new(),
                            Tensor::<TestBackend, 1>::ones([dim], device),
                        ),
                        epsilon: 1e-5,
                    },
                };
                let ffn_norm = RmsNorm {
                    weight: burn::nn::RmsNorm {
                        gamma: Param::initialized(
                            ParamId::new(),
                            Tensor::<TestBackend, 1>::ones([dim], device),
                        ),
                        epsilon: 1e-5,
                    },
                };
                let ffn = SwiGLUConfig::new(dim, ffn_dim)
                    .with_bias(false)
                    .init(device);

                let layer = CodecTransformerLayer::new(
                    attention_norm,
                    attention,
                    attn_scale,
                    ffn_norm,
                    ffn,
                    ffn_scale,
                );
                layers.push(layer);
            }
            transformer_groups.push(TransformerGroup { layers });
        }

        // 3 upsample convs: [dim → dim, k=4, s=2]
        let mut upsample_convs = Vec::new();
        for _ in 0..3 {
            let g = Tensor::<TestBackend, 3>::ones([dim, 1, 1], device);
            let v = Tensor::<TestBackend, 3>::ones([dim, dim, 4], device);
            upsample_convs.push(CausalConvTranspose1d::from_weight_norm(g, v, 2, device));
        }

        // Output conv: [dim → output_patch_size, k=7, s=1]
        let g = Tensor::<TestBackend, 3>::ones([output_patch_size, 1, 1], device);
        let v = Tensor::<TestBackend, 3>::ones([output_patch_size, dim, 7], device);
        let output_conv = CausalConv1d::from_weight_norm(g, v, 1, device);

        // VQ codebook: tiny
        let embed_sum = Tensor::<TestBackend, 2>::ones([16, 4], device);
        let usage = Tensor::<TestBackend, 1>::ones([16], device);
        let cpu_norm =
            VqCodebook::<TestBackend>::precompute_normalized(&vec![1.0; 64], &vec![1.0; 16], 16, 4);
        let vq_codebook = VqCodebook::new(embed_sum, usage, cpu_norm);

        CodecDecoder {
            input_conv,
            transformer_groups,
            upsample_convs,
            output_conv,
            vq_codebook,
        }
    }

    #[test]
    fn test_codec_decoder_output_shape() {
        let device = Default::default();
        let decoder = make_test_decoder(&device);

        let n_frames = 4;
        let semantic_indices = vec![0usize; n_frames];
        // acoustic indices: [N, 36] — but our test decoder uses input_channels=6,
        // and semantic embed is 4, so acoustic is 6-4=2
        let acoustic_indices = Tensor::<TestBackend, 2>::zeros([n_frames, 2], &device);

        let output = decoder.decode(&semantic_indices, acoustic_indices);

        // n_frames=4 → after 3 upsample (2x each) = 4*8 = 32 time patches
        // output_patch_size=4, so total samples = 32 * 4 = 128
        assert_eq!(output.dims()[0], 1);
        assert_eq!(output.dims()[1], 32 * 4);
    }

    #[test]
    fn test_codec_decoder_single_frame() {
        let device = Default::default();
        let decoder = make_test_decoder(&device);

        let semantic_indices = vec![0usize; 1];
        let acoustic_indices = Tensor::<TestBackend, 2>::zeros([1, 2], &device);

        let output = decoder.decode(&semantic_indices, acoustic_indices);

        // 1 frame → 1*8 = 8 time patches → 8*4 = 32 samples
        assert_eq!(output.dims(), [1, 32]);
    }

    #[test]
    fn test_codec_decoder_output_not_all_zeros() {
        // Verify that the decoder produces non-trivial output
        let device = Default::default();
        let decoder = make_test_decoder(&device);

        let n_frames = 2;
        let semantic_indices = vec![0usize; n_frames];
        let acoustic_indices = Tensor::<TestBackend, 2>::ones([n_frames, 2], &device) * 10.0; // mid-range FSQ

        let output = decoder.decode(&semantic_indices, acoustic_indices);

        let data = output.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        // At least some samples should be non-zero
        let has_nonzero = vals.iter().any(|&v| v.abs() > 1e-6);
        assert!(has_nonzero, "Decoder output should not be all zeros");
    }

    #[test]
    fn test_codec_decoder_upsampling_ratio() {
        // Verify 8x total upsampling (3 stages of 2x each)
        let device = Default::default();
        let decoder = make_test_decoder(&device);

        for n_frames in [2, 5, 10] {
            let semantic_indices = vec![0usize; n_frames];
            let acoustic_indices = Tensor::<TestBackend, 2>::zeros([n_frames, 2], &device);

            let output = decoder.decode(&semantic_indices, acoustic_indices);
            let total_samples = output.dims()[1];
            let expected_patches = n_frames * 8; // 3x 2x upsample
            let expected_samples = expected_patches * 4; // output_patch_size = 4

            assert_eq!(
                total_samples, expected_samples,
                "For {} frames: expected {} samples, got {}",
                n_frames, expected_samples, total_samples
            );
        }
    }

    #[test]
    fn test_fsq_dequantize_integration() {
        // Verify that FSQ dequantize produces expected range for codec input
        let device: <TestBackend as Backend>::Device = Default::default();

        // Indices at boundaries
        let indices = Tensor::<TestBackend, 2>::from_data(
            TensorData::new(vec![0.0f32, 10.0, 20.0, 0.0, 10.0, 20.0], [2, 3]),
            &device,
        );
        let values = Fsq::dequantize(indices);

        let data = values.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        // idx 0 → -1.0, idx 10 → 0.0, idx 20 → 1.0
        assert!((vals[0] - (-1.0)).abs() < 1e-5);
        assert!((vals[1] - 0.0).abs() < 1e-5);
        assert!((vals[2] - 1.0).abs() < 1e-5);
    }
}
