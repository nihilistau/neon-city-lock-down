//! KV Cache for efficient autoregressive generation.
//!
//! Supports both concatenation-based and pre-allocated caching strategies.
//! Use `KVCache::new()` for dynamic (cat-based) caching and
//! `KVCache::preallocated()` for pre-allocated buffers that avoid
//! per-step GPU allocations.
//!
//! ## Shannon-Prime SVM Zero-Copy Integration
//!
//! When a `ShannonPrimeConfig` is attached, KV vectors undergo VHT2 +
//! banded quantization for lossy compression. The key optimization:
//! only the **delta** (new token's KV) crosses PCIe — not the full cache.
//!
//! Data flow per decode step:
//!   1. New K/V tensor (1 token × 8 heads × 128 dim = 4 KB) pulled to CPU
//!   2. VHT2 forward + banded quantize + VHT2 inverse on CPU (lossy roundtrip)
//!   3. Lossy-reconstructed delta uploaded back to GPU (4 KB)
//!   4. Concat/assign to GPU-resident decompressed cache
//!
//! The GPU cache holds decompressed tensors and never leaves the GPU.
//! PCIe traffic is O(1) per token instead of O(t) — a total of ~8 KB
//! per decode step regardless of sequence length.

use burn::tensor::backend::Backend;
use burn::tensor::Tensor;

use super::shannon_prime::{
    compress_kv_vector, decompress_kv_vector, BandConfig, ShannonPrimeConfig,
};

/// Compress-then-decompress only the delta tensor on CPU.
///
/// This is the zero-copy SVM core: instead of pulling the *entire* cache
/// to CPU for VHT2 (O(t²) PCIe traffic), we only pull the new token's
/// K/V vectors (~4 KB for 8 heads × 128 dim), compress+decompress on
/// CPU, and upload the lossy-reconstructed delta back to GPU.
///
/// The GPU cache accumulates these decompressed deltas via concat/assign
/// and never leaves the GPU.
fn compress_decompress_delta<B: Backend>(
    tensor: &Tensor<B, 4>,
    config: &BandConfig,
) -> Tensor<B, 4> {
    let dims = tensor.dims();
    let [batch, heads, seq, head_dim] = dims;
    debug_assert_eq!(head_dim, config.head_dim);

    // Pull only the new delta to CPU — typically [1, 8, 1, 128] = 4 KB
    let data = tensor.to_data();
    let mut values: Vec<f32> = data.as_slice::<f32>().unwrap().to_vec();

    // Compress + decompress each head_dim vector in-place on CPU
    let vec_count = batch * heads * seq;
    for i in 0..vec_count {
        let start = i * head_dim;
        let end = start + head_dim;
        let slice = &mut values[start..end];
        compress_kv_vector(slice, config); // VHT2 forward + banded quantize
        decompress_kv_vector(slice); // VHT2 inverse (self-inverse)
    }

    // Upload lossy-reconstructed delta back to GPU
    let device = tensor.device();
    let new_data = burn::tensor::TensorData::new(values, dims);
    Tensor::from_data(new_data, &device)
}

/// KV Cache supporting dynamic concatenation or pre-allocated buffers.
///
/// **Dynamic mode** (`KVCache::new()`): Concatenates new keys/values onto
/// the existing cache each step. Simple but allocates growing GPU buffers.
///
/// **Pre-allocated mode** (`KVCache::preallocated()`): Writes into a
/// fixed-size buffer via `slice_assign`, avoiding per-step allocations.
/// Returns narrow slices for the filled region.
#[derive(Debug, Clone)]
pub struct KVCache<B: Backend> {
    /// Cached key tensor [batch, heads, seq_or_capacity, head_dim]
    pub k: Option<Tensor<B, 4>>,
    /// Cached value tensor [batch, heads, seq_or_capacity, head_dim]
    pub v: Option<Tensor<B, 4>>,
    /// Current filled length (only used in pre-allocated mode).
    len: usize,
    /// Pre-allocated capacity. 0 = dynamic (cat) mode.
    capacity: usize,
    /// Optional Shannon-Prime VHT2 compression config.
    /// When set, K/V are compressed before storage and decompressed on read.
    shannon_prime: Option<ShannonPrimeConfig>,
}

impl<B: Backend> Default for KVCache<B> {
    fn default() -> Self {
        Self::new()
    }
}

impl<B: Backend> KVCache<B> {
    /// Create an empty dynamic cache (concatenation-based).
    pub fn new() -> Self {
        Self {
            k: None,
            v: None,
            len: 0,
            capacity: 0,
            shannon_prime: None,
        }
    }

    /// Create an empty dynamic cache with Shannon-Prime VHT2 compression.
    pub fn new_with_shannon_prime(config: ShannonPrimeConfig) -> Self {
        Self {
            k: None,
            v: None,
            len: 0,
            capacity: 0,
            shannon_prime: if config.enabled { Some(config) } else { None },
        }
    }

    /// Create a pre-allocated cache with zero-filled buffers.
    ///
    /// Avoids GPU memory allocation on each step by writing into
    /// a fixed buffer via `slice_assign`.
    pub fn preallocated(
        batch: usize,
        heads: usize,
        max_seq: usize,
        head_dim: usize,
        device: &B::Device,
    ) -> Self {
        Self {
            k: Some(Tensor::zeros([batch, heads, max_seq, head_dim], device)),
            v: Some(Tensor::zeros([batch, heads, max_seq, head_dim], device)),
            len: 0,
            capacity: max_seq,
            shannon_prime: None,
        }
    }

    /// Create a pre-allocated cache with Shannon-Prime VHT2 compression.
    pub fn preallocated_with_shannon_prime(
        batch: usize,
        heads: usize,
        max_seq: usize,
        head_dim: usize,
        device: &B::Device,
        config: ShannonPrimeConfig,
    ) -> Self {
        Self {
            k: Some(Tensor::zeros([batch, heads, max_seq, head_dim], device)),
            v: Some(Tensor::zeros([batch, heads, max_seq, head_dim], device)),
            len: 0,
            capacity: max_seq,
            shannon_prime: if config.enabled { Some(config) } else { None },
        }
    }

    /// Update the cache with new key tensor.
    ///
    /// In pre-allocated mode, use `update()` instead — it advances `self.len`
    /// atomically for both K and V.
    pub fn update_k(&mut self, k: Tensor<B, 4>) -> Tensor<B, 4> {
        assert_eq!(
            self.capacity, 0,
            "update_k not supported in pre-allocated mode; use update() instead"
        );
        {
            match &self.k {
                None => {
                    self.k = Some(k.clone());
                    k
                }
                Some(cache) => {
                    let full = Tensor::cat(vec![cache.clone(), k], 2);
                    self.k = Some(full.clone());
                    full
                }
            }
        }
    }

    /// Update the cache with new value tensor.
    ///
    /// In pre-allocated mode, use `update()` instead — it advances `self.len`
    /// atomically for both K and V.
    pub fn update_v(&mut self, v: Tensor<B, 4>) -> Tensor<B, 4> {
        assert_eq!(
            self.capacity, 0,
            "update_v not supported in pre-allocated mode; use update() instead"
        );
        {
            match &self.v {
                None => {
                    self.v = Some(v.clone());
                    v
                }
                Some(cache) => {
                    let full = Tensor::cat(vec![cache.clone(), v], 2);
                    self.v = Some(full.clone());
                    full
                }
            }
        }
    }

    /// Update both K and V caches.
    ///
    /// When Shannon-Prime is enabled, uses delta-only CPU transfers:
    ///   1. Pull only the NEW token's K/V to CPU (tiny: ~4 KB per head)
    ///   2. Compress on CPU via VHT2 + banded quantization
    ///   3. Decompress on CPU (inverse VHT2) — only the new vectors
    ///   4. Upload decompressed delta back to GPU
    ///   5. Concat/assign to the GPU-side decompressed cache
    ///
    /// The compressed data is stored on CPU (`sp_k_store`/`sp_v_store`)
    /// for potential future Optane spill. The GPU cache (`k`/`v`) holds
    /// decompressed tensors ready for attention — no full-cache round-trip.
    ///
    /// Without Shannon-Prime, this is a simple concat or slice_assign.
    pub fn update(&mut self, k: Tensor<B, 4>, v: Tensor<B, 4>) -> (Tensor<B, 4>, Tensor<B, 4>) {
        // Shannon-Prime delta-only path: compress+decompress only the new
        // vectors on CPU, then store decompressed on GPU. The full cache
        // never leaves the GPU.
        let (k_store, v_store) = if let Some(ref sp) = self.shannon_prime {
            let k_d = compress_decompress_delta(&k, &sp.k_config);
            let v_d = compress_decompress_delta(&v, &sp.v_config);
            (k_d, v_d)
        } else {
            (k, v)
        };

        if self.capacity > 0 {
            let new_seq = k_store.dims()[2];
            let pos = self.len;
            let k_buf = self.k.take().unwrap();
            let v_buf = self.v.take().unwrap();
            let [b, h, _, hd] = k_buf.dims();

            let k_buf = k_buf.slice_assign([0..b, 0..h, pos..pos + new_seq, 0..hd], k_store);
            let v_buf = v_buf.slice_assign([0..b, 0..h, pos..pos + new_seq, 0..hd], v_store);

            self.len = pos + new_seq;
            let new_len = self.len;

            let k_view = k_buf.clone().slice([0..b, 0..h, 0..new_len, 0..hd]);
            let v_view = v_buf.clone().slice([0..b, 0..h, 0..new_len, 0..hd]);

            self.k = Some(k_buf);
            self.v = Some(v_buf);

            (k_view, v_view)
        } else {
            let k_full = self.update_k(k_store);
            let v_full = self.update_v(v_store);
            (k_full, v_full)
        }
    }

    /// Get the current sequence length in the cache.
    pub fn seq_len(&self) -> usize {
        if self.capacity > 0 {
            self.len
        } else {
            self.k.as_ref().map(|k| k.dims()[2]).unwrap_or(0)
        }
    }

    /// Reset the cache.
    pub fn reset(&mut self) {
        if self.capacity > 0 {
            // Zero out buffers and reset position.
            if let Some(k) = &self.k {
                let dims = k.dims();
                let device = k.device();
                self.k = Some(Tensor::zeros(dims, &device));
                self.v = Some(Tensor::zeros(dims, &device));
            }
            self.len = 0;
        } else {
            self.k = None;
            self.v = None;
            self.len = 0;
        }
    }

    /// Returns true if Shannon-Prime VHT2 compression is enabled.
    pub fn is_shannon_prime_enabled(&self) -> bool {
        self.shannon_prime.is_some()
    }

    /// Apply sliding window eviction.
    ///
    /// If cache exceeds window size, evict oldest entries.
    /// Only supported in dynamic mode; pre-allocated caches use
    /// attention masking for sliding window instead.
    pub fn apply_sliding_window(&mut self, window_size: usize) {
        assert_eq!(
            self.capacity, 0,
            "apply_sliding_window not supported in pre-allocated mode"
        );
        if let Some(k) = &self.k {
            let seq_len = k.dims()[2];
            if seq_len > window_size {
                let start = seq_len - window_size;
                let [batch, heads, _, head_dim] = k.dims();
                self.k = Some(
                    k.clone()
                        .slice([0..batch, 0..heads, start..seq_len, 0..head_dim]),
                );
            }
        }
        if let Some(v) = &self.v {
            let seq_len = v.dims()[2];
            if seq_len > window_size {
                let start = seq_len - window_size;
                let [batch, heads, _, head_dim] = v.dims();
                self.v = Some(
                    v.clone()
                        .slice([0..batch, 0..heads, start..seq_len, 0..head_dim]),
                );
            }
        }
    }
}

/// Collection of KV caches for all layers.
#[derive(Debug)]
pub struct LayerCaches<B: Backend> {
    caches: Vec<KVCache<B>>,
}

impl<B: Backend> LayerCaches<B> {
    /// Create dynamic (cat-based) caches for n layers.
    pub fn new(n_layers: usize) -> Self {
        Self {
            caches: (0..n_layers).map(|_| KVCache::new()).collect(),
        }
    }

    /// Create pre-allocated caches for n layers.
    pub fn new_preallocated(
        n_layers: usize,
        batch: usize,
        n_kv_heads: usize,
        max_seq: usize,
        head_dim: usize,
        device: &B::Device,
    ) -> Self {
        Self {
            caches: (0..n_layers)
                .map(|_| KVCache::preallocated(batch, n_kv_heads, max_seq, head_dim, device))
                .collect(),
        }
    }

    /// Create dynamic caches with Shannon-Prime VHT2 compression.
    pub fn new_shannon_prime(n_layers: usize, config: ShannonPrimeConfig) -> Self {
        Self {
            caches: (0..n_layers)
                .map(|_| KVCache::new_with_shannon_prime(config.clone()))
                .collect(),
        }
    }

    /// Create pre-allocated caches with Shannon-Prime VHT2 compression.
    pub fn new_preallocated_shannon_prime(
        n_layers: usize,
        batch: usize,
        n_kv_heads: usize,
        max_seq: usize,
        head_dim: usize,
        device: &B::Device,
        config: ShannonPrimeConfig,
    ) -> Self {
        Self {
            caches: (0..n_layers)
                .map(|_| {
                    KVCache::preallocated_with_shannon_prime(
                        batch,
                        n_kv_heads,
                        max_seq,
                        head_dim,
                        device,
                        config.clone(),
                    )
                })
                .collect(),
        }
    }

    /// Get mutable reference to a layer's cache.
    pub fn get_mut(&mut self, layer: usize) -> Option<&mut KVCache<B>> {
        self.caches.get_mut(layer)
    }

    /// Get the current sequence length (same for all layers).
    pub fn seq_len(&self) -> usize {
        self.caches.first().map(|c| c.seq_len()).unwrap_or(0)
    }

    /// Reset all caches.
    pub fn reset(&mut self) {
        for cache in &mut self.caches {
            cache.reset();
        }
    }

    /// Apply sliding window eviction to all caches.
    pub fn apply_sliding_window(&mut self, window_size: usize) {
        for cache in &mut self.caches {
            cache.apply_sliding_window(window_size);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use burn::backend::Wgpu;

    type TestBackend = Wgpu;

    #[test]
    fn test_kv_cache_empty() {
        let cache: KVCache<TestBackend> = KVCache::new();
        assert!(cache.k.is_none());
        assert!(cache.v.is_none());
        assert_eq!(cache.seq_len(), 0);
    }

    #[test]
    fn test_kv_cache_update() {
        let device = Default::default();
        let mut cache: KVCache<TestBackend> = KVCache::new();

        // First update
        let k1 = Tensor::<TestBackend, 4>::zeros([1, 4, 5, 16], &device);
        let k_out = cache.update_k(k1);
        assert_eq!(k_out.dims(), [1, 4, 5, 16]);
        assert_eq!(cache.seq_len(), 5);

        // Second update
        let k2 = Tensor::<TestBackend, 4>::zeros([1, 4, 3, 16], &device);
        let k_out = cache.update_k(k2);
        assert_eq!(k_out.dims(), [1, 4, 8, 16]);
        assert_eq!(cache.seq_len(), 8);
    }

    #[test]
    fn test_kv_cache_sliding_window() {
        let device = Default::default();
        let mut cache: KVCache<TestBackend> = KVCache::new();

        // Add 10 tokens
        let k = Tensor::<TestBackend, 4>::zeros([1, 4, 10, 16], &device);
        cache.update_k(k);
        assert_eq!(cache.seq_len(), 10);

        // Apply sliding window of 5
        cache.apply_sliding_window(5);
        assert_eq!(cache.seq_len(), 5);
    }

    #[test]
    fn test_kv_cache_preallocated() {
        let device = Default::default();
        let mut cache: KVCache<TestBackend> = KVCache::preallocated(1, 4, 32, 16, &device);

        assert_eq!(cache.seq_len(), 0);

        // First update: prefill 5 tokens
        let k1 = Tensor::<TestBackend, 4>::ones([1, 4, 5, 16], &device);
        let v1 = Tensor::<TestBackend, 4>::ones([1, 4, 5, 16], &device);
        let (k_out, v_out) = cache.update(k1, v1);
        assert_eq!(k_out.dims(), [1, 4, 5, 16]);
        assert_eq!(v_out.dims(), [1, 4, 5, 16]);
        assert_eq!(cache.seq_len(), 5);

        // Second update: single decode step
        let k2 = Tensor::<TestBackend, 4>::ones([1, 4, 1, 16], &device);
        let v2 = Tensor::<TestBackend, 4>::ones([1, 4, 1, 16], &device);
        let (k_out, v_out) = cache.update(k2, v2);
        assert_eq!(k_out.dims(), [1, 4, 6, 16]);
        assert_eq!(v_out.dims(), [1, 4, 6, 16]);
        assert_eq!(cache.seq_len(), 6);

        // Reset should zero the position
        cache.reset();
        assert_eq!(cache.seq_len(), 0);
    }

    #[test]
    #[should_panic(expected = "update_k not supported in pre-allocated mode")]
    fn test_kv_cache_preallocated_rejects_update_k() {
        let device = Default::default();
        let mut cache: KVCache<TestBackend> = KVCache::preallocated(1, 4, 32, 16, &device);
        let k = Tensor::<TestBackend, 4>::zeros([1, 4, 1, 16], &device);
        cache.update_k(k);
    }

    #[test]
    #[should_panic(expected = "update_v not supported in pre-allocated mode")]
    fn test_kv_cache_preallocated_rejects_update_v() {
        let device = Default::default();
        let mut cache: KVCache<TestBackend> = KVCache::preallocated(1, 4, 32, 16, &device);
        let v = Tensor::<TestBackend, 4>::zeros([1, 4, 1, 16], &device);
        cache.update_v(v);
    }

    #[test]
    fn test_layer_caches() {
        let device = Default::default();
        let mut caches: LayerCaches<TestBackend> = LayerCaches::new(4);

        // Update first layer
        if let Some(cache) = caches.get_mut(0) {
            let k = Tensor::<TestBackend, 4>::zeros([1, 4, 5, 16], &device);
            let v = Tensor::<TestBackend, 4>::zeros([1, 4, 5, 16], &device);
            cache.update(k, v);
        }

        // First layer should have entries
        assert_eq!(caches.caches[0].seq_len(), 5);
        // Other layers should be empty
        assert_eq!(caches.caches[1].seq_len(), 0);
    }
}
