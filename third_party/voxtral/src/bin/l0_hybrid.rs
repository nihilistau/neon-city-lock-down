//! Hybrid L0 transcription: RTX encode → Level Zero iGPU decode.
//!
//! This binary demonstrates the full hybrid pipeline:
//! 1. Audio preprocessing (CPU)
//! 2. Mel spectrogram → encoder → adapter on RTX 4090 (wgpu)
//! 3. Transfer audio embeddings to CPU (f32 extraction)
//! 4. Autoregressive decode on Intel iGPU via Level Zero (Q4 + VHT2)
//!
//! The L0 decode path uses:
//! - USM shared memory for KV cache + weights (zero-copy)
//! - Pre-created kernel pool (3× kernels for batched QKV)
//! - Composite-order VHT2 for head_dim=96
//!
//! Usage: cargo run --release --features "wgpu,cli,hub,l0" --bin l0-hybrid -- \
//!          --gguf models/voxtral-q4.gguf --audio test_data/mary_had_lamb.wav \
//!          --tokenizer models/voxtral/tekken.json

use anyhow::{bail, Context, Result};
use burn::backend::wgpu::WgpuDevice;
use burn::backend::Wgpu;
use burn::tensor::{Tensor, TensorData};
use clap::Parser;
use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::time::Instant;

use voxtral_mini_realtime::audio::{
    io::load_wav,
    mel::{MelConfig, MelSpectrogram},
    pad::{pad_audio, PadConfig},
    resample::resample_to_16k,
};
use voxtral_mini_realtime::gguf::loader::Q4ModelLoader;
use voxtral_mini_realtime::gguf::reader::GgufReader;
use voxtral_mini_realtime::l0::q4_decoder::{
    load_decoder_weights_from_gguf, DecoderConfig, L0Decoder,
};
use voxtral_mini_realtime::models::layers::shannon_prime::BandConfig;

#[cfg(feature = "native-tokenizer")]
use voxtral_mini_realtime::tokenizer::VoxtralTokenizer;

type Backend = Wgpu;

#[derive(Parser)]
#[command(name = "l0-hybrid", about = "Hybrid RTX encode → L0 iGPU decode")]
struct Args {
    /// Path to Q4 GGUF model file
    #[arg(long)]
    gguf: String,

    /// Path to audio file (WAV)
    #[arg(long)]
    audio: String,

    /// Path to tokenizer JSON (for detokenization)
    #[arg(long)]
    tokenizer: Option<String>,

    /// Streaming delay in tokens (default 6 = 480ms lookahead)
    #[arg(long, default_value = "6")]
    delay: usize,
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    let args = Args::parse();

    println!("=== Hybrid L0 Transcription: RTX Encode → L0 iGPU Decode ===\n");

    // ─── Phase 0: Audio Preprocessing ─────────────────────────────────────

    let preprocess_start = Instant::now();

    let mut audio = load_wav(&args.audio)
        .with_context(|| format!("Failed to load {}", args.audio))?;

    let mut audio = if audio.sample_rate != 16000 {
        resample_to_16k(&audio)?
    } else {
        audio
    };

    // Peak normalize to 0.95 (critical for Q4)
    audio.peak_normalize(0.95);
    let audio_duration_secs = audio.samples.len() as f64 / 16000.0;

    // Pad and compute mel
    let pad_config = PadConfig::default();
    let padded = pad_audio(&audio, &pad_config);
    let mel_config = MelConfig::default();
    let mel_spec = MelSpectrogram::new(mel_config);
    let mel = mel_spec.compute_log(&padded.samples);

    let n_frames = mel.len();
    let n_mels = if n_frames > 0 { mel[0].len() } else { 0 };
    if n_frames == 0 {
        bail!("Audio too short to produce mel frames");
    }

    // Transpose mel [T, 128] → [128, T] and flatten for tensor
    let mut mel_transposed = vec![vec![0.0f32; n_frames]; n_mels];
    for (frame_idx, frame) in mel.iter().enumerate() {
        for (mel_idx, &val) in frame.iter().enumerate() {
            mel_transposed[mel_idx][frame_idx] = val;
        }
    }
    let mel_flat: Vec<f32> = mel_transposed.into_iter().flatten().collect();

    let encoder_device = WgpuDevice::DiscreteGpu(0);
    let mel_tensor: Tensor<Backend, 3> = Tensor::from_data(
        TensorData::new(mel_flat, [1, n_mels, n_frames]),
        &encoder_device,
    );

    let preprocess_ms = preprocess_start.elapsed().as_secs_f64() * 1000.0;
    println!("Preprocess: {:.1} ms ({} samples, {:.1}s audio, {} mel frames)",
        preprocess_ms, audio.samples.len(), audio_duration_secs, n_frames);

    // ─── Phase 1: Encode on RTX (wgpu) ──────────────────────────────────

    println!("\nLoading encoder on RTX (discrete GPU)...");
    let load_enc_start = Instant::now();

    let path = PathBuf::from(&args.gguf);
    let mut loader = Q4ModelLoader::from_file(&path)
        .context("Failed to open GGUF for encoder")?;
    let model = loader.load(&encoder_device)
        .context("Failed to load Q4 model on RTX")?;
    let load_enc_ms = load_enc_start.elapsed().as_secs_f64() * 1000.0;
    println!("  Encoder loaded: {:.1} ms", load_enc_ms);

    // Warmup: one throwaway encode to prime autotune cache + shader compilation
    {
        let warmup_start = Instant::now();
        let dummy_mel: Tensor<Backend, 3> = Tensor::zeros([1, n_mels, 64], &encoder_device);
        let warmup_out = model.encode_audio(dummy_mel);
        let _ = warmup_out.slice([0..1, 0..1, 0..1]).to_data(); // force GPU sync
        println!("  Warmup encode: {:.1} ms (primed autotune cache)",
            warmup_start.elapsed().as_secs_f64() * 1000.0);
    }

    // Encode audio (timed — should be fast now)
    let encode_start = Instant::now();
    let audio_embeds_tensor = model.encode_audio(mel_tensor);
    let [_, seq_len, d_model] = audio_embeds_tensor.dims();
    // Force GPU sync
    let _ = audio_embeds_tensor.clone().slice([0..1, 0..1, 0..1]).to_data();
    let encode_ms = encode_start.elapsed().as_secs_f64() * 1000.0;
    println!("  Encode: {:.1} ms (seq_len={}, d_model={})", encode_ms, seq_len, d_model);

    // Transfer to CPU (extract f32 vec)
    let transfer_start = Instant::now();
    let audio_embeds_data = audio_embeds_tensor.to_data();
    let audio_embeds_f32: Vec<f32> = audio_embeds_data.to_vec().unwrap();
    drop(model); // Free RTX memory
    drop(loader);
    let transfer_ms = transfer_start.elapsed().as_secs_f64() * 1000.0;
    println!("  Transfer to CPU: {:.1} ms ({:.1} MiB)",
        transfer_ms, (audio_embeds_f32.len() * 4) as f64 / (1024.0 * 1024.0));

    // ─── Phase 2: Load L0 Decoder ────────────────────────────────────────

    println!("\nLoading L0 decoder on iGPU...");
    let load_l0_start = Instant::now();

    let config = DecoderConfig::voxtral_mini();
    let band_config = BandConfig::default_k(config.head_dim);

    // Create L0 context
    let decode_ctx = L0Decoder::create_decode_context(&config, &band_config)?;
    let total_eus = decode_ctx.ctx.device.num_slices
        * decode_ctx.ctx.device.num_subslices_per_slice
        * decode_ctx.ctx.device.num_eus_per_subslice;
    println!("  Device: {} ({} EUs)", decode_ctx.ctx.device.name, total_eus);

    // Load decoder weights from GGUF into USM
    let file = File::open(&args.gguf)?;
    let buf_reader = BufReader::new(file);
    let mut gguf_reader = GgufReader::open(buf_reader)?;

    let weights = load_decoder_weights_from_gguf(
        &mut gguf_reader,
        &decode_ctx.allocator,
        &config,
    )?;
    drop(gguf_reader);

    let mut decoder = L0Decoder::new(config.clone(), weights, decode_ctx, band_config)?;
    let load_l0_ms = load_l0_start.elapsed().as_secs_f64() * 1000.0;
    println!("  L0 decoder ready: {:.1} ms", load_l0_ms);

    // Warmup: one throwaway decode step to prime L0 kernel JIT + page faults
    {
        let warmup_start = Instant::now();
        let mut dummy_hidden = decoder.embed_token(1); // BOS
        let _ = decoder.decode_step(&mut dummy_hidden, 0);
        decoder.reset(); // clear KV cache for real run
        println!("  Warmup decode: {:.1} ms (primed L0 kernel + USM pages)",
            warmup_start.elapsed().as_secs_f64() * 1000.0);
    }

    // ─── Phase 3: Autoregressive Decode on L0 ────────────────────────────

    println!("\nDecoding (RTX audio embeds → L0 iGPU decode)...");

    const PREFIX_LEN: usize = 38;
    const BOS_TOKEN: u32 = 1;
    const STREAMING_PAD: u32 = 32;
    const EOS_TOKEN: u32 = 2;

    if seq_len < PREFIX_LEN {
        println!("Audio too short for decoding (seq_len={} < PREFIX_LEN={})", seq_len, PREFIX_LEN);
        return Ok(());
    }

    let decode_start = Instant::now();

    // Build prefix token sequence: BOS + 37 pads
    let mut prefix_tokens: Vec<u32> = vec![BOS_TOKEN];
    prefix_tokens.extend(std::iter::repeat_n(STREAMING_PAD, PREFIX_LEN - 1));

    // Prefill: process PREFIX_LEN positions one-by-one through L0 decoder
    let mut first_pred_token = 0u32;

    for pos in 0..PREFIX_LEN {
        // hidden = audio_embed[pos] + embed_token(prefix_tokens[pos])
        let audio_offset = pos * d_model;
        let audio_slice = &audio_embeds_f32[audio_offset..audio_offset + d_model];

        let text_embed = decoder.embed_token(prefix_tokens[pos]);
        let mut hidden: Vec<f32> = audio_slice.iter()
            .zip(text_embed.iter())
            .map(|(a, t)| a + t)
            .collect();

        let token = decoder.decode_step(&mut hidden, pos)?;

        if pos == PREFIX_LEN - 1 {
            first_pred_token = token;
        }
    }

    // Now decode remaining positions
    let mut generated: Vec<u32> = vec![first_pred_token];
    let mut last_token = first_pred_token;

    let mut per_token_ms: Vec<f64> = Vec::with_capacity(seq_len - PREFIX_LEN);

    for pos in PREFIX_LEN..seq_len {
        let token_start = Instant::now();

        // hidden = audio_embed[pos] + embed_token(last_token)
        let audio_offset = pos * d_model;
        let audio_slice = &audio_embeds_f32[audio_offset..audio_offset + d_model];

        let text_embed = decoder.embed_token(last_token);
        let mut hidden: Vec<f32> = audio_slice.iter()
            .zip(text_embed.iter())
            .map(|(a, t)| a + t)
            .collect();

        let token = decoder.decode_step(&mut hidden, pos)?;
        per_token_ms.push(token_start.elapsed().as_secs_f64() * 1000.0);

        generated.push(token);
        last_token = token;

        // Stop on EOS
        if token == EOS_TOKEN {
            break;
        }
    }

    let decode_ms = decode_start.elapsed().as_secs_f64() * 1000.0;
    let decode_tokens = PREFIX_LEN + generated.len();

    println!("  Prefill: {} tokens", PREFIX_LEN);
    println!("  Generated: {} tokens", generated.len());
    println!("  Decode time: {:.1} ms", decode_ms);

    // ─── Results ──────────────────────────────────────────────────────────

    let total_ms = preprocess_ms + encode_ms + transfer_ms + decode_ms;
    let rtf = (total_ms / 1000.0) / audio_duration_secs;

    println!("\n=== Results ===");
    println!("  Audio: {:.2}s", audio_duration_secs);
    println!("  Preprocess: {:.1} ms", preprocess_ms);
    println!("  RTX Encode: {:.1} ms", encode_ms);
    println!("  Transfer:   {:.1} ms", transfer_ms);
    println!("  L0 Decode:  {:.1} ms ({} tokens)", decode_ms, decode_tokens);
    println!("  Total:      {:.1} ms", total_ms);
    println!("  RTF:        {:.3}", rtf);

    if rtf < 1.0 {
        println!("  *** REAL-TIME: {:.1}x faster than real-time ***", 1.0 / rtf);
    } else {
        println!("  Not real-time ({:.1}x slower)", rtf);
    }

    // Per-token stats (excluding prefill)
    if per_token_ms.len() > 2 {
        let ss: Vec<f64> = per_token_ms[1..].to_vec(); // skip first decode token (cold)
        let avg = ss.iter().sum::<f64>() / ss.len() as f64;
        let min = ss.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = ss.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        println!("\n  Steady-state decode (excl. first token):");
        println!("    Avg: {:.1} ms/token, Min: {:.1} ms, Max: {:.1} ms", avg, min, max);
        println!("    Decode-only RTF: {:.3}", avg / 80.0);
    }

    // Detokenize if tokenizer available
    #[cfg(feature = "native-tokenizer")]
    if let Some(tok_path) = &args.tokenizer {
        match VoxtralTokenizer::from_file(tok_path) {
            Ok(tokenizer) => {
                let token_ids: Vec<u32> = generated.iter()
                    .filter(|&&t| t != EOS_TOKEN && t != BOS_TOKEN && t != STREAMING_PAD)
                    .copied()
                    .collect();
                if let Ok(text) = tokenizer.decode(&token_ids) {
                    println!("\n  Transcription: {}", text.trim());
                }
            }
            Err(e) => {
                println!("\n  (Tokenizer not available: {})", e);
                println!("  Raw tokens: {:?}", &generated[..generated.len().min(20)]);
            }
        }
    }

    // Comparison
    println!("\n  --- Mode Comparison ---");
    println!("  wgpu Discrete+SP: ~0.52 RTF");
    println!("  wgpu Hybrid+SP:   ~0.65 RTF");
    println!("  L0 Hybrid (this): {:.3} RTF", rtf);

    println!("\n=== Done ===");
    Ok(())
}
