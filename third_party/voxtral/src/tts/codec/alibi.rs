//! ALiBi (Attention with Linear Biases) for the codec decoder.
//!
//! Adds a per-head relative position bias to attention scores instead of
//! using RoPE. No learned parameters — slopes are derived from head count.

use burn::tensor::backend::Backend;
use burn::tensor::Tensor;

/// ALiBi positional bias generator.
///
/// Computes `bias[h, i, j] = slope[h] * (j - i)` where slopes form a
/// geometric sequence: `slope[h] = 2^(-8 * (h+1) / n_heads)`.
pub struct ALiBi {
    /// Pre-computed slopes per head, shape [n_heads].
    slopes: Vec<f32>,
    /// Number of attention heads.
    n_heads: usize,
}

impl ALiBi {
    /// Create ALiBi with slopes derived from the number of heads.
    ///
    /// Slopes follow the geometric sequence from the ALiBi paper:
    /// `slope[h] = 2^(-8 * (h+1) / n_heads)` for h in 0..n_heads.
    pub fn new(n_heads: usize) -> Self {
        let slopes: Vec<f32> = (0..n_heads)
            .map(|h| 2.0f32.powf(-8.0 * (h + 1) as f32 / n_heads as f32))
            .collect();

        Self { slopes, n_heads }
    }

    /// Compute ALiBi bias matrix for given sequence lengths.
    ///
    /// # Arguments
    /// * `q_len` - Query sequence length
    /// * `kv_len` - Key/value sequence length (may differ with KV cache)
    /// * `device` - Device for tensor allocation
    ///
    /// # Returns
    /// Bias tensor [1, n_heads, q_len, kv_len] to add to attention scores.
    pub fn bias<B: Backend>(
        &self,
        q_len: usize,
        kv_len: usize,
        device: &B::Device,
    ) -> Tensor<B, 4> {
        // Compute relative positions: (j - i) for each (query_pos, key_pos) pair.
        // When q_len < kv_len (cached decode), query positions are offset:
        //   query position i corresponds to absolute position (kv_len - q_len + i).
        let offset = kv_len - q_len;

        let mut bias_data = Vec::with_capacity(self.n_heads * q_len * kv_len);
        for h in 0..self.n_heads {
            let slope = self.slopes[h];
            for i in 0..q_len {
                let abs_i = (offset + i) as f32;
                for j in 0..kv_len {
                    // relative position: key_pos - query_pos
                    bias_data.push(slope * (j as f32 - abs_i));
                }
            }
        }

        let bias: Tensor<B, 1> = Tensor::from_floats(bias_data.as_slice(), device);
        bias.reshape([1, self.n_heads, q_len, kv_len])
    }

    /// Number of heads.
    pub fn n_heads(&self) -> usize {
        self.n_heads
    }

    /// Get the slopes vector (for testing/debugging).
    pub fn slopes(&self) -> &[f32] {
        &self.slopes
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use burn::backend::Wgpu;

    type TestBackend = Wgpu;

    #[test]
    fn test_slopes_geometric_sequence() {
        let alibi = ALiBi::new(8);
        let slopes = alibi.slopes();

        assert_eq!(slopes.len(), 8);

        // slope[h] = 2^(-8*(h+1)/8) = 2^(-(h+1))
        // slope[0] = 0.5, slope[1] = 0.25, ..., slope[7] = 1/256
        for h in 0..8 {
            let expected = 2.0f32.powf(-((h + 1) as f32));
            assert!(
                (slopes[h] - expected).abs() < 1e-7,
                "Slope[{}]: {} vs expected {}",
                h,
                slopes[h],
                expected
            );
        }
    }

    #[test]
    fn test_slopes_decrease_monotonically() {
        let alibi = ALiBi::new(8);
        let slopes = alibi.slopes();

        for i in 1..slopes.len() {
            assert!(
                slopes[i] < slopes[i - 1],
                "Slopes should decrease: slopes[{}]={} >= slopes[{}]={}",
                i,
                slopes[i],
                i - 1,
                slopes[i - 1]
            );
        }
    }

    #[test]
    fn test_bias_shape() {
        let device = Default::default();
        let alibi = ALiBi::new(8);
        let bias = alibi.bias::<TestBackend>(10, 10, &device);

        assert_eq!(bias.dims(), [1, 8, 10, 10]);
    }

    #[test]
    fn test_bias_shape_cached_decode() {
        let device = Default::default();
        let alibi = ALiBi::new(8);

        // Single query token attending to 20 cached keys
        let bias = alibi.bias::<TestBackend>(1, 20, &device);
        assert_eq!(bias.dims(), [1, 8, 1, 20]);
    }

    #[test]
    fn test_bias_diagonal_is_zero() {
        let device = Default::default();
        let alibi = ALiBi::new(8);
        let bias = alibi.bias::<TestBackend>(5, 5, &device);

        let data = bias.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        // For each head, bias[i, i] should be 0 (j - i = 0)
        for h in 0..8 {
            for i in 0..5 {
                let idx = h * 25 + i * 5 + i; // [h, i, i]
                assert!(
                    vals[idx].abs() < 1e-7,
                    "Diagonal bias[{}, {}, {}] = {} (expected 0)",
                    h,
                    i,
                    i,
                    vals[idx]
                );
            }
        }
    }

    #[test]
    fn test_bias_values_for_head_0() {
        let device = Default::default();
        let alibi = ALiBi::new(8);
        let bias = alibi.bias::<TestBackend>(4, 4, &device);

        let data = bias.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        // Head 0: slope = 2^(-1) = 0.5
        // bias[0, i, j] = 0.5 * (j - i)
        let slope = 0.5f32;
        for i in 0..4 {
            for j in 0..4 {
                let expected = slope * (j as f32 - i as f32);
                let idx = i * 4 + j; // head 0 starts at offset 0
                assert!(
                    (vals[idx] - expected).abs() < 1e-6,
                    "bias[0, {}, {}] = {} (expected {})",
                    i,
                    j,
                    vals[idx],
                    expected
                );
            }
        }
    }

    #[test]
    fn test_bias_future_positions_are_negative() {
        let device = Default::default();
        let alibi = ALiBi::new(8);
        let bias = alibi.bias::<TestBackend>(5, 5, &device);

        let data = bias.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        // For causal attention, future positions (j < i) should have negative bias
        // (because j - i < 0 and slopes are positive)
        for h in 0..8 {
            for i in 1..5 {
                for j in 0..i {
                    let idx = h * 25 + i * 5 + j;
                    assert!(
                        vals[idx] < 0.0,
                        "Past bias[{}, {}, {}] = {} should be negative",
                        h,
                        i,
                        j,
                        vals[idx]
                    );
                }
            }
        }
    }

    #[test]
    fn test_bias_with_kv_cache_offset() {
        let device = Default::default();
        let alibi = ALiBi::new(8);

        // Full sequence: 5 tokens
        let bias_full = alibi.bias::<TestBackend>(5, 5, &device);
        // Cached decode: query is token 4, attending to all 5 cached tokens
        let bias_cached = alibi.bias::<TestBackend>(1, 5, &device);

        let full_data = bias_full.to_data();
        let cached_data = bias_cached.to_data();
        let full_vals = full_data.as_slice::<f32>().unwrap();
        let cached_vals = cached_data.as_slice::<f32>().unwrap();

        // The cached bias for query=0 (absolute position 4) attending to all 5 keys
        // should match the last row (i=4) of the full bias
        for h in 0..8 {
            for j in 0..5 {
                let full_idx = h * 25 + 4 * 5 + j; // last row of full
                let cached_idx = h * 5 + j; // only row of cached
                assert!(
                    (full_vals[full_idx] - cached_vals[cached_idx]).abs() < 1e-6,
                    "Head {}, key {}: full={} cached={}",
                    h,
                    j,
                    full_vals[full_idx],
                    cached_vals[cached_idx]
                );
            }
        }
    }
}
