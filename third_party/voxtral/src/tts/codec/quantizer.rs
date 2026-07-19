//! FSQ (Finite Scalar Quantization) and VQ (Vector Quantization) for the codec decoder.
//!
//! FSQ: Maps continuous 36-dim vectors to 21 discrete levels per dimension.
//! VQ: Dequantizes semantic token indices via EMA codebook lookup.

use anyhow::{Context, Result};
use burn::module::{Param, ParamId};
use burn::tensor::backend::Backend;
use burn::tensor::Tensor;
use safetensors::SafeTensors;

use crate::models::weights::load_tensor;

/// Number of FSQ dimensions (acoustic codebooks).
pub const FSQ_DIM: usize = 36;

/// Number of discrete levels per dimension.
pub const FSQ_LEVELS: usize = 21;

/// Finite Scalar Quantization.
///
/// Each of 36 dimensions is quantized to one of 21 uniformly-spaced levels
/// in [-1, 1]. The level spacing is `2 / (FSQ_LEVELS - 1) = 0.1`.
pub struct Fsq;

impl Fsq {
    /// Quantize continuous values to nearest FSQ level indices.
    ///
    /// # Arguments
    /// * `x` - Continuous tensor with last dim = 36, values ideally in [-1, 1]
    ///
    /// # Returns
    /// Integer indices in [0, 20] per dimension as f32 tensor (same shape as input).
    pub fn quantize<B: Backend, const D: usize>(x: Tensor<B, D>) -> Tensor<B, D> {
        // Clamp to [-1, 1], then map to [0, FSQ_LEVELS-1]
        let clamped = x.clamp(-1.0, 1.0);
        // Map [-1, 1] -> [0, 20]: idx = round((x + 1) / 2 * 20)
        let half_levels = (FSQ_LEVELS - 1) as f32;
        let indices = ((clamped + 1.0) * (half_levels / 2.0)).round();
        indices.clamp(0.0, half_levels)
    }

    /// Dequantize FSQ level indices back to continuous values.
    ///
    /// # Arguments
    /// * `indices` - Integer indices in [0, 20] (as f32 tensor)
    ///
    /// # Returns
    /// Continuous values in [-1, 1] at level centers.
    pub fn dequantize<B: Backend, const D: usize>(indices: Tensor<B, D>) -> Tensor<B, D> {
        // Map [0, 20] -> [-1, 1]: x = indices / 10 - 1
        let half_levels = (FSQ_LEVELS - 1) as f32;
        indices * (2.0 / half_levels) - 1.0
    }

    /// Generate the 21 uniformly-spaced level values in [-1, 1].
    pub fn levels<B: Backend>(device: &B::Device) -> Tensor<B, 1> {
        let half_levels = (FSQ_LEVELS - 1) as f32;
        let data: Vec<f32> = (0..FSQ_LEVELS)
            .map(|i| i as f32 * 2.0 / half_levels - 1.0)
            .collect();
        Tensor::from_floats(data.as_slice(), device)
    }
}

/// Number of semantic VQ codebook entries.
pub const VQ_CODEBOOK_SIZE: usize = 8192;

/// Embedding dimension for semantic VQ codebook.
pub const VQ_EMBED_DIM: usize = 256;

/// VQ Semantic Codebook for dequantizing semantic token indices.
///
/// Uses EMA (Exponential Moving Average) codebook: the embedding for each
/// entry is `embedding_sum / cluster_usage`. This normalizes accumulated
/// embeddings by how often each codebook entry was used during training.
///
/// Pre-normalizes embeddings to CPU cache at construction to avoid GPU
/// readback during dequantize() (required for WASM compatibility).
#[derive(burn::module::Module, Debug)]
pub struct VqCodebook<B: Backend> {
    /// Accumulated embeddings [8192, 256].
    embedding_sum: Param<Tensor<B, 2>>,
    /// Per-entry usage counts [8192].
    cluster_usage: Param<Tensor<B, 1>>,
    /// CPU-cached normalized embeddings (embedding_sum / cluster_usage).
    /// Populated at construction to avoid GPU readback during inference.
    #[module(skip)]
    cpu_normalized: Vec<f32>,
    /// Embedding dimension.
    #[module(skip)]
    embed_dim: usize,
}

impl<B: Backend> VqCodebook<B> {
    /// Create VQ codebook from loaded tensors and pre-computed CPU cache.
    ///
    /// Use [`Self::precompute_normalized`] to build the CPU cache from raw
    /// f32 slices (before uploading to GPU) to avoid GPU readback.
    pub fn new(
        embedding_sum: Tensor<B, 2>,
        cluster_usage: Tensor<B, 1>,
        cpu_normalized: Vec<f32>,
    ) -> Self {
        let embed_dim = embedding_sum.dims()[1];
        Self {
            embedding_sum: Param::initialized(ParamId::new(), embedding_sum),
            cluster_usage: Param::initialized(ParamId::new(), cluster_usage),
            cpu_normalized,
            embed_dim,
        }
    }

    /// Pre-compute normalized embeddings from raw f32 slices.
    ///
    /// Call this on CPU-side data BEFORE constructing tensors, to avoid
    /// any GPU readback (required for WASM compatibility).
    pub fn precompute_normalized(
        embed_vals: &[f32],
        usage_vals: &[f32],
        n_entries: usize,
        embed_dim: usize,
    ) -> Vec<f32> {
        let mut normalized = vec![0.0f32; n_entries * embed_dim];
        for (idx, &usage) in usage_vals.iter().enumerate().take(n_entries) {
            if usage > 0.0 {
                let start = idx * embed_dim;
                for j in 0..embed_dim {
                    normalized[start + j] = embed_vals[start + j] / usage;
                }
            }
        }
        normalized
    }

    /// Load VQ codebook from SafeTensors.
    ///
    /// Expects:
    /// - `audio_tokenizer.quantizer.semantic_codebook.embedding_sum` [8192, 256]
    /// - `audio_tokenizer.quantizer.semantic_codebook.cluster_usage` [8192]
    pub fn from_safetensors(safetensors: &SafeTensors, device: &B::Device) -> Result<Self> {
        let embedding_sum: Tensor<B, 2> = load_tensor(
            safetensors,
            "audio_tokenizer.quantizer.semantic_codebook.embedding_sum",
            device,
        )
        .context("Loading VQ embedding_sum")?;

        let cluster_usage: Tensor<B, 1> = load_tensor(
            safetensors,
            "audio_tokenizer.quantizer.semantic_codebook.cluster_usage",
            device,
        )
        .context("Loading VQ cluster_usage")?;

        // Pre-compute normalized embeddings on CPU (sync readback OK on native)
        let embed_data = embedding_sum.to_data();
        let usage_data = cluster_usage.to_data();
        let embed_vals = embed_data.as_slice::<f32>().unwrap();
        let usage_vals = usage_data.as_slice::<f32>().unwrap();
        let [n_entries, embed_dim] = embedding_sum.dims();
        let cpu_normalized =
            Self::precompute_normalized(embed_vals, usage_vals, n_entries, embed_dim);

        Ok(Self::new(embedding_sum, cluster_usage, cpu_normalized))
    }

    /// Dequantize a batch of semantic token indices to embedding vectors.
    ///
    /// # Arguments
    /// * `indices` - Semantic token indices, each in [0, 8191]. Shape: [N]
    ///
    /// # Returns
    /// Embedding vectors [N, 256], normalized by cluster usage.
    pub fn dequantize(&self, indices: &[usize]) -> Tensor<B, 2> {
        let device = self.embedding_sum.device();
        let n = indices.len();

        // Use pre-normalized CPU cache (no GPU readback needed — WASM-safe)
        let mut result = Vec::with_capacity(n * self.embed_dim);
        for &idx in indices {
            let start = idx * self.embed_dim;
            let end = start + self.embed_dim;
            result.extend_from_slice(&self.cpu_normalized[start..end]);
        }

        let data = burn::tensor::TensorData::new(result, [n, self.embed_dim]);
        Tensor::from_data(data, &device)
    }

    /// Dequantize a single semantic token index.
    ///
    /// # Arguments
    /// * `index` - Semantic token index in [0, 8191]
    ///
    /// # Returns
    /// Embedding vector [1, 256], normalized by cluster usage.
    pub fn dequantize_one(&self, index: usize) -> Tensor<B, 2> {
        self.dequantize(&[index])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use burn::backend::Wgpu;
    use burn::tensor::TensorData;

    type TestBackend = Wgpu;

    #[test]
    fn test_levels_values() {
        let device = Default::default();
        let levels = Fsq::levels::<TestBackend>(&device);

        assert_eq!(levels.dims(), [FSQ_LEVELS]);

        let data = levels.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        // First level should be -1.0, last should be 1.0
        assert!((vals[0] - (-1.0)).abs() < 1e-6, "First level: {}", vals[0]);
        assert!((vals[20] - 1.0).abs() < 1e-6, "Last level: {}", vals[20]);

        // Middle level should be 0.0
        assert!((vals[10] - 0.0).abs() < 1e-6, "Middle level: {}", vals[10]);

        // Spacing should be uniform (0.1)
        for i in 1..FSQ_LEVELS {
            let diff = vals[i] - vals[i - 1];
            assert!(
                (diff - 0.1).abs() < 1e-6,
                "Non-uniform spacing at {}: {}",
                i,
                diff
            );
        }
    }

    #[test]
    fn test_quantize_at_level_centers() {
        let device = Default::default();

        // Values exactly at level centers should quantize to their indices
        let levels = Fsq::levels::<TestBackend>(&device);
        let indices = Fsq::quantize(levels);

        let data = indices.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        for (i, &v) in vals.iter().enumerate() {
            assert!(
                (v - i as f32).abs() < 1e-5,
                "Level {} quantized to {} (expected {})",
                i,
                v,
                i
            );
        }
    }

    #[test]
    fn test_roundtrip_preserves_level_values() {
        let device = Default::default();

        // Round-trip: levels -> quantize -> dequantize should recover original levels
        let levels = Fsq::levels::<TestBackend>(&device);
        let indices = Fsq::quantize(levels.clone());
        let recovered = Fsq::dequantize(indices);

        let orig_data = levels.to_data();
        let recovered_data = recovered.to_data();
        let orig = orig_data.as_slice::<f32>().unwrap();
        let recov = recovered_data.as_slice::<f32>().unwrap();

        for i in 0..FSQ_LEVELS {
            assert!(
                (orig[i] - recov[i]).abs() < 1e-6,
                "Roundtrip mismatch at level {}: {} vs {}",
                i,
                orig[i],
                recov[i]
            );
        }
    }

    #[test]
    fn test_quantize_clamps_out_of_range() {
        let device = Default::default();

        // Values outside [-1, 1] should be clamped
        let x = Tensor::<TestBackend, 1>::from_data(
            TensorData::new(vec![-2.0f32, -1.5, 0.0, 1.5, 2.0], [5]),
            &device,
        );
        let indices = Fsq::quantize(x);
        let data = indices.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        assert!((vals[0] - 0.0).abs() < 1e-5, "Clamped -2.0 -> idx 0");
        assert!((vals[1] - 0.0).abs() < 1e-5, "Clamped -1.5 -> idx 0");
        assert!((vals[2] - 10.0).abs() < 1e-5, "Center 0.0 -> idx 10");
        assert!((vals[3] - 20.0).abs() < 1e-5, "Clamped 1.5 -> idx 20");
        assert!((vals[4] - 20.0).abs() < 1e-5, "Clamped 2.0 -> idx 20");
    }

    #[test]
    fn test_quantize_midpoint_snapping() {
        let device = Default::default();

        // Value between two levels should snap to nearest
        // Levels at idx 10 = 0.0 and idx 11 = 0.1
        // 0.04 is closer to 0.0 (idx 10), 0.06 is closer to 0.1 (idx 11)
        let x =
            Tensor::<TestBackend, 1>::from_data(TensorData::new(vec![0.04f32, 0.06], [2]), &device);
        let indices = Fsq::quantize(x);
        let data = indices.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        assert!(
            (vals[0] - 10.0).abs() < 1e-5,
            "0.04 should snap to idx 10, got {}",
            vals[0]
        );
        assert!(
            (vals[1] - 11.0).abs() < 1e-5,
            "0.06 should snap to idx 11, got {}",
            vals[1]
        );
    }

    #[test]
    fn test_batch_quantize_shape() {
        let device = Default::default();

        // [batch, seq, 36] input should produce same shape output
        let x = Tensor::<TestBackend, 3>::zeros([2, 5, FSQ_DIM], &device);
        let indices = Fsq::quantize(x);
        assert_eq!(indices.dims(), [2, 5, FSQ_DIM]);

        let recovered = Fsq::dequantize(indices);
        assert_eq!(recovered.dims(), [2, 5, FSQ_DIM]);
    }

    // --- VQ Codebook tests ---

    fn make_test_codebook() -> VqCodebook<TestBackend> {
        let device = Default::default();
        let n = 16; // small codebook for testing
        let dim = 4; // small embedding dim

        // embedding_sum: each row i = [i+1, i+1, i+1, i+1] * usage
        // cluster_usage: [2, 2, 2, ..., 2] (each used 2 times)
        let mut embed_data = vec![0.0f32; n * dim];
        let mut usage_data = vec![2.0f32; n];

        for i in 0..n {
            for d in 0..dim {
                embed_data[i * dim + d] = (i + 1) as f32 * 2.0; // sum = val * usage
            }
        }
        // Set entry 5 to zero usage
        usage_data[5] = 0.0;

        let cpu_norm =
            VqCodebook::<TestBackend>::precompute_normalized(&embed_data, &usage_data, n, dim);
        let embedding_sum =
            Tensor::<TestBackend, 2>::from_data(TensorData::new(embed_data, [n, dim]), &device);
        let cluster_usage =
            Tensor::<TestBackend, 1>::from_data(TensorData::new(usage_data, [n]), &device);

        VqCodebook::new(embedding_sum, cluster_usage, cpu_norm)
    }

    #[test]
    fn test_vq_dequantize_single() {
        let codebook = make_test_codebook();

        // Index 0: embedding_sum = [2, 2, 2, 2], usage = 2 => result = [1, 1, 1, 1]
        let result = codebook.dequantize_one(0);
        assert_eq!(result.dims(), [1, 4]);

        let data = result.to_data();
        let vals = data.as_slice::<f32>().unwrap();
        for &v in vals {
            assert!((v - 1.0).abs() < 1e-6, "Expected 1.0, got {}", v);
        }
    }

    #[test]
    fn test_vq_dequantize_batch() {
        let codebook = make_test_codebook();

        let result = codebook.dequantize(&[0, 3, 7]);
        assert_eq!(result.dims(), [3, 4]);

        let data = result.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        // Index 0: sum=2, usage=2 => 1.0
        assert!((vals[0] - 1.0).abs() < 1e-6);
        // Index 3: sum=8, usage=2 => 4.0
        assert!((vals[4] - 4.0).abs() < 1e-6);
        // Index 7: sum=16, usage=2 => 8.0
        assert!((vals[8] - 8.0).abs() < 1e-6);
    }

    #[test]
    fn test_vq_dequantize_zero_usage() {
        let codebook = make_test_codebook();

        // Index 5 has zero usage — should return zero vector
        let result = codebook.dequantize_one(5);
        let data = result.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        for (i, &v) in vals.iter().enumerate() {
            assert!(
                v.abs() < 1e-7,
                "Zero-usage entry should be zero, got val[{}] = {}",
                i,
                v
            );
        }
    }

    #[test]
    fn test_vq_dequantize_output_shape() {
        let codebook = make_test_codebook();

        let result = codebook.dequantize(&[0, 1, 2, 3, 4]);
        assert_eq!(result.dims(), [5, 4]);
    }
}
