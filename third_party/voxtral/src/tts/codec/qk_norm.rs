//! QK-Norm: per-head RMSNorm on Q and K before attention scoring.
//!
//! Used in the codec decoder transformer layers. Weights are per head_dim
//! element, shared across heads (since n_heads * head_dim = total dim).

use burn::module::{Param, ParamId};
use burn::tensor::backend::Backend;
use burn::tensor::Tensor;

/// QK-Norm: applies RMSNorm to Q and K tensors using learned weight vectors.
///
/// The weight vectors have shape [n_heads * head_dim] and are applied per
/// head_dim element, shared across all heads. In practice this means the
/// weight is reshaped to [1, n_heads, 1, head_dim] and broadcast.
#[derive(burn::module::Module, Debug)]
pub struct QkNorm<B: Backend> {
    /// Q normalization weight [n_heads * head_dim].
    pub q_weight: Param<Tensor<B, 1>>,
    /// K normalization weight [n_heads * head_dim].
    pub k_weight: Param<Tensor<B, 1>>,
    /// Number of attention heads.
    n_heads: usize,
    /// Dimension per head.
    head_dim: usize,
    /// Epsilon for numerical stability.
    eps: f64,
}

impl<B: Backend> QkNorm<B> {
    /// Create QkNorm from loaded weight tensors.
    ///
    /// # Arguments
    /// * `q_weight` - Q normalization weight [n_heads * head_dim]
    /// * `k_weight` - K normalization weight [n_heads * head_dim]
    /// * `n_heads` - Number of attention heads
    /// * `head_dim` - Dimension per head
    pub fn new(
        q_weight: Tensor<B, 1>,
        k_weight: Tensor<B, 1>,
        n_heads: usize,
        head_dim: usize,
    ) -> Self {
        Self {
            q_weight: Param::initialized(ParamId::new(), q_weight),
            k_weight: Param::initialized(ParamId::new(), k_weight),
            n_heads,
            head_dim,
            eps: 1e-5,
        }
    }

    /// Apply RMSNorm to Q and K tensors.
    ///
    /// # Arguments
    /// * `q` - Query tensor [batch, n_heads, seq_len, head_dim]
    /// * `k` - Key tensor [batch, n_kv_heads, seq_len, head_dim]
    ///
    /// # Returns
    /// Normalized (q, k) with same shapes.
    pub fn forward(&self, q: Tensor<B, 4>, k: Tensor<B, 4>) -> (Tensor<B, 4>, Tensor<B, 4>) {
        let q_normed = self.rms_norm_4d(q, &self.q_weight);
        let k_normed = self.rms_norm_4d(k, &self.k_weight);
        (q_normed, k_normed)
    }

    /// Apply RMSNorm along the last dimension of a 4D tensor.
    ///
    /// Weight [n_heads * head_dim] is reshaped to [1, n_heads, 1, head_dim]
    /// for broadcasting. For K with n_kv_heads < n_heads, only the first
    /// n_kv_heads * head_dim elements of the weight are used.
    fn rms_norm_4d(&self, x: Tensor<B, 4>, weight: &Param<Tensor<B, 1>>) -> Tensor<B, 4> {
        let [_batch, n_heads_actual, _seq, _head_dim] = x.dims();

        // RMSNorm: x * weight / sqrt(mean(x^2) + eps)
        let variance = x.clone().powf_scalar(2.0).mean_dim(3); // [B, H, S, 1]
        let x_normed = x / (variance + self.eps).sqrt();

        // Reshape weight for broadcasting: [n_heads_actual * head_dim] -> [1, n_heads_actual, 1, head_dim]
        let w = weight.val().narrow(0, 0, n_heads_actual * self.head_dim);
        let w = w.reshape([1, n_heads_actual, 1, self.head_dim]);

        x_normed * w
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use burn::backend::Wgpu;
    use burn::tensor::TensorData;

    type TestBackend = Wgpu;

    #[test]
    fn test_qk_norm_output_shape() {
        let device = Default::default();
        let n_heads = 8;
        let head_dim = 128;
        let total_dim = n_heads * head_dim; // 1024

        let q_weight = Tensor::<TestBackend, 1>::ones([total_dim], &device);
        let k_weight = Tensor::<TestBackend, 1>::ones([total_dim], &device);

        let qk_norm = QkNorm::new(q_weight, k_weight, n_heads, head_dim);

        let q = Tensor::<TestBackend, 4>::zeros([2, n_heads, 10, head_dim], &device);
        let k = Tensor::<TestBackend, 4>::zeros([2, n_heads, 10, head_dim], &device);

        let (q_out, k_out) = qk_norm.forward(q, k);

        assert_eq!(q_out.dims(), [2, n_heads, 10, head_dim]);
        assert_eq!(k_out.dims(), [2, n_heads, 10, head_dim]);
    }

    #[test]
    fn test_qk_norm_unit_weight_is_rms_norm() {
        let device = Default::default();
        let n_heads = 2;
        let head_dim = 4;
        let total_dim = n_heads * head_dim;

        let q_weight = Tensor::<TestBackend, 1>::ones([total_dim], &device);
        let k_weight = Tensor::<TestBackend, 1>::ones([total_dim], &device);

        let qk_norm = QkNorm::new(q_weight, k_weight, n_heads, head_dim);

        // Input with known values
        let q_data = vec![1.0f32, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
        let q = Tensor::<TestBackend, 4>::from_data(TensorData::new(q_data, [1, 2, 1, 4]), &device);
        let k = q.clone();

        let (q_out, _k_out) = qk_norm.forward(q.clone(), k);

        // Verify RMSNorm: for [1,2,3,4], rms = sqrt(mean([1,4,9,16])) = sqrt(7.5)
        // normed = [1,2,3,4] / sqrt(7.5 + 1e-5)
        let q_data = q_out.to_data();
        let vals = q_data.as_slice::<f32>().unwrap();

        let rms_head0 = (7.5f32 + 1e-5).sqrt();
        assert!(
            (vals[0] - 1.0 / rms_head0).abs() < 1e-4,
            "Expected {}, got {}",
            1.0 / rms_head0,
            vals[0]
        );
        assert!(
            (vals[1] - 2.0 / rms_head0).abs() < 1e-4,
            "Expected {}, got {}",
            2.0 / rms_head0,
            vals[1]
        );
    }

    #[test]
    fn test_qk_norm_weight_scaling() {
        let device = Default::default();
        let n_heads = 2;
        let head_dim = 4;
        let total_dim = n_heads * head_dim;

        // Weight of 2.0 should double the normalized output
        let q_weight = Tensor::<TestBackend, 1>::ones([total_dim], &device) * 2.0;
        let k_weight = Tensor::<TestBackend, 1>::ones([total_dim], &device);

        let qk_norm = QkNorm::new(q_weight, k_weight, n_heads, head_dim);

        let q = Tensor::<TestBackend, 4>::ones([1, 2, 1, 4], &device);
        let k = q.clone();

        let (q_out, k_out) = qk_norm.forward(q, k);

        // Q should be 2x K (since q_weight = 2 * k_weight and input is the same)
        let q_data = q_out.to_data();
        let k_data = k_out.to_data();
        let q_vals = q_data.as_slice::<f32>().unwrap();
        let k_vals = k_data.as_slice::<f32>().unwrap();

        for i in 0..8 {
            assert!(
                (q_vals[i] - 2.0 * k_vals[i]).abs() < 1e-5,
                "Q[{}]={} should be 2*K[{}]={}",
                i,
                q_vals[i],
                i,
                k_vals[i]
            );
        }
    }

    #[test]
    fn test_qk_norm_with_mha_kv_heads() {
        // In the codec, n_heads == n_kv_heads == 8 (MHA, not GQA)
        let device = Default::default();
        let n_heads = 8;
        let head_dim = 128;
        let total_dim = n_heads * head_dim;

        let q_weight = Tensor::<TestBackend, 1>::ones([total_dim], &device);
        let k_weight = Tensor::<TestBackend, 1>::ones([total_dim], &device);

        let qk_norm = QkNorm::new(q_weight, k_weight, n_heads, head_dim);

        let q = Tensor::<TestBackend, 4>::ones([1, 8, 5, 128], &device);
        let k = Tensor::<TestBackend, 4>::ones([1, 8, 5, 128], &device);

        let (q_out, k_out) = qk_norm.forward(q, k);
        assert_eq!(q_out.dims(), [1, 8, 5, 128]);
        assert_eq!(k_out.dims(), [1, 8, 5, 128]);
    }
}
