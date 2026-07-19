//! Full 26-layer L0 decode benchmark.
//!
//! Loads Voxtral Q4 GGUF weights into USM, runs the pure L0 decoder,
//! and reports per-token latency / RTF.
//!
//! Usage: cargo run --release --features "wgpu,cli,hub,l0" --bin l0-decode -- \
//!          --gguf models/voxtral-q4.gguf [--tokens 20]

use anyhow::Result;
use clap::Parser;
use std::fs::File;
use std::io::BufReader;
use std::time::Instant;

use voxtral_mini_realtime::gguf::reader::GgufReader;
use voxtral_mini_realtime::l0::q4_decoder::{
    load_decoder_weights_from_gguf, DecoderConfig, L0Decoder, print_model_summary,
};
use voxtral_mini_realtime::models::layers::shannon_prime::BandConfig;

#[derive(Parser)]
#[command(name = "l0-decode", about = "Full L0 decoder benchmark")]
struct Args {
    /// Path to Q4 GGUF model file
    #[arg(long)]
    gguf: String,

    /// Number of tokens to generate
    #[arg(long, default_value = "20")]
    tokens: usize,
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    let args = Args::parse();

    println!("=== L0 Full Decoder Benchmark ===\n");
    print_model_summary();
    println!();

    // Configuration
    let config = DecoderConfig::voxtral_mini();
    let band_config = BandConfig::default_k(config.head_dim);

    // Create decode context (initializes L0, compiles kernel, allocates KV cache)
    println!("Initializing Level Zero decode context...");
    let init_start = Instant::now();
    let decode_ctx = L0Decoder::create_decode_context(&config, &band_config)?;
    let total_eus = decode_ctx.ctx.device.num_slices
        * decode_ctx.ctx.device.num_subslices_per_slice
        * decode_ctx.ctx.device.num_eus_per_subslice;
    println!("  Device: {} ({} EUs)",
        decode_ctx.ctx.device.name, total_eus);
    println!("  KV cache: {:.1} MiB USM (all {} layers)",
        (2 * config.n_layers * config.kv_heads * config.max_seq_len * config.head_dim * 4) as f64
            / (1024.0 * 1024.0),
        config.n_layers);
    println!("  Init: {:.2}s", init_start.elapsed().as_secs_f64());
    println!();

    // Load GGUF weights into USM using the decode context's allocator
    println!("Loading GGUF: {}", args.gguf);
    let file = File::open(&args.gguf)?;
    let buf_reader = BufReader::new(file);
    let mut gguf_reader = GgufReader::open(buf_reader)?;

    let load_start = Instant::now();
    let weights = load_decoder_weights_from_gguf(
        &mut gguf_reader,
        &decode_ctx.allocator,
        &config,
    )?;
    let load_time = load_start.elapsed();
    println!("  Loaded in {:.2}s", load_time.as_secs_f64());
    println!();

    // Drop GGUF reader to free ~2.5 GB
    drop(gguf_reader);

    // Create decoder with the context and weights
    println!("Creating L0 decoder...");
    let mut decoder = L0Decoder::new(config.clone(), weights, decode_ctx, band_config)?;
    println!("  Ready.");
    println!();

    // Generate tokens
    println!("Generating {} tokens...", args.tokens);
    println!("---");

    // Start with BOS token (token ID 1 for Mistral tokenizer)
    let bos_token = 1u32;
    let mut hidden = decoder.embed_token(bos_token);
    let mut generated_tokens = vec![bos_token];

    let gen_start = Instant::now();
    let mut per_token_times = Vec::with_capacity(args.tokens);

    for step in 0..args.tokens {
        let token_start = Instant::now();
        let token_id = decoder.decode_step(&mut hidden, step)?;
        let token_time = token_start.elapsed();
        per_token_times.push(token_time.as_secs_f64() * 1000.0);

        generated_tokens.push(token_id);

        // Prepare next step: embed the generated token
        hidden = decoder.embed_token(token_id);

        if step < 5 || step == args.tokens - 1 {
            println!("  Step {}: token {} ({:.1} ms)",
                step, token_id, token_time.as_secs_f64() * 1000.0);
        } else if step == 5 {
            println!("  ...");
        }
    }

    let gen_time = gen_start.elapsed();
    println!("---\n");

    // Statistics
    let total_ms = gen_time.as_secs_f64() * 1000.0;
    let avg_ms = total_ms / args.tokens as f64;
    let tokens_per_sec = args.tokens as f64 / gen_time.as_secs_f64();

    // RTF: assume 80ms of audio per decoded token (12.5 Hz frame rate)
    let audio_per_token_ms = 80.0;
    let rtf = avg_ms / audio_per_token_ms;

    println!("=== Results ===");
    println!("  Total: {:.1} ms for {} tokens", total_ms, args.tokens);
    println!("  Average: {:.1} ms/token", avg_ms);
    println!("  Throughput: {:.1} tokens/sec", tokens_per_sec);
    println!("  RTF: {:.3}", rtf);
    if rtf < 1.0 {
        println!("  *** REAL-TIME CAPABLE ({:.1}x faster than real-time) ***", 1.0 / rtf);
    } else {
        println!("  Not real-time ({:.1}x slower than real-time)", rtf);
    }
    println!();

    // Per-token breakdown
    if per_token_times.len() > 2 {
        let steady_state: Vec<f64> = per_token_times[1..].to_vec();
        let ss_avg = steady_state.iter().sum::<f64>() / steady_state.len() as f64;
        let ss_min = steady_state.iter().cloned().fold(f64::INFINITY, f64::min);
        let ss_max = steady_state.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

        println!("  Steady-state (excl. first token):");
        println!("    Avg: {:.1} ms, Min: {:.1} ms, Max: {:.1} ms", ss_avg, ss_min, ss_max);
        println!("    Steady RTF: {:.3}", ss_avg / audio_per_token_ms);
    }

    // Comparison
    println!("\n  --- Comparison ---");
    println!("  wgpu iGPU+SP baseline: 14.80 RTF (unusable)");
    println!("  L0 zero-copy:          {:.3} RTF ({:.0}x improvement)",
        rtf, 14.80 / rtf);

    println!("\n=== Benchmark Complete ===");
    Ok(())
}
