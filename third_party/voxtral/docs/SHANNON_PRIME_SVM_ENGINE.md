# Shannon-Prime SVM Engine — Architecture

**Target:** Intel NUC Beast Canyon (NUC11BTMi9)  
**Date:** 2026-05-06  
**Status:** Implemented (`src/l0/`, branch `svm-zero-copy`)

## Measured Performance

| Mode | Encode | Decode (steady) | Total RTF | Notes |
|------|--------|-----------------|-----------|-------|
| L0 Hybrid | 1,217 ms | 229 ms/tok | 4.98 | RTX encode → L0 iGPU decode |
| L0 Decode-only | — | 229 ms/tok | 2.87 | Pure iGPU, no encoder overhead |
| wgpu iGPU | 26,756 ms | ~1200 ms/tok | 14.80 | Same hardware, 5.2x slower |

The 5.2x improvement comes from eliminating wgpu's staging buffer overhead on UMA hardware. Level Zero USM gives true zero-copy: the same `*mut f32` pointer is accessed by CPU (VHT2) and GPU (Q4 matmul) with no intermediary.

---

## Executive Summary

The Shannon-Prime SVM Engine reimagines the Voxtral inference pipeline to exploit the Intel NUC Beast Canyon's unified memory architecture. Instead of treating CPU and iGPU as separate devices connected by a bus (like a discrete GPU over PCIe), it treats them as a single compute fabric sharing the same physical memory through Intel's Shared Virtual Memory (SVM). Shannon-Prime VHT2 compression becomes the glue — CPU cores run the spectral transform (VHT2 butterfly stages map perfectly to AVX-512), while the iGPU runs Q4 matrix multiplications through Vulkan compute shaders. The compressed KV cache lives in the shared 24MB L3 cache, accessible to both sides with zero memcpy.

The Optane M10 serves as a tier-2 spill buffer for long-sequence KV cache, offering ~10μs access latency (10x faster than commodity NVMe) and byte-addressable access through mmap.

This mirrors the DSP engine architecture on Android, where the CPU↔SVM↔iGPU path provides deterministic low-latency compute without the variability of discrete GPU scheduling.

## Hardware Profile

| Component | Spec | Role |
|-----------|------|------|
| CPU | Intel Core i9-11900KB (8C/16T, 3.3-4.9 GHz) | VHT2 transform, mel extraction, tokenization, cache management |
| iGPU | Intel UHD Graphics (Xe, 32 EU) | Q4 matmul, attention, FFN via compute shaders |
| L3 Cache | 24 MB (shared CPU↔iGPU) | Hot KV cache tier — ~533 compressed tokens |
| DRAM | DDR4-3200 (up to 64 GB) | Warm KV cache tier, model weights |
| Optane M10 | Intel Optane (~16-32 GB, ~10μs latency) | Cold KV cache spill, model weight staging |
| SVM | Intel VT-d / OpenCL 2.0 SVM | Zero-copy pointer sharing between CPU and iGPU |

### Why SVM Changes Everything

On a discrete GPU system (RTX 2060), every tensor transfer between CPU and GPU crosses PCIe:
- PCIe 3.0 x16: ~12 GB/s theoretical, ~8 GB/s practical
- Each KV cache update requires GPU→CPU→GPU round-trip for VHT2 compression
- Latency: ~5-10μs per transfer + DMA setup overhead
- This kills autoregressive decoding (26 layers × 2 transfers × ~200 tokens)

On the NUC Beast Canyon with SVM:
- CPU and iGPU share the same physical DRAM
- L3 cache is coherent between CPU cores and iGPU execution units
- Zero-copy: a pointer valid on CPU is valid on iGPU — no memcpy, no DMA
- VHT2-compressed KV vectors stay in L3 and are accessed directly by both sides
- Latency: ~1-3ns (L3 hit) vs ~50ns (DRAM) vs ~10μs (Optane)

## Pipeline Architecture

### Phase 1: Audio Preprocessing (CPU only)

```
Audio (16kHz PCM) → Peak normalize (0.95) → Pad (76 tokens)
  → Mel spectrogram (128 bins, hop 160) → [1, 128, T] tensor
```

All CPU, uses AVX-512 for FFT and mel filterbank. Output tensor is in shared memory — iGPU sees it immediately.

### Phase 2: Encoder Forward Pass (iGPU)

```
Mel [1, 128, T] → Conv downsample → [1, T/4, 1280]
  → 32 × EncoderLayer (MHA 32 heads, sliding window 750)
  → RMSNorm → [1, T/4, 1280]
```

Runs entirely on iGPU via Vulkan compute shaders. The Q4 matmul shader (`shader.wgsl`) handles all linear projections. Encoder doesn't use KV cache (or uses it minimally), so Shannon-Prime compression isn't needed here.

### Phase 3: Adapter (iGPU)

```
Reshape [1, T/4, 1280] → [1, T/16, 5120]
  → Linear 5120→3072 → GELU → Linear 3072→3072
  → [1, T/16, 3072]
```

Two Q4 matmuls on iGPU. Small and fast.

### Phase 4: Autoregressive Decode (CPU↔iGPU interleaved)

This is where Shannon-Prime SVM shines. Each decode step:

```
For each token position pos in PREFIX_LEN+1..seq_len:
  
  1. Embed token (CPU)
     └─ embed_tokens_from_ids — Q4 byte lookup on CPU, result in shared mem
  
  2. Add audio embedding (iGPU or CPU)
     └─ audio_pos + text_embed — elementwise add
  
  3. For each of 26 decoder layers:
     a. RMSNorm + ADA modulation (iGPU)
     b. QKV projection (iGPU — Q4 matmul)
        └─ Q/K/V tensors land in shared memory
     
     c. ★ VHT2 compress K, V (CPU — AVX-512)
        └─ CPU reads K,V from shared mem (L3 hit — zero copy)
        └─ VHT2 butterfly: 7 stages × 128 dim, ~50ns per vector
        └─ Band quantize: K at 5/5/4/3 bits, V at 3 bits
        └─ Writes compressed KV back to shared mem (still in L3)
     
     d. KV cache concat (CPU)
        └─ Append compressed K,V to cache (in shared mem)
     
     e. ★ VHT2 decompress full cache (CPU — AVX-512)
        └─ Decompress all cached K,V for attention
        └─ Or: only decompress sliding window of recent entries
     
     f. Attention scores (iGPU)
        └─ Q @ K^T — reads decompressed K from shared mem
        └─ Softmax + sliding window mask
        └─ Attn @ V — reads decompressed V from shared mem
     
     g. Output projection (iGPU — Q4 matmul)
     h. FFN (iGPU — Q4 matmul × 2)
  
  4. LM head (iGPU — Q4 matmul against vocab)
  5. Argmax → next token (CPU)
```

### Why This Is Fast

The key insight: **VHT2 is embarrassingly parallel and tiny**. For head_dim=128:

- Each VHT2 transform: 7 stages × 64 butterflies = 448 multiply-adds
- Per KV head per layer: 2 vectors × 448 = 896 ops
- Per decode step (all layers): 26 × 8 KV heads × 896 = ~186K ops
- At 4.9 GHz with AVX-512 (32 FP32/cycle): **~1.2μs per decode step for VHT2**

Compare to the Q4 matmul for a single decoder layer's QKV projection:
- [1, 1, 3072] × [3072, 4096] = ~12.6M multiply-adds → ~100μs on iGPU

VHT2 compression adds <2% overhead to decode time, but keeps the KV cache 4.6x smaller, meaning:
- 4.6x more tokens fit in L3 before spilling to DRAM
- 4.6x more tokens fit in DRAM before spilling to Optane
- Attention Q@K^T reads 4.6x less data (compressed, then decompressed in-place)

### Memory Tiering with Optane M10

```
Tier 0: L3 Cache (24 MB)     — ~533 compressed tokens — ~1-3ns access
Tier 1: DRAM (up to 64 GB)   — ~1.4M compressed tokens — ~50ns access
Tier 2: Optane M10 (16-32 GB) — ~355K-710K compressed tokens — ~10μs access
```

For Voxtral ASR with typical utterances (<30s → ~375 tokens), the entire KV cache fits in L3. Even for long-form transcription (5 minutes → ~3750 tokens), compressed KV fits in ~170MB of DRAM — Optane isn't needed.

Optane becomes valuable for:
- TTS with very long outputs
- Multi-stream concurrent inference (multiple audio files)
- Model weight staging (preload Q4 weights from Optane to DRAM at boot)

### Optane Integration

```rust
// Optane tier managed via mmap
use std::os::unix::io::AsRawFd;

struct OptaneKVStore {
    mmap: memmap2::MmapMut,      // Optane file, mmap'd
    page_size: usize,             // 4KB pages of compressed KV
    hot_pages: HashSet<usize>,    // Pages currently in L3/DRAM
    compression: ShannonPrimeConfig,
}

impl OptaneKVStore {
    /// Spill cold KV pages to Optane
    fn spill(&mut self, page_idx: usize, data: &[f32]) {
        // Already VHT2-compressed — just memcpy to mmap region
        let offset = page_idx * self.page_size;
        let bytes = bytemuck::cast_slice(data);
        self.mmap[offset..offset + bytes.len()].copy_from_slice(bytes);
    }
    
    /// Fetch cold KV pages from Optane (prefetch-friendly)
    fn fetch(&self, page_idx: usize) -> &[f32] {
        let offset = page_idx * self.page_size;
        let bytes = &self.mmap[offset..offset + self.page_size];
        bytemuck::cast_slice(bytes)
    }
}
```

## Implementation Plan

### Phase 1: Multi-Device Foundation

**Goal:** Load encoder on iGPU, decoder on iGPU, VHT2 on CPU. Prove zero-copy works.

1. Add `--device` CLI flag: `integrated`, `discrete`, `auto`
2. Create `SvmEngine` struct that holds two `WgpuDevice` handles (or one for NUC)
3. Modify `Q4ModelLoader` to accept a `WgpuDevice` parameter (already does — just wire it)
4. Test: `WgpuDevice::IntegratedGpu(0)` on NUC, verify Vulkan adapter is selected

```rust
// In transcribe.rs
let device = match args.device.as_deref() {
    Some("integrated") => WgpuDevice::IntegratedGpu(0),
    Some("discrete") => WgpuDevice::DiscreteGpu(0),
    _ => WgpuDevice::DefaultDevice,
};
```

### Phase 2: Shannon-Prime KV Cache in Q4 Pipeline

**Goal:** Wire `ShannonPrimeKVCache` into the actual Q4 decode loop.

Currently, `ShannonPrimeKVCache` exists but isn't used by `Q4Attention::forward_with_cache` — it uses plain `KVCache`. Changes needed:

1. Replace `KVCache<Wgpu>` with `ShannonPrimeKVCache<Wgpu>` in `Q4DecoderLayer`
2. Add config flag: `--shannon-prime` to enable compression
3. The compress/decompress already works on CPU via `to_data()` / `from_data()` — this is the SVM path! On NUC, `to_data()` reads from shared memory, VHT2 runs on CPU, `from_data()` writes back to shared memory. No copies.

```rust
// In Q4Attention::forward_with_cache
// Before:
let (k, v) = cache.update(k, v);
// After:
let (k, v) = shannon_cache.update(k, v);  // VHT2 compress→store→decompress
```

### Phase 3: AVX-512 VHT2 Optimization

**Goal:** SIMD-optimize the VHT2 butterfly for the NUC's AVX-512.

Current `vht2_f32_inplace` is scalar. For head_dim=128:
- 128 floats = 4 × 512-bit AVX-512 registers
- Each butterfly stage: 4 vfmadd + 4 vfmsub
- 7 stages × 8 ops = 56 AVX-512 instructions total
- Estimated: ~12ns per vector (vs ~50ns scalar)

```rust
#[cfg(target_arch = "x86_64")]
pub fn vht2_f32_avx512(data: &mut [f32; 128]) {
    use std::arch::x86_64::*;
    unsafe {
        let inv_sqrt2 = _mm512_set1_ps(std::f32::consts::FRAC_1_SQRT_2);
        // Stage 1: stride=128, half=64
        for j in (0..64).step_by(16) {
            let a = _mm512_loadu_ps(&data[j]);
            let b = _mm512_loadu_ps(&data[64 + j]);
            _mm512_storeu_ps(&mut data[j], _mm512_mul_ps(_mm512_add_ps(a, b), inv_sqrt2));
            _mm512_storeu_ps(&mut data[64 + j], _mm512_mul_ps(_mm512_sub_ps(a, b), inv_sqrt2));
        }
        // ... stages 2-7 with decreasing stride
    }
}
```

### Phase 4: Optane M10 Integration

**Goal:** Add mmap-backed KV cache spill to Optane.

1. Detect Optane device via `nvme id-ctrl` or DAX device
2. Create mmap region for KV spill
3. Implement LRU page eviction from DRAM to Optane
4. Prefetch cold pages ahead of sliding window

### Phase 5: Pipelined Decode

**Goal:** Overlap CPU VHT2 with iGPU matmul.

While iGPU runs FFN for layer N, CPU pre-compresses KV for layer N+1:

```
Time →
iGPU: [QKV_L0] [Attn_L0] [FFN_L0] [QKV_L1] [Attn_L1] [FFN_L1] ...
CPU:            [VHT2_L0]          [VHT2_L1]          [VHT2_L2] ...
                ↑ overlapped        ↑ overlapped
```

This requires:
- Async VHT2 on a dedicated CPU thread
- Fence/barrier between VHT2 completion and attention read
- SVM makes the fence cheap — just an atomic flag in shared memory

## Performance Projections

### Current (RTX 2060, no Shannon-Prime)
- ASR RTF: 3.46 (11.91s for 3.44s audio)
- Bottleneck: autoregressive decode, PCIe latency for KV cache

### Projected (NUC Beast Canyon, Shannon-Prime SVM)

| Component | RTX 2060 | NUC iGPU (est.) | Notes |
|-----------|----------|------------------|-------|
| Model load | ~2s | ~3s | Optane staging helps |
| Encoder (32L) | ~0.5s | ~1.5s | iGPU slower ALUs, but no PCIe |
| Adapter | ~0.05s | ~0.1s | Small |
| Decode/token | ~50ms | ~30ms | Zero-copy KV eliminates transfer |
| VHT2/token | N/A | ~1.2μs | Negligible |
| Total decode | ~10s | ~6s | 200 tokens × 30ms |
| **Total** | **~13s** | **~8s** | **RTF ~2.3** |

The NUC iGPU has fewer ALUs than the RTX 2060, so raw matmul throughput is lower. But the zero-copy KV cache eliminates the transfer overhead that dominates the autoregressive loop. Net effect: ~35% faster despite weaker GPU, because the bottleneck shifts from memory bandwidth to compute.

### Stretch Goal: RTF < 1.0

To hit real-time on the NUC:
1. **Speculative decoding:** Draft 4 tokens on CPU (smaller model), verify on iGPU
2. **KV cache windowing:** Only attend to last 256 tokens (sliding window already exists at 8192)
3. **Layer pruning:** Skip bottom decoder layers for confident tokens
4. **Batched VHT2:** Process all 26 layers' KV in one AVX-512 burst

## Comparison: DSP Engine (Android) vs SVM Engine (NUC)

| Aspect | DSP Engine (Android) | SVM Engine (NUC) |
|--------|---------------------|------------------|
| CPU | ARM big.LITTLE | Intel i9 (AVX-512) |
| GPU | Adreno/Mali (shared mem) | Intel Xe iGPU (SVM) |
| Memory | UMA, ~4-8 GB | UMA, up to 64 GB |
| Cache | ~2-4 MB shared | 24 MB shared |
| Spill tier | eMMC/UFS (~100μs) | Optane M10 (~10μs) |
| Transform | VHT2 (NEON) | VHT2 (AVX-512) |
| Model size | Smaller (mobile) | Full 4B Q4 (2.5 GB) |

The NUC is essentially a desktop-class version of the same architecture. The 6x larger L3 cache and AVX-512 make it viable for the full 4B parameter model, whereas on Android the DSP engine runs smaller models.

## File Changes Required

| File | Change |
|------|--------|
| `src/bin/voxtral/transcribe.rs` | `--device` flag, `SvmEngine` init |
| `src/gguf/model.rs` | `Q4DecoderLayer` uses `ShannonPrimeKVCache` |
| `src/models/layers/shannon_prime.rs` | AVX-512 VHT2, `OptaneKVStore` |
| `src/engine/mod.rs` (new) | `SvmEngine` orchestrator |
| `src/engine/optane.rs` (new) | Optane mmap KV store |
| `src/engine/pipeline.rs` (new) | Pipelined CPU↔iGPU decode |
| `Cargo.toml` | `memmap2` dependency, `svm` feature flag |
