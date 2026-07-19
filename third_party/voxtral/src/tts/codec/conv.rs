//! Weight-normed causal Conv1d and ConvTranspose1d for the codec decoder.
//!
//! Handles weight norm fusion at load time, causal padding (left-pad for Conv1d),
//! and causal output trimming (right-trim for ConvTranspose1d).

use anyhow::{Context, Result};
use burn::module::{Param, ParamId};
use burn::nn::conv::{Conv1d, Conv1dConfig, ConvTranspose1d, ConvTranspose1dConfig};
use burn::nn::PaddingConfig1d;
use burn::tensor::backend::Backend;
use burn::tensor::Tensor;
use safetensors::SafeTensors;

use crate::models::weights::load_tensor;

/// Causal Conv1d with weight normalization fused at load time.
///
/// Weight norm stores weights as (magnitude `g`, direction `v`) and fuses
/// them at load time: `weight = g * v / ||v||` per output channel.
///
/// Causal padding: left-pad input by `(kernel_size - stride)` so output[t]
/// depends only on input[≤t].
pub struct CausalConv1d<B: Backend> {
    /// The underlying Burn Conv1d with fused weight-normed weights.
    conv: Conv1d<B>,
    /// Left padding amount = kernel_size - stride.
    pad_left: usize,
}

impl<B: Backend> CausalConv1d<B> {
    /// Fuse weight norm and create a causal Conv1d.
    ///
    /// # Arguments
    /// * `g` - Magnitude tensor [C_out, 1, 1]
    /// * `v` - Direction tensor [C_out, C_in, K]
    /// * `stride` - Convolution stride
    /// * `device` - Device for tensor allocation
    pub fn from_weight_norm(
        g: Tensor<B, 3>,
        v: Tensor<B, 3>,
        stride: usize,
        device: &B::Device,
    ) -> Self {
        let [c_out, c_in, kernel_size] = v.dims();

        let weight = fuse_weight_norm(g, v);

        // Create Conv1d via config, then replace weight with fused weight
        let mut conv = Conv1dConfig::new(c_in, c_out, kernel_size)
            .with_stride(stride)
            .with_padding(PaddingConfig1d::Explicit(0))
            .with_bias(false)
            .init(device);

        conv.weight = Param::initialized(ParamId::new(), weight);

        let pad_left = kernel_size - stride;

        Self { conv, pad_left }
    }

    /// Create a causal Conv1d from a pre-fused weight tensor.
    ///
    /// Used for GGUF loading where weight norms are pre-fused by the conversion script.
    ///
    /// # Arguments
    /// * `weight` - Fused weight tensor [C_out, C_in, K]
    /// * `stride` - Convolution stride
    /// * `device` - Device for tensor allocation
    pub fn from_fused_weight(weight: Tensor<B, 3>, stride: usize, device: &B::Device) -> Self {
        let [c_out, c_in, kernel_size] = weight.dims();

        let mut conv = Conv1dConfig::new(c_in, c_out, kernel_size)
            .with_stride(stride)
            .with_padding(PaddingConfig1d::Explicit(0))
            .with_bias(false)
            .init(device);

        conv.weight = Param::initialized(ParamId::new(), weight);

        let pad_left = kernel_size - stride;

        Self { conv, pad_left }
    }

    /// Load a causal Conv1d from SafeTensors with weight norm fusion.
    ///
    /// Expects two tensors:
    /// - `{prefix}.parametrizations.weight.original0` (g): [C_out, 1, 1]
    /// - `{prefix}.parametrizations.weight.original1` (v): [C_out, C_in, K]
    pub fn from_safetensors(
        safetensors: &SafeTensors,
        prefix: &str,
        stride: usize,
        device: &B::Device,
    ) -> Result<Self> {
        let g_name = format!("{}.parametrizations.weight.original0", prefix);
        let v_name = format!("{}.parametrizations.weight.original1", prefix);

        let g: Tensor<B, 3> =
            load_tensor(safetensors, &g_name, device).context("Loading conv g (magnitude)")?;
        let v: Tensor<B, 3> =
            load_tensor(safetensors, &v_name, device).context("Loading conv v (direction)")?;

        Ok(Self::from_weight_norm(g, v, stride, device))
    }

    /// Forward pass with causal left-padding.
    ///
    /// # Arguments
    /// * `x` - Input tensor [batch, channels, time]
    ///
    /// # Returns
    /// Output tensor [batch, C_out, time_out] where output[t] depends only on input[≤t].
    pub fn forward(&self, x: Tensor<B, 3>) -> Tensor<B, 3> {
        let [batch, channels, _time] = x.dims();

        // Left-pad with zeros
        let x = if self.pad_left > 0 {
            let pad = Tensor::zeros([batch, channels, self.pad_left], &x.device());
            Tensor::cat(vec![pad, x], 2)
        } else {
            x
        };

        self.conv.forward(x)
    }

    /// Get the left padding amount.
    pub fn pad_left(&self) -> usize {
        self.pad_left
    }
}

/// Fuse weight norm: `weight = g * v / ||v||` per output channel.
///
/// Shared between Conv1d and ConvTranspose1d. The first dimension of `v`
/// is treated as the "output channel" for norm computation (even though
/// ConvTranspose1d has shape [C_in, C_out, K]).
fn fuse_weight_norm<B: Backend>(g: Tensor<B, 3>, v: Tensor<B, 3>) -> Tensor<B, 3> {
    let [dim0, dim1, dim2] = v.dims();
    let v_flat = v.clone().reshape([dim0, dim1 * dim2]);
    let v_norm = v_flat.powf_scalar(2.0).sum_dim(1).sqrt();
    let v_norm = v_norm.unsqueeze_dim(2);
    g * v / v_norm
}

/// Causal ConvTranspose1d with weight normalization fused at load time.
///
/// For upsampling in the codec decoder. Weight norm stores weights as
/// (magnitude `g`, direction `v`), fused at load: `weight = g * v / ||v||`.
///
/// Causal output trimming: remove `(kernel_size - stride)` samples from the
/// right of the output so that output depends only on causal context.
///
/// Kernel shape: `[C_in, C_out, K]` (transposed from Conv1d's `[C_out, C_in, K]`).
pub struct CausalConvTranspose1d<B: Backend> {
    /// The underlying Burn ConvTranspose1d with fused weight-normed weights.
    conv: ConvTranspose1d<B>,
    /// Right trim amount = kernel_size - stride.
    trim_right: usize,
}

impl<B: Backend> CausalConvTranspose1d<B> {
    /// Fuse weight norm and create a causal ConvTranspose1d.
    ///
    /// # Arguments
    /// * `g` - Magnitude tensor [C_in, 1, 1]
    /// * `v` - Direction tensor [C_in, C_out, K]
    /// * `stride` - Convolution stride (upsampling factor)
    /// * `device` - Device for tensor allocation
    pub fn from_weight_norm(
        g: Tensor<B, 3>,
        v: Tensor<B, 3>,
        stride: usize,
        device: &B::Device,
    ) -> Self {
        let [c_in, c_out, kernel_size] = v.dims();

        let weight = fuse_weight_norm(g, v);

        // Create ConvTranspose1d via config, then replace weight
        let mut conv = ConvTranspose1dConfig::new([c_in, c_out], kernel_size)
            .with_stride(stride)
            .with_padding(0)
            .with_padding_out(0)
            .with_bias(false)
            .init(device);

        conv.weight = Param::initialized(ParamId::new(), weight);

        let trim_right = kernel_size - stride;

        Self { conv, trim_right }
    }

    /// Create a causal ConvTranspose1d from a pre-fused weight tensor.
    ///
    /// Used for GGUF loading where weight norms are pre-fused by the conversion script.
    ///
    /// # Arguments
    /// * `weight` - Fused weight tensor [C_in, C_out, K]
    /// * `stride` - Convolution stride (upsampling factor)
    /// * `device` - Device for tensor allocation
    pub fn from_fused_weight(weight: Tensor<B, 3>, stride: usize, device: &B::Device) -> Self {
        let [c_in, c_out, kernel_size] = weight.dims();

        let mut conv = ConvTranspose1dConfig::new([c_in, c_out], kernel_size)
            .with_stride(stride)
            .with_padding(0)
            .with_padding_out(0)
            .with_bias(false)
            .init(device);

        conv.weight = Param::initialized(ParamId::new(), weight);

        let trim_right = kernel_size - stride;

        Self { conv, trim_right }
    }

    /// Load a causal ConvTranspose1d from SafeTensors with weight norm fusion.
    ///
    /// Expects two tensors:
    /// - `{prefix}.parametrizations.weight.original0` (g): [C_in, 1, 1]
    /// - `{prefix}.parametrizations.weight.original1` (v): [C_in, C_out, K]
    pub fn from_safetensors(
        safetensors: &SafeTensors,
        prefix: &str,
        stride: usize,
        device: &B::Device,
    ) -> Result<Self> {
        let g_name = format!("{}.parametrizations.weight.original0", prefix);
        let v_name = format!("{}.parametrizations.weight.original1", prefix);

        let g: Tensor<B, 3> =
            load_tensor(safetensors, &g_name, device).context("Loading conv_t g (magnitude)")?;
        let v: Tensor<B, 3> =
            load_tensor(safetensors, &v_name, device).context("Loading conv_t v (direction)")?;

        Ok(Self::from_weight_norm(g, v, stride, device))
    }

    /// Forward pass with causal output trimming.
    ///
    /// # Arguments
    /// * `x` - Input tensor [batch, C_in, time]
    ///
    /// # Returns
    /// Output tensor [batch, C_out, time * stride] after right-trimming.
    pub fn forward(&self, x: Tensor<B, 3>) -> Tensor<B, 3> {
        let out = self.conv.forward(x);

        // Trim (K - S) samples from the right for causal behavior
        if self.trim_right > 0 {
            let [_batch, _channels, time] = out.dims();
            out.narrow(2, 0, time - self.trim_right)
        } else {
            out
        }
    }

    /// Get the right trim amount.
    pub fn trim_right(&self) -> usize {
        self.trim_right
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use burn::backend::Wgpu;
    use burn::tensor::TensorData;

    type TestBackend = Wgpu;

    #[test]
    fn test_weight_norm_fusion() {
        let device = Default::default();
        let c_out = 4;
        let c_in = 2;
        let kernel_size = 3;

        // g = [4, 1, 1] all ones (unit magnitude)
        let g = Tensor::<TestBackend, 3>::ones([c_out, 1, 1], &device);
        // v = [4, 2, 3] all ones => ||v|| per channel = sqrt(6)
        let v = Tensor::<TestBackend, 3>::ones([c_out, c_in, kernel_size], &device);

        let conv = CausalConv1d::from_weight_norm(g, v, 1, &device);

        // After fusion: weight = 1 * 1 / sqrt(6) ≈ 0.4082
        let weight_data = conv.conv.weight.to_data();
        let vals = weight_data.as_slice::<f32>().unwrap();

        let expected = 1.0 / (6.0f32).sqrt();
        for (i, &v) in vals.iter().enumerate() {
            assert!(
                (v - expected).abs() < 1e-4,
                "weight[{}] = {} (expected {})",
                i,
                v,
                expected
            );
        }
    }

    #[test]
    fn test_causal_padding_stride_1() {
        let device = Default::default();

        // Kernel=3, stride=1 => pad_left = 2
        let g = Tensor::<TestBackend, 3>::ones([4, 2, 1], &device);
        let v = Tensor::<TestBackend, 3>::ones([4, 2, 3], &device);
        let conv = CausalConv1d::from_weight_norm(g, v, 1, &device);

        assert_eq!(conv.pad_left(), 2);

        // Input [1, 2, 5] -> output should be [1, 4, 5] (same time dim for stride 1)
        let x = Tensor::<TestBackend, 3>::ones([1, 2, 5], &device);
        let out = conv.forward(x);

        assert_eq!(out.dims(), [1, 4, 5]);
    }

    #[test]
    fn test_output_shape_block0() {
        // Block 0: Conv1d [1024, 292, 3] stride 1
        let device = Default::default();
        let c_out = 8; // use small dims for test
        let c_in = 4;
        let kernel_size = 3;

        let g = Tensor::<TestBackend, 3>::ones([c_out, 1, 1], &device);
        let v = Tensor::<TestBackend, 3>::ones([c_out, c_in, kernel_size], &device);
        let conv = CausalConv1d::from_weight_norm(g, v, 1, &device);

        let x = Tensor::<TestBackend, 3>::ones([1, c_in, 20], &device);
        let out = conv.forward(x);

        // stride=1, kernel=3, pad_left=2: output time = (20 + 2 - 3)/1 + 1 = 20
        assert_eq!(out.dims(), [1, c_out, 20]);
    }

    #[test]
    fn test_output_shape_output_proj() {
        // Output proj: Conv1d [240, 1024, 7] stride 1
        let device = Default::default();
        let c_out = 8;
        let c_in = 16;
        let kernel_size = 7;

        let g = Tensor::<TestBackend, 3>::ones([c_out, 1, 1], &device);
        let v = Tensor::<TestBackend, 3>::ones([c_out, c_in, kernel_size], &device);
        let conv = CausalConv1d::from_weight_norm(g, v, 1, &device);

        assert_eq!(conv.pad_left(), 6); // 7 - 1

        let x = Tensor::<TestBackend, 3>::ones([1, c_in, 10], &device);
        let out = conv.forward(x);

        // pad_left=6: output time = (10 + 6 - 7)/1 + 1 = 10
        assert_eq!(out.dims(), [1, c_out, 10]);
    }

    #[test]
    fn test_causal_property() {
        // Verify output[t] depends only on input[≤t]
        let device = Default::default();

        let g = Tensor::<TestBackend, 3>::ones([1, 1, 1], &device);
        let v = Tensor::<TestBackend, 3>::ones([1, 1, 3], &device);
        let conv = CausalConv1d::from_weight_norm(g, v, 1, &device);

        // Run with 5-length input
        let x = Tensor::<TestBackend, 3>::from_data(
            TensorData::new(vec![1.0f32, 2.0, 3.0, 4.0, 5.0], [1, 1, 5]),
            &device,
        );
        let out_full = conv.forward(x);

        // Run with only first 3 elements
        let x_short = Tensor::<TestBackend, 3>::from_data(
            TensorData::new(vec![1.0f32, 2.0, 3.0], [1, 1, 3]),
            &device,
        );
        let out_short = conv.forward(x_short);

        let full_data = out_full.to_data();
        let short_data = out_short.to_data();
        let full_vals = full_data.as_slice::<f32>().unwrap();
        let short_vals = short_data.as_slice::<f32>().unwrap();

        // Output positions 0,1,2 should be identical regardless of future input
        for t in 0..3 {
            assert!(
                (full_vals[t] - short_vals[t]).abs() < 1e-5,
                "Causal violation at t={}: full={} short={}",
                t,
                full_vals[t],
                short_vals[t]
            );
        }
    }

    #[test]
    fn test_weight_norm_magnitude_scaling() {
        let device = Default::default();

        // g = [2.0] for each channel, v = ones
        // fused weight = 2 * 1 / sqrt(6) per element
        let g = Tensor::<TestBackend, 3>::ones([2, 1, 1], &device) * 2.0;
        let v = Tensor::<TestBackend, 3>::ones([2, 1, 3], &device);

        let conv = CausalConv1d::from_weight_norm(g, v, 1, &device);

        let weight_data = conv.conv.weight.to_data();
        let vals = weight_data.as_slice::<f32>().unwrap();

        let expected = 2.0 / (3.0f32).sqrt();
        for (i, &val) in vals.iter().enumerate() {
            assert!(
                (val - expected).abs() < 1e-4,
                "weight[{}] = {} (expected {})",
                i,
                val,
                expected
            );
        }
    }

    // --- ConvTranspose1d tests ---

    #[test]
    fn test_conv_transpose_2x_upsample() {
        // Codec upsample blocks: [C_in=1024, C_out=1024, K=4], stride=2
        let device = Default::default();
        let c_in = 8;
        let c_out = 8;
        let kernel_size = 4;
        let stride = 2;

        let g = Tensor::<TestBackend, 3>::ones([c_in, 1, 1], &device);
        let v = Tensor::<TestBackend, 3>::ones([c_in, c_out, kernel_size], &device);
        let conv_t = CausalConvTranspose1d::from_weight_norm(g, v, stride, &device);

        assert_eq!(conv_t.trim_right(), 2); // K - S = 4 - 2

        let x = Tensor::<TestBackend, 3>::ones([1, c_in, 10], &device);
        let out = conv_t.forward(x);

        // ConvTranspose1d output: (10 - 1) * 2 + 4 = 22, then trim 2 => 20
        assert_eq!(out.dims(), [1, c_out, 20]);
    }

    #[test]
    fn test_conv_transpose_output_length_formula() {
        // Verify: output_len = input_len * stride for all codec blocks
        let device = Default::default();
        let kernel_size = 4;
        let stride = 2;

        for input_len in [5, 10, 20, 50] {
            let g = Tensor::<TestBackend, 3>::ones([4, 1, 1], &device);
            let v = Tensor::<TestBackend, 3>::ones([4, 4, kernel_size], &device);
            let conv_t = CausalConvTranspose1d::from_weight_norm(g, v, stride, &device);

            let x = Tensor::<TestBackend, 3>::ones([1, 4, input_len], &device);
            let out = conv_t.forward(x);

            assert_eq!(
                out.dims()[2],
                input_len * stride,
                "output_len should be input_len * stride for input_len={}",
                input_len
            );
        }
    }

    #[test]
    fn test_conv_transpose_weight_norm_fusion() {
        let device = Default::default();

        // g = ones [C_in, 1, 1], v = ones [C_in, C_out, K]
        // ||v|| per channel = sqrt(C_out * K) = sqrt(2 * 4) = sqrt(8)
        let g = Tensor::<TestBackend, 3>::ones([3, 1, 1], &device);
        let v = Tensor::<TestBackend, 3>::ones([3, 2, 4], &device);
        let conv_t = CausalConvTranspose1d::from_weight_norm(g, v, 2, &device);

        let weight_data = conv_t.conv.weight.to_data();
        let vals = weight_data.as_slice::<f32>().unwrap();

        let expected = 1.0 / (8.0f32).sqrt();
        for (i, &val) in vals.iter().enumerate() {
            assert!(
                (val - expected).abs() < 1e-4,
                "weight[{}] = {} (expected {})",
                i,
                val,
                expected
            );
        }
    }

    #[test]
    fn test_conv_transpose_batch_independence() {
        let device = Default::default();

        let g = Tensor::<TestBackend, 3>::ones([4, 1, 1], &device);
        let v = Tensor::<TestBackend, 3>::ones([4, 4, 4], &device);
        let conv_t = CausalConvTranspose1d::from_weight_norm(g, v, 2, &device);

        // Process batch of 2 and verify each is independent
        let x1 = Tensor::<TestBackend, 3>::ones([1, 4, 5], &device);
        let x2 = Tensor::<TestBackend, 3>::ones([1, 4, 5], &device) * 2.0;
        let x_batch = Tensor::cat(vec![x1.clone(), x2.clone()], 0);

        let out_batch = conv_t.forward(x_batch);
        let out1 = conv_t.forward(x1);
        let out2 = conv_t.forward(x2);

        let batch_data = out_batch.to_data();
        let out1_data = out1.to_data();
        let out2_data = out2.to_data();
        let batch_vals = batch_data.as_slice::<f32>().unwrap();
        let out1_vals = out1_data.as_slice::<f32>().unwrap();
        let out2_vals = out2_data.as_slice::<f32>().unwrap();

        let n = out1_vals.len();
        for i in 0..n {
            assert!(
                (batch_vals[i] - out1_vals[i]).abs() < 1e-5,
                "Batch[0] mismatch at {}",
                i
            );
            assert!(
                (batch_vals[n + i] - out2_vals[i]).abs() < 1e-5,
                "Batch[1] mismatch at {}",
                i
            );
        }
    }

    #[test]
    fn test_conv_transpose_chained_8x_upsample() {
        // Three ConvTranspose1d in sequence: 2x * 2x * 2x = 8x
        let device = Default::default();
        let dim = 4;
        let kernel_size = 4;
        let stride = 2;
        let input_len = 10;

        let mut x = Tensor::<TestBackend, 3>::ones([1, dim, input_len], &device);
        for _ in 0..3 {
            let g = Tensor::<TestBackend, 3>::ones([dim, 1, 1], &device);
            let v = Tensor::<TestBackend, 3>::ones([dim, dim, kernel_size], &device);
            let conv_t = CausalConvTranspose1d::from_weight_norm(g, v, stride, &device);
            x = conv_t.forward(x);
        }

        // 10 * 2 * 2 * 2 = 80
        assert_eq!(x.dims(), [1, dim, 80]);
    }
}
