//! SVM (Shared Virtual Memory) engine implementation.
//!
//! On UMA architectures (Intel NUC Beast Canyon, Android SoCs), CPU and iGPU
//! share the same physical memory. This module exploits that by:
//!
//! 1. Running Q4 matmul on iGPU via `WgpuDevice::IntegratedGpu(0)`
//! 2. Running VHT2 compression on CPU via AVX-512/AVX2
//! 3. Keeping compressed KV cache in shared L3 cache (zero-copy)
//!
//! The key insight: `Tensor::to_data()` and `Tensor::from_data()` on a UMA
//! system are effectively free — the data never leaves shared memory.

use burn::backend::wgpu::WgpuDevice;

/// Select the appropriate WgpuDevice for SVM operation.
///
/// Returns `WgpuDevice::IntegratedGpu(0)` for zero-copy SVM mode.
/// On systems without an integrated GPU, wgpu will fall back gracefully.
pub fn select_svm_device() -> WgpuDevice {
    tracing::info!("SVM engine: selecting integrated GPU for zero-copy mode");
    WgpuDevice::IntegratedGpu(0)
}

/// Select device by name for CLI usage.
pub fn select_device(name: &str) -> WgpuDevice {
    match name {
        "integrated" => {
            tracing::info!("Using integrated GPU (SVM zero-copy mode)");
            WgpuDevice::IntegratedGpu(0)
        }
        "discrete" => {
            tracing::info!("Using discrete GPU");
            WgpuDevice::DiscreteGpu(0)
        }
        _ => WgpuDevice::DefaultDevice,
    }
}

/// Estimate KV cache memory for a given configuration.
///
/// Returns (uncompressed_bytes, compressed_bytes) for the full decoder KV cache.
pub fn estimate_kv_memory(
    n_layers: usize,
    n_kv_heads: usize,
    head_dim: usize,
    seq_len: usize,
) -> (usize, usize) {
    // Each KV entry: [batch=1, n_kv_heads, seq_len, head_dim] × f32
    let per_tensor = n_kv_heads * seq_len * head_dim * 4; // 4 bytes per f32
    let uncompressed = n_layers * 2 * per_tensor; // K + V per layer
                                                  // Shannon-Prime ~4.6x compression
    let compressed = uncompressed * 100 / 460;
    (uncompressed, compressed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kv_memory_estimate() {
        // Voxtral decoder: 26 layers, 8 KV heads, head_dim=128, 200 tokens
        let (uncomp, comp) = estimate_kv_memory(26, 8, 128, 200);
        // 26 × 2 × 8 × 200 × 128 × 4 = 42,598,400 bytes ≈ 40.6 MB
        assert_eq!(uncomp, 42_598_400);
        // Compressed: ~9.3 MB
        assert!(comp < uncomp / 4);
        assert!(comp > uncomp / 5);
    }

    #[test]
    fn test_l3_cache_capacity() {
        // How many tokens fit in 24MB L3 with Shannon-Prime compression?
        let l3_size = 24 * 1024 * 1024; // 24 MB
        let (_, compressed_per_token) = estimate_kv_memory(26, 8, 128, 1);
        let tokens_in_l3 = l3_size / compressed_per_token;
        // Should fit ~500+ compressed tokens
        assert!(
            tokens_in_l3 > 400,
            "Expected >400 tokens in L3, got {}",
            tokens_in_l3
        );
    }
}
