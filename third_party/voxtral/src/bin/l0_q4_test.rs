//! Test Q4 matmul kernel on Level Zero iGPU.
//!
//! Validates that our Q4_0 dequant+matmul kernel produces correct results
//! when running on the Intel UHD Graphics via Level Zero with USM buffers.
//!
//! Usage: cargo run --features "wgpu,cli,hub,l0" --bin l0-q4-test

use anyhow::Result;
use voxtral_mini_realtime::l0::{L0Context, L0Module, OclCompiler, UsmAllocator};
use voxtral_mini_realtime::l0::spirv_gen::OPENCL_Q4_MATMUL;

/// Q4_0 block: 2 bytes fp16 scale + 16 bytes (32 nibbles) = 18 bytes per block of 32 elements.
const Q4_BLOCK_SIZE: usize = 18;
const Q4_ELEMENTS_PER_BLOCK: usize = 32;

/// Pack a row of f32 weights into Q4_0 format.
fn quantize_row_q4(weights: &[f32]) -> Vec<u8> {
    assert!(weights.len() % Q4_ELEMENTS_PER_BLOCK == 0);
    let num_blocks = weights.len() / Q4_ELEMENTS_PER_BLOCK;
    let mut output = vec![0u8; num_blocks * Q4_BLOCK_SIZE];

    for blk in 0..num_blocks {
        let offset = blk * Q4_ELEMENTS_PER_BLOCK;
        let block = &weights[offset..offset + Q4_ELEMENTS_PER_BLOCK];

        // Find max absolute value for scale
        let amax = block.iter().map(|x| x.abs()).fold(0.0f32, f32::max);
        let scale = if amax > 0.0 { amax / 7.0 } else { 0.0 };
        let inv_scale = if scale > 0.0 { 1.0 / scale } else { 0.0 };

        // Write fp16 scale (first 2 bytes of block)
        let scale_f16 = half::f16::from_f32(scale);
        let scale_bytes = scale_f16.to_le_bytes();
        let blk_offset = blk * Q4_BLOCK_SIZE;
        output[blk_offset] = scale_bytes[0];
        output[blk_offset + 1] = scale_bytes[1];

        // Quantize: value → round(value/scale + 8) clamped to [0,15]
        let mut nibbles = [0u8; 32];
        for i in 0..32 {
            let q = (block[i] * inv_scale + 8.0).round() as i32;
            nibbles[i] = q.clamp(0, 15) as u8;
        }

        // Pack nibbles: lower 16 elements go in lower nibbles, upper 16 in upper nibbles
        // Layout: byte[j] = nibbles[j] | (nibbles[j+16] << 4)  for j in 0..16
        for j in 0..16 {
            output[blk_offset + 2 + j] = nibbles[j] | (nibbles[j + 16] << 4);
        }
    }

    output
}

/// Reference Q4 matmul on CPU for verification.
fn reference_q4_matmul(
    weights_q4: &[u8], // [N, blocks_per_row * 18 bytes]
    input: &[f32],     // [B, M, K]
    b: usize,
    m: usize,
    k: usize,
    n: usize,
) -> Vec<f32> {
    let blocks_per_row = k / Q4_ELEMENTS_PER_BLOCK;
    let mut output = vec![0.0f32; b * m * n];

    for bi in 0..b {
        for mi in 0..m {
            for ni in 0..n {
                let mut acc = 0.0f32;
                let input_base = bi * m * k + mi * k;

                for blk in 0..blocks_per_row {
                    let global_block = ni * blocks_per_row + blk;
                    let block_byte = global_block * Q4_BLOCK_SIZE;

                    // Read scale
                    let scale_bits = u16::from_le_bytes([
                        weights_q4[block_byte],
                        weights_q4[block_byte + 1],
                    ]);
                    let scale = half::f16::from_bits(scale_bits).to_f32();
                    let k_base = blk * Q4_ELEMENTS_PER_BLOCK;

                    // Dequantize and dot product
                    for j in 0..16 {
                        let byte = weights_q4[block_byte + 2 + j];
                        let lo = (byte & 0x0F) as f32 - 8.0;
                        let hi = ((byte >> 4) & 0x0F) as f32 - 8.0;

                        acc += (lo * scale) * input[input_base + k_base + j];
                        acc += (hi * scale) * input[input_base + k_base + j + 16];
                    }
                }

                output[bi * m * n + mi * n + ni] = acc;
            }
        }
    }

    output
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    println!("=== Q4 Matmul Kernel Test (Level Zero) ===\n");

    // Test dimensions: small enough to verify, large enough to be meaningful
    let b: u32 = 1;
    let m: u32 = 1;  // Single-token decode (most common case)
    let k: u32 = 128; // head_dim (matches decoder head_dim)
    let n: u32 = 256; // output dim (small for test)
    let blocks_per_row: u32 = k / 32;

    println!("Dimensions: B={}, M={}, K={}, N={}", b, m, k, n);
    println!("Blocks per row: {}", blocks_per_row);
    println!();

    // Generate random-ish test data
    let mut weights_f32 = vec![0.0f32; (n * k) as usize];
    let mut input_f32 = vec![0.0f32; (b * m * k) as usize];

    // Deterministic "random" using simple LCG
    let mut rng = 12345u64;
    let next_f32 = |rng: &mut u64| -> f32 {
        *rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((*rng >> 33) as f32 / (1u64 << 31) as f32) - 1.0 // [-1, 1]
    };

    for w in weights_f32.iter_mut() {
        *w = next_f32(&mut rng) * 0.5; // Small weights typical of transformer
    }
    for x in input_f32.iter_mut() {
        *x = next_f32(&mut rng);
    }

    // Quantize weights to Q4_0
    let mut weights_q4 = Vec::new();
    for row in 0..n as usize {
        let row_data = &weights_f32[row * k as usize..(row + 1) * k as usize];
        weights_q4.extend_from_slice(&quantize_row_q4(row_data));
    }
    println!("Weights: {} f32 → {} bytes Q4_0", weights_f32.len(), weights_q4.len());

    // Compute CPU reference
    let reference = reference_q4_matmul(
        &weights_q4, &input_f32,
        b as usize, m as usize, k as usize, n as usize,
    );
    println!("CPU reference: first 4 values = [{:.4}, {:.4}, {:.4}, {:.4}]",
        reference[0], reference[1], reference[2], reference[3]);
    println!();

    // === Level Zero GPU path ===
    println!("Initializing L0...");
    let ctx = L0Context::new()?;
    let allocator = UsmAllocator::new(&ctx);

    // Compile Q4 matmul kernel
    println!("Compiling Q4 matmul kernel via OpenCL...");
    let compiler = OclCompiler::new()?;
    let binary = compiler.compile_to_binary(OPENCL_Q4_MATMUL, "-cl-std=CL2.0")?;
    println!("  Native binary: {} bytes", binary.len());

    let module = L0Module::from_native(&ctx, &binary)?;
    let kernel = module.create_kernel("q4_matmul")?;
    println!("  Kernel 'q4_matmul' created");
    println!();

    // Allocate USM buffers
    println!("Allocating USM buffers...");
    let w_buf = allocator.alloc_shared::<u8>(weights_q4.len())?;
    let i_buf = allocator.alloc_shared::<f32>((b * m * k) as usize)?;
    let o_buf = allocator.alloc_shared::<f32>((b * m * n) as usize)?;

    // Copy data to USM (this is just a memcpy — same DRAM on UMA)
    unsafe {
        std::ptr::copy_nonoverlapping(
            weights_q4.as_ptr(), w_buf.ptr(), weights_q4.len()
        );
        std::ptr::copy_nonoverlapping(
            input_f32.as_ptr(), i_buf.ptr(), input_f32.len()
        );
    }
    println!("  Data copied to USM buffers");

    // Set kernel arguments
    kernel.set_arg_ptr(0, w_buf.ptr() as *const u8)?;
    kernel.set_arg_ptr(1, i_buf.ptr() as *const f32)?;
    kernel.set_arg_ptr(2, o_buf.ptr() as *const f32)?;
    kernel.set_arg_scalar(3, &b)?;
    kernel.set_arg_scalar(4, &m)?;
    kernel.set_arg_scalar(5, &k)?;
    kernel.set_arg_scalar(6, &n)?;
    kernel.set_arg_scalar(7, &blocks_per_row)?;

    // Dispatch: one thread per output element
    // Group size 16×16, grid covers [N, B*M]
    kernel.set_group_size(16, 16, 1)?;
    let groups_x = (n + 15) / 16;
    let groups_y = (b * m + 15) / 16;

    println!("Dispatching kernel: {}×{} workgroups of 16×16...", groups_x, groups_y);
    let start = std::time::Instant::now();
    kernel.dispatch(&ctx, groups_x, groups_y, 1)?;
    let elapsed = start.elapsed();
    println!("  Kernel completed in {:.3} ms", elapsed.as_secs_f64() * 1000.0);
    println!();

    // Verify results
    println!("Verifying results...");
    let mut max_error = 0.0f32;
    let mut errors = 0;
    unsafe {
        let output = o_buf.as_slice();
        for i in 0..reference.len() {
            let err = (output[i] - reference[i]).abs();
            max_error = max_error.max(err);
            if err > 0.01 {
                if errors < 5 {
                    println!("  MISMATCH[{}]: gpu={:.6}, cpu={:.6}, err={:.6}",
                        i, output[i], reference[i], err);
                }
                errors += 1;
            }
        }
        println!("GPU output: first 4 values = [{:.4}, {:.4}, {:.4}, {:.4}]",
            output[0], output[1], output[2], output[3]);
    }

    println!();
    if errors == 0 {
        println!("  PASS: All {} outputs match (max error = {:.6})", reference.len(), max_error);
    } else {
        println!("  FAIL: {} / {} mismatches (max error = {:.6})", errors, reference.len(), max_error);
    }

    println!();
    println!("=== Q4 Matmul Test Complete ===");

    Ok(())
}
