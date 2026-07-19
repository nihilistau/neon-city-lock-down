//! Shannon-Prime SVM Engine
//!
//! Orchestrates inference across CPU and iGPU using shared virtual memory
//! (SVM) on Intel NUC Beast Canyon and similar UMA architectures.
//!
//! The engine treats CPU and iGPU as a single compute fabric:
//! - **iGPU (Xe):** Q4 matmul, attention, FFN via Vulkan compute shaders
//! - **CPU (AVX-512):** VHT2 butterfly transform for KV cache compression
//! - **Shared L3 (24MB):** Compressed KV cache — zero-copy between both sides
//!
//! On discrete GPU systems, the engine falls back to standard single-device
//! operation but still benefits from Shannon-Prime KV compression (reducing
//! GPU memory pressure and PCIe transfer volume).

#[cfg(feature = "wgpu")]
pub mod svm;

/// Engine configuration.
#[derive(Debug, Clone)]
pub struct EngineConfig {
    /// Use integrated GPU for zero-copy SVM operation.
    pub use_integrated_gpu: bool,
    /// Enable Shannon-Prime VHT2 KV cache compression.
    pub shannon_prime: bool,
    /// Head dimension for VHT2 (must be power of 2).
    pub head_dim: usize,
    /// Optional Optane device path for tier-2 KV cache spill.
    pub optane_path: Option<std::path::PathBuf>,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            use_integrated_gpu: false,
            shannon_prime: false,
            head_dim: 128,
            optane_path: None,
        }
    }
}

impl EngineConfig {
    /// Config for Intel NUC Beast Canyon SVM operation.
    pub fn nuc_svm() -> Self {
        Self {
            use_integrated_gpu: true,
            shannon_prime: true,
            head_dim: 128,
            optane_path: None,
        }
    }

    /// Config for discrete GPU with Shannon-Prime compression.
    pub fn discrete_with_compression() -> Self {
        Self {
            use_integrated_gpu: false,
            shannon_prime: true,
            head_dim: 128,
            optane_path: None,
        }
    }

    /// Set the Optane M10 device path for tier-2 KV cache spill.
    pub fn with_optane(mut self, path: std::path::PathBuf) -> Self {
        self.optane_path = Some(path);
        self
    }
}
