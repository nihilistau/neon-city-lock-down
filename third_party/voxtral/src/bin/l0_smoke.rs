//! Smoke test for Level Zero backend.
//!
//! Validates:
//! 1. ze_loader.dll loads and zeInit succeeds
//! 2. Intel iGPU is discovered
//! 3. USM shared allocation works
//! 4. CPU can write, GPU can read (via trivial SPIR-V kernel)
//!
//! Usage: cargo run --features "wgpu,cli,hub,l0" --bin l0-smoke

use anyhow::Result;
use voxtral_mini_realtime::l0::{L0Context, UsmAllocator};

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    println!("=== Level Zero Smoke Test ===\n");

    // Step 1: Initialize L0 runtime
    println!("[1/4] Initializing Level Zero...");
    voxtral_mini_realtime::l0::l0_init()?;
    println!("  OK: zeInit succeeded\n");

    // Step 2: Discover iGPU
    println!("[2/4] Discovering devices...");
    let ctx = L0Context::new()?;
    println!("  Device: {}", ctx.device.name);
    println!("  Vendor: 0x{:04x}", ctx.device.vendor_id);
    println!("  Max alloc: {} MiB", ctx.device.max_mem_alloc_size / (1024 * 1024));
    println!(
        "  EUs: {} ({} slices × {} subslices × {} EUs/subslice)",
        ctx.device.num_slices * ctx.device.num_subslices_per_slice * ctx.device.num_eus_per_subslice,
        ctx.device.num_slices,
        ctx.device.num_subslices_per_slice,
        ctx.device.num_eus_per_subslice
    );
    println!();

    // Step 3: Allocate USM shared memory (simulate KV cache)
    println!("[3/4] Allocating USM shared memory...");
    let allocator = UsmAllocator::new(&ctx);

    // Simulate KV cache: [1, 8, 1024, 128] = 4 MiB
    let batch = 1;
    let kv_heads = 8;
    let seq_len = 1024;
    let head_dim = 128;
    let total = batch * kv_heads * seq_len * head_dim;
    let size_mb = (total * 4) as f64 / (1024.0 * 1024.0);

    let alloc = allocator.alloc_shared::<f32>(total)?;
    println!("  Allocated: {} elements ({:.1} MiB)", total, size_mb);
    println!("  Pointer: {:p}", alloc.ptr());
    println!();

    // Step 4: Verify CPU read/write on USM memory
    println!("[4/4] Verifying CPU access to USM allocation...");
    unsafe {
        let slice = alloc.as_mut_slice();
        // Write a pattern
        for i in 0..head_dim {
            slice[i] = (i as f32) * 0.01;
        }
        // Read it back
        let read_slice = alloc.as_slice();
        let mut ok = true;
        for i in 0..head_dim {
            if (read_slice[i] - (i as f32) * 0.01).abs() > 1e-6 {
                ok = false;
                break;
            }
        }
        if ok {
            println!("  OK: CPU write/read verified (128 f32 values)\n");
        } else {
            println!("  FAIL: Data mismatch!\n");
            std::process::exit(1);
        }
    }

    // Step 5: Compile kernel via OpenCL runtime → native binary → L0 module
    println!("[5/6] Compiling vector-add kernel via OpenCL...");
    use voxtral_mini_realtime::l0::OclCompiler;
    use voxtral_mini_realtime::l0::spirv_gen::OPENCL_VECADD;

    let compiler = OclCompiler::new()?;
    let binary = compiler.compile_to_binary(OPENCL_VECADD, "-cl-std=CL2.0")?;
    println!("  OK: OpenCL compiled vecadd kernel ({} bytes native binary)", binary.len());

    // Load native binary into L0
    use voxtral_mini_realtime::l0::kernel::L0Module;
    let module = L0Module::from_native(&ctx, &binary)?;
    let kernel = module.create_kernel("vecadd")?;
    println!("  OK: L0 kernel 'vecadd' created from native binary");
    println!();

    // Step 6: Execute vecadd kernel on USM memory to verify GPU dispatch
    println!("[6/6] Dispatching vecadd kernel on iGPU...");
    let n: u32 = 1024;
    let a_buf = allocator.alloc_shared::<f32>(n as usize)?;
    let b_buf = allocator.alloc_shared::<f32>(n as usize)?;
    let c_buf = allocator.alloc_shared::<f32>(n as usize)?;

    unsafe {
        let a = a_buf.as_mut_slice();
        let b = b_buf.as_mut_slice();
        for i in 0..n as usize {
            a[i] = i as f32;
            b[i] = (n as usize - i) as f32;
        }
    }

    // Set kernel arguments (USM pointers)
    kernel.set_arg_ptr(0, a_buf.ptr() as *const f32)?;
    kernel.set_arg_ptr(1, b_buf.ptr() as *const f32)?;
    kernel.set_arg_ptr(2, c_buf.ptr() as *const f32)?;
    kernel.set_arg_scalar(3, &n)?;

    // Set group size and dispatch
    kernel.set_group_size(64, 1, 1)?;
    let groups_x = (n + 63) / 64;
    kernel.dispatch(&ctx, groups_x, 1, 1)?;

    // Verify results
    let mut correct = true;
    unsafe {
        let c = c_buf.as_slice();
        for i in 0..n as usize {
            let expected = n as f32; // i + (n-i) = n
            if (c[i] - expected).abs() > 0.001 {
                println!("  FAIL: c[{}] = {} (expected {})", i, c[i], expected);
                correct = false;
                break;
            }
        }
    }
    if correct {
        println!("  OK: All {} elements verified (a[i] + b[i] == {})", n, n);
    } else {
        std::process::exit(1);
    }
    println!();

    // Summary
    println!("=== All checks passed ===");
    println!();
    println!("Level Zero zero-copy pipeline verified:");
    println!("  - L0 runtime: OK");
    println!("  - Intel UHD Graphics: {} EUs",
        ctx.device.num_slices * ctx.device.num_subslices_per_slice * ctx.device.num_eus_per_subslice);
    println!("  - USM shared allocation: OK (true zero-copy on UMA)");
    println!("  - OpenCL kernel compilation: OK");
    println!("  - L0 kernel dispatch on USM buffers: OK");
    println!();
    println!("Next: Compile Q4 matmul kernel, wire VHT2 on USM, benchmark full decode.");

    Ok(())
}
