//! LayerScale: learnable per-channel scaling for residual connections.
//!
//! Used in the codec decoder to scale attention and FFN outputs before
//! adding to the residual stream.

use burn::module::{Param, ParamId};
use burn::tensor::backend::Backend;
use burn::tensor::Tensor;

/// LayerScale applies a learnable per-channel scale to its input.
///
/// Forward: `output = input * scale` where scale is [dim] broadcast over
/// batch and sequence dimensions.
///
/// In the codec decoder, each transformer layer has two LayerScale instances:
/// - `attention_scale` [1024]: scales attention output before residual add
/// - `ffn_scale` [1024]: scales FFN output before residual add
#[derive(burn::module::Module, Debug)]
pub struct LayerScale<B: Backend> {
    /// Per-channel scale weights [dim].
    pub scale: Param<Tensor<B, 1>>,
}

impl<B: Backend> LayerScale<B> {
    /// Create LayerScale from a loaded weight tensor.
    ///
    /// # Arguments
    /// * `scale` - Scale weights [dim], typically initialized to 0.01 during training.
    pub fn new(scale: Tensor<B, 1>) -> Self {
        Self {
            scale: Param::initialized(ParamId::new(), scale),
        }
    }

    /// Apply per-channel scaling to input.
    ///
    /// # Arguments
    /// * `x` - Input tensor [batch, seq_len, dim]
    ///
    /// # Returns
    /// Scaled tensor [batch, seq_len, dim].
    pub fn forward(&self, x: Tensor<B, 3>) -> Tensor<B, 3> {
        // scale [dim] broadcasts over [batch, seq_len, dim]
        x * self.scale.val().unsqueeze::<3>().unsqueeze()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use burn::backend::Wgpu;
    use burn::tensor::TensorData;

    type TestBackend = Wgpu;

    #[test]
    fn test_layer_scale_output_shape() {
        let device = Default::default();
        let dim = 1024;

        let scale = Tensor::<TestBackend, 1>::ones([dim], &device) * 0.01;
        let ls = LayerScale::new(scale);

        let x = Tensor::<TestBackend, 3>::ones([2, 10, dim], &device);
        let out = ls.forward(x);

        assert_eq!(out.dims(), [2, 10, dim]);
    }

    #[test]
    fn test_layer_scale_multiplies_correctly() {
        let device = Default::default();
        let dim = 4;

        // Scale = [1, 2, 3, 4]
        let scale = Tensor::<TestBackend, 1>::from_data(
            TensorData::new(vec![1.0f32, 2.0, 3.0, 4.0], [4]),
            &device,
        );
        let ls = LayerScale::new(scale);

        // Input = ones [1, 2, 4]
        let x = Tensor::<TestBackend, 3>::ones([1, 2, dim], &device);
        let out = ls.forward(x);

        let data = out.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        // Each position should be scaled by [1, 2, 3, 4]
        // Position (0, 0, :) = [1, 2, 3, 4]
        assert!((vals[0] - 1.0).abs() < 1e-6);
        assert!((vals[1] - 2.0).abs() < 1e-6);
        assert!((vals[2] - 3.0).abs() < 1e-6);
        assert!((vals[3] - 4.0).abs() < 1e-6);

        // Position (0, 1, :) should be the same (broadcast)
        assert!((vals[4] - 1.0).abs() < 1e-6);
        assert!((vals[5] - 2.0).abs() < 1e-6);
        assert!((vals[6] - 3.0).abs() < 1e-6);
        assert!((vals[7] - 4.0).abs() < 1e-6);
    }

    #[test]
    fn test_layer_scale_default_init_value() {
        let device = Default::default();
        let dim = 1024;

        // Codec layers are initialized to 0.01 during training
        let scale = Tensor::<TestBackend, 1>::ones([dim], &device) * 0.01;
        let ls = LayerScale::new(scale);

        let x = Tensor::<TestBackend, 3>::ones([1, 5, dim], &device);
        let out = ls.forward(x);

        let data = out.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        // All values should be ~0.01
        for (i, &v) in vals.iter().enumerate().take(10) {
            assert!(
                (v - 0.01).abs() < 1e-6,
                "Value[{}] = {} (expected 0.01)",
                i,
                v
            );
        }
    }

    #[test]
    fn test_layer_scale_zero_scale_zeros_output() {
        let device = Default::default();
        let dim = 8;

        let scale = Tensor::<TestBackend, 1>::zeros([dim], &device);
        let ls = LayerScale::new(scale);

        let x = Tensor::<TestBackend, 3>::ones([1, 3, dim], &device) * 42.0;
        let out = ls.forward(x);

        let data = out.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        for (i, &v) in vals.iter().enumerate() {
            assert!(
                v.abs() < 1e-7,
                "Zero scale should zero output, got val[{}] = {}",
                i,
                v
            );
        }
    }

    #[test]
    fn test_layer_scale_batch_independence() {
        let device = Default::default();
        let scale = Tensor::<TestBackend, 1>::from_data(
            TensorData::new(vec![2.0f32, 2.0, 2.0, 2.0], [4]),
            &device,
        );
        let ls = LayerScale::new(scale);

        // Different batch items should be scaled identically
        let x = Tensor::<TestBackend, 3>::from_data(
            TensorData::new(
                vec![
                    1.0f32, 1.0, 1.0, 1.0, // batch 0, seq 0
                    3.0, 3.0, 3.0, 3.0, // batch 1, seq 0
                ],
                [2, 1, 4],
            ),
            &device,
        );
        let out = ls.forward(x);

        let data = out.to_data();
        let vals = data.as_slice::<f32>().unwrap();

        // batch 0: [1,1,1,1] * 2 = [2,2,2,2]
        assert!((vals[0] - 2.0).abs() < 1e-6);
        // batch 1: [3,3,3,3] * 2 = [6,6,6,6]
        assert!((vals[4] - 6.0).abs() < 1e-6);
    }
}
