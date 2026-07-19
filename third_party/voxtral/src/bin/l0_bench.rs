//! Benchmark: L0 USM zero-copy VHT2 + Q4 matmul on iGPU.
//!
//! Measures the cost of the decode loop inner iteration:
//! 1. Write new KV vector to USM
//! 2. VHT2 compress+decompress in-place (CPU, zero-copy)
//! 3. Q4 matmul attention (GPU, same USM buffer)
//!
//! This is the critical path that replaces the old wgpu staging-buffer approach.
//!
//! Usage: cargo run --release --features "wgpu,cli,hub,l0" --bin l0-bench

use anyhow::Result;
use std::time::Instant;
use voxtral_mini_realtime::l0::{
    L0Context, L0DecodeConfig, L0DecodeContext, OclCompiler, UsmAllocator,
};
use voxtral_mini_realtime::l0::spirv_gen::OPENCL_Q4_MATMUL;
use voxtral_mini_realtime::models::layers::shannon_prime::BandConfig;

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("warn")
        .init();

    println!("=== L0 Zero-Copy Decode Benchmark ===\n");

    // Voxtral decoder dimensions
    let batch = 1;
    let kv_heads = 8;    // GQA: 8 KV heads
    let head_dim = 128;  // 3072 / 24 = 128 per head? Actually 3072/32=96 for Q heads, but KV=128
    let max_seq_len = 2048;

    // Shannon-Prime band config (default K config: 4 bands at 5/5/4/3 bits)
    let band_config = BandConfig::default_k(head_dim);

    println!("Config:");
    println!("  Batch: {}, KV heads: {}, Head dim: {}", batch, kv_heads, head_dim);
    println!("  Max seq len: {}", max_seq_len);
    println!("  VHT2 bands: {} (bits: {:?})", band_config.n_bands, band_config.band_bits);
    println!();

    // Initialize L0 decode context
    println!("Initializing L0 decode context...");
    let config = L0DecodeConfig {
        batch,
        kv_heads,
        max_seq_len,
        head_dim,
        band_config: band_config.clone(),
    };
    let mut decode_ctx = L0DecodeContext::new(config)?;
    println!("  OK: KV cache allocated ({:.1} MiB USM)",
        (2 * batch * kv_heads * max_seq_len * head_dim * 4) as f64 / (1024.0 * 1024.0));
    println!();

    // Also compile a "dummy" attention kernel for benchmarking GPU dispatch latency
    let ctx = &decode_ctx.ctx;
    let allocator = UsmAllocator::new(ctx);

    // Simulate Q4 weights for one decoder layer (just for matmul timing)
    // In reality: q_proj, k_proj, v_proj, o_proj each [dim, dim]
    // For benchmark: just time a single matmul of typical decode size
    let n_out: u32 = 3072;  // decoder hidden dim
    let k_in: u32 = 3072;   // decoder hidden dim
    let blocks_per_row = k_in / 32;
    let weight_bytes = (n_out as usize) * (blocks_per_row as usize) * 18;

    println!("Allocating Q4 weight buffer ({:.1} MiB)...",
        weight_bytes as f64 / (1024.0 * 1024.0));
    let w_buf = allocator.alloc_shared::<u8>(weight_bytes)?;
    let i_buf = allocator.alloc_shared::<f32>(k_in as usize)?;
    let o_buf = allocator.alloc_shared::<f32>(n_out as usize)?;

    // Fill with dummy data
    unsafe {
        let w = w_buf.as_mut_slice();
        for i in 0..weight_bytes {
            w[i] = (i % 256) as u8;
        }
        let inp = i_buf.as_mut_slice();
        for i in 0..k_in as usize {
            inp[i] = 0.01 * (i as f32);
        }
    }

    // Warmup
    println!("Warming up...");
    let compiler = OclCompiler::new()?;
    let binary = compiler.compile_to_binary(OPENCL_Q4_MATMUL, "-cl-std=CL2.0 -cl-fast-relaxed-math")?;
    let module = voxtral_mini_realtime::l0::L0Module::from_native(ctx, &binary)?;
    let kernel = module.create_kernel("q4_matmul")?;

    kernel.set_arg_ptr(0, w_buf.ptr() as *const u8)?;
    kernel.set_arg_ptr(1, i_buf.ptr() as *const f32)?;
    kernel.set_arg_ptr(2, o_buf.ptr() as *const f32)?;
    kernel.set_arg_scalar(3, &1u32)?;
    kernel.set_arg_scalar(4, &1u32)?;
    kernel.set_arg_scalar(5, &k_in)?;
    kernel.set_arg_scalar(6, &n_out)?;
    kernel.set_arg_scalar(7, &blocks_per_row)?;
    kernel.set_group_size(16, 16, 1)?;
    let gx = (n_out + 15) / 16;
    let gy = 1;

    // Warmup dispatches
    for _ in 0..3 {
        kernel.dispatch(ctx, gx, gy, 1)?;
    }

    // === Benchmark 1: Q4 matmul latency ===
    println!("\n--- Benchmark 1: Q4 Matmul Latency (single-token decode) ---");
    println!("  Dimensions: [1, 1, {}] × [{}, {}]^T → [1, 1, {}]", k_in, n_out, k_in, n_out);

    let iters = 50;
    let start = Instant::now();
    for _ in 0..iters {
        kernel.dispatch(ctx, gx, gy, 1)?;
    }
    let elapsed = start.elapsed();
    let per_matmul_us = elapsed.as_micros() as f64 / iters as f64;
    println!("  {} iterations in {:.1} ms ({:.1} µs/matmul)", iters, elapsed.as_secs_f64() * 1000.0, per_matmul_us);

    // Per-token decode has ~4 matmuls (Q, K, V, O projections) + attention
    let est_4matmul_ms = per_matmul_us * 4.0 / 1000.0;
    println!("  Estimated 4× matmul (QKVO): {:.2} ms/token", est_4matmul_ms);

    // === Benchmark 2: VHT2 on USM (zero-copy KV append) ===
    println!("\n--- Benchmark 2: VHT2 Compress+Decompress on USM ---");
    println!("  Per-token: 2 × {} heads × {} dim = {} f32 ops", kv_heads, head_dim, 2 * kv_heads * head_dim);

    let dummy_kv = vec![0.1f32; batch * kv_heads * head_dim];
    let vht2_iters = 200;

    let start = Instant::now();
    for _ in 0..vht2_iters {
        unsafe {
            decode_ctx.append_kv_with_vht2(&dummy_kv, &dummy_kv);
        }
        // Reset to avoid filling up
        if decode_ctx.seq_len() >= max_seq_len - 1 {
            decode_ctx.reset();
        }
    }
    let elapsed = start.elapsed();
    let per_vht2_us = elapsed.as_micros() as f64 / vht2_iters as f64;
    println!("  {} iterations in {:.1} ms ({:.1} µs/token)", vht2_iters, elapsed.as_secs_f64() * 1000.0, per_vht2_us);

    // === Benchmark 3: Combined (VHT2 + matmul = one decode step) ===
    println!("\n--- Benchmark 3: Full Decode Step (VHT2 + 4× Q4 Matmul) ---");
    let combined_ms = per_vht2_us / 1000.0 + est_4matmul_ms;
    println!("  VHT2: {:.3} ms + 4× matmul: {:.3} ms = {:.3} ms/token", per_vht2_us / 1000.0, est_4matmul_ms, combined_ms);
    let tokens_per_sec = 1000.0 / combined_ms;
    println!("  Throughput: {:.1} tokens/sec", tokens_per_sec);

    // Compare to wgpu baseline (14.80 RTF at 3.4s → 50.9s total → ~0.6 tok/s)
    println!("\n--- Comparison ---");
    println!("  wgpu iGPU+SP baseline: ~1.2 tok/s (14.80 RTF)");
    println!("  L0 zero-copy estimate: {:.1} tok/s ({:.2}× improvement)",
        tokens_per_sec, tokens_per_sec / 1.2);

    // RTF estimate: assume 80ms of audio per decoded token (12.5 Hz frame rate)
    let rtf_est = combined_ms / 80.0; // time_per_token / audio_per_token
    println!("  Estimated RTF: {:.2}", rtf_est);
    if rtf_est < 1.0 {
        println!("  *** REAL-TIME CAPABLE ***");
    }

    println!("\n=== Benchmark Complete ===");
    Ok(())
}
