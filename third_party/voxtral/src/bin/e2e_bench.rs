//! End-to-end benchmark binary for Voxtral inference.
//!
//! Measures stage-level timing (preprocess, encode, decode) and computes
//! RTF (real-time factor) and tokens/sec.

use anyhow::{bail, Context, Result};
use burn::backend::Wgpu;
use burn::prelude::ElementConversion;
use burn::tensor::{Int, Tensor, TensorData};
use clap::Parser;
use serde::Serialize;
use std::path::PathBuf;
use std::time::Instant;

use voxtral_mini_realtime::audio::{
    io::load_wav,
    mel::{MelConfig, MelSpectrogram},
    pad::{pad_audio, PadConfig},
    resample::resample_to_16k,
};
use voxtral_mini_realtime::models::time_embedding::TimeEmbedding;

type Backend = Wgpu;

#[derive(Parser)]
#[command(name = "e2e-bench")]
#[command(about = "End-to-end benchmark for Voxtral inference")]
struct Cli {
    /// Path to audio file (WAV format)
    #[arg(short, long)]
    audio: Vec<String>,

    /// Path to Q4 GGUF model file
    #[arg(long, requires = "tokenizer")]
    gguf: Option<String>,

    /// Path to f32 model directory
    #[arg(short, long, default_value = "models/voxtral", conflicts_with = "gguf")]
    model: String,

    /// Path to tokenizer JSON
    #[arg(long)]
    tokenizer: Option<String>,

    /// Delay in tokens (1 token = 80ms)
    #[arg(short, long, default_value = "6")]
    delay: usize,

    /// Number of warmup iterations
    #[arg(long, default_value = "1")]
    warmup: usize,

    /// Number of timed iterations
    #[arg(long, default_value = "3")]
    iterations: usize,

    /// Write JSON results to file
    #[arg(long)]
    json_output: Option<String>,

    /// GPU device: "discrete", "integrated", or "auto" (default)
    #[arg(long, default_value = "auto")]
    device: String,

    /// Enable Shannon-Prime VHT2 KV cache compression
    #[arg(long)]
    shannon_prime: bool,

    /// Hybrid split-device mode: encoder on discrete, decoder on integrated
    #[arg(long)]
    hybrid: bool,

    /// Enable pipelined mode for hybrid benchmarks (overlaps encode/decode)
    #[arg(long)]
    pipelined: bool,

    /// Run all modes (discrete, discrete+SP, integrated+SP, hybrid, hybrid+pipeline)
    /// and print comparison
    #[arg(long)]
    compare_all: bool,
}

#[derive(Debug, Clone, Serialize)]
struct BenchmarkResult {
    audio_file: String,
    mode: String,
    audio_duration_secs: f32,
    preprocess_ms: f64,
    encode_ms: f64,
    transfer_ms: f64,
    decode_ms: f64,
    total_ms: f64,
    rtf: f64,
    decode_tokens: usize,
    tokens_per_sec: f64,
    peak_memory_kb: Option<u64>,
    shannon_prime: bool,
}

#[derive(Debug, Serialize)]
struct BenchmarkReport {
    results: Vec<BenchmarkResult>,
    iterations: usize,
    warmup: usize,
    delay_tokens: usize,
}

/// Read peak RSS from /proc/self/status (Linux only).
fn peak_rss_kb() -> Option<u64> {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines().find(|l| l.starts_with("VmRSS:")).and_then(|l| {
                l.split_whitespace()
                    .nth(1)
                    .and_then(|v| v.parse::<u64>().ok())
            })
        })
}

/// Preprocess audio: load, resample, pad, compute mel, build tensor.
fn preprocess_audio(
    audio_path: &str,
    device: &<Backend as burn::tensor::backend::Backend>::Device,
) -> Result<(Tensor<Backend, 3>, f32)> {
    let audio = load_wav(audio_path).context("Failed to load audio")?;
    let audio_duration = audio.duration_secs();

    let mut audio = if audio.sample_rate != 16000 {
        resample_to_16k(&audio).context("Failed to resample")?
    } else {
        audio
    };
    audio.peak_normalize(0.95);

    let pad_config = PadConfig::voxtral();
    let padded = pad_audio(&audio, &pad_config);

    let mel_extractor = MelSpectrogram::new(MelConfig::voxtral());
    let mel = mel_extractor.compute_log(&padded.samples);
    let n_frames = mel.len();
    let n_mels = if n_frames > 0 { mel[0].len() } else { 0 };

    if n_frames == 0 {
        bail!("Audio too short to produce mel frames");
    }

    let mut mel_transposed = vec![vec![0.0f32; n_frames]; n_mels];
    for (frame_idx, frame) in mel.iter().enumerate() {
        for (mel_idx, &val) in frame.iter().enumerate() {
            mel_transposed[mel_idx][frame_idx] = val;
        }
    }
    let mel_flat: Vec<f32> = mel_transposed.into_iter().flatten().collect();
    let mel_tensor: Tensor<Backend, 3> =
        Tensor::from_data(TensorData::new(mel_flat, [1, n_mels, n_frames]), device);

    Ok((mel_tensor, audio_duration))
}

/// Run Q4 GGUF benchmark with stage-level timing.
fn bench_q4(
    gguf_path: &str,
    audio_path: &str,
    delay: usize,
    device: &<Backend as burn::tensor::backend::Backend>::Device,
    mode_name: &str,
    shannon_prime: bool,
    compact: bool,
) -> Result<BenchmarkResult> {
    use voxtral_mini_realtime::gguf::loader::Q4ModelLoader;
    use voxtral_mini_realtime::models::layers::LayerCaches;

    // Preprocess
    let preprocess_start = Instant::now();
    let (mel_tensor, audio_duration) = preprocess_audio(audio_path, device)?;
    let preprocess_ms = preprocess_start.elapsed().as_secs_f64() * 1000.0;

    // Load model (not timed — amortized across iterations)
    let path = PathBuf::from(gguf_path);
    let mut loader = Q4ModelLoader::from_file(&path).context("Failed to open GGUF")?;
    let mut model = if compact {
        loader
            .load_compact(device)
            .context("Failed to load Q4 model (compact)")?
    } else {
        loader.load(device).context("Failed to load Q4 model")?
    };
    if shannon_prime {
        let head_dim = model.decoder().head_dim();
        model.enable_shannon_prime(head_dim);
    }

    // Time embedding
    let time_embed = TimeEmbedding::new(3072);
    let t_embed = time_embed.embed::<Backend>(delay as f32, device);

    // Encode
    let encode_start = Instant::now();
    let audio_embeds = model.encode_audio(mel_tensor);
    let seq_len = audio_embeds.dims()[1];
    let d_model = audio_embeds.dims()[2];
    // Force GPU sync
    let _ = audio_embeds.clone().slice([0..1, 0..1, 0..1]).to_data();
    let encode_ms = encode_start.elapsed().as_secs_f64() * 1000.0;

    // Decode (lifted from transcribe_streaming with timing)
    let decode_start = Instant::now();

    const PREFIX_LEN: usize = 38;
    const BOS_TOKEN: i32 = 1;
    const STREAMING_PAD: i32 = 32;

    let mut prefix: Vec<i32> = vec![BOS_TOKEN];
    prefix.extend(std::iter::repeat_n(STREAMING_PAD, PREFIX_LEN - 1));

    let prefix_text_embeds = model
        .decoder()
        .embed_tokens_from_ids(&prefix, 1, PREFIX_LEN);

    let prefix_audio = audio_embeds
        .clone()
        .slice([0..1, 0..PREFIX_LEN, 0..d_model]);
    let prefix_inputs = prefix_audio + prefix_text_embeds;

    let mut decoder_cache: LayerCaches<Wgpu> = if shannon_prime {
        if let Some(sp_config) = model.shannon_prime_config() {
            model
                .decoder()
                .create_cache_preallocated_shannon_prime(seq_len, sp_config.clone())
        } else {
            model.create_decoder_cache_preallocated(seq_len)
        }
    } else {
        model.create_decoder_cache_preallocated(seq_len)
    };

    let hidden = model.decoder().forward_hidden_with_cache(
        prefix_inputs,
        t_embed.clone(),
        &mut decoder_cache,
    );
    let logits = model.decoder().lm_head(hidden);

    let last_logits =
        logits
            .clone()
            .slice([0..1, (PREFIX_LEN - 1)..PREFIX_LEN, 0..logits.dims()[2]]);
    let first_pred = last_logits.argmax(2);
    let first_token: i32 = first_pred.into_scalar().elem();

    let mut generated = prefix;
    generated.push(first_token);

    // Pre-slice audio positions to avoid cloning full audio_embeds each step
    let audio_slices: Vec<Tensor<Backend, 3>> = (PREFIX_LEN..seq_len)
        .map(|pos| audio_embeds.clone().slice([0..1, pos..pos + 1, 0..d_model]))
        .collect();
    drop(audio_embeds);

    for pos in (PREFIX_LEN + 1)..seq_len {
        let new_token = generated[pos - 1];
        let text_embed = model.decoder().embed_tokens_from_ids(&[new_token], 1, 1);

        let audio_pos = audio_slices[pos - 1 - PREFIX_LEN].clone();
        let input = audio_pos + text_embed;

        let hidden =
            model
                .decoder()
                .forward_hidden_with_cache(input, t_embed.clone(), &mut decoder_cache);
        let logits = model.decoder().lm_head(hidden);

        let pred = logits.argmax(2);
        let next_token: i32 = pred.into_scalar().elem();
        generated.push(next_token);
    }

    let decode_tokens = generated.len() - PREFIX_LEN;
    let decode_ms = decode_start.elapsed().as_secs_f64() * 1000.0;
    let total_ms = preprocess_ms + encode_ms + decode_ms;
    let total_secs = total_ms / 1000.0;
    let rtf = total_secs / audio_duration as f64;
    let tokens_per_sec = if decode_ms > 0.0 {
        decode_tokens as f64 / (decode_ms / 1000.0)
    } else {
        0.0
    };

    Ok(BenchmarkResult {
        audio_file: audio_path.to_string(),
        mode: mode_name.to_string(),
        audio_duration_secs: audio_duration,
        preprocess_ms,
        encode_ms,
        transfer_ms: 0.0,
        decode_ms,
        total_ms,
        rtf,
        decode_tokens,
        tokens_per_sec,
        peak_memory_kb: peak_rss_kb(),
        shannon_prime,
    })
}

/// Run Q4 GGUF benchmark in hybrid split-device mode with stage-level timing.
fn bench_q4_hybrid(
    gguf_path: &str,
    audio_path: &str,
    delay: usize,
    mode_name: &str,
) -> Result<BenchmarkResult> {
    use burn::backend::wgpu::WgpuDevice;
    use voxtral_mini_realtime::gguf::loader::Q4ModelLoader;

    let encoder_device = WgpuDevice::DiscreteGpu(0);
    let decoder_device = WgpuDevice::IntegratedGpu(0);

    // Preprocess (on encoder device)
    let preprocess_start = Instant::now();
    let (mel_tensor, audio_duration) = preprocess_audio(audio_path, &encoder_device)?;
    let preprocess_ms = preprocess_start.elapsed().as_secs_f64() * 1000.0;

    // Load model in hybrid mode
    let path = PathBuf::from(gguf_path);
    let mut loader = Q4ModelLoader::from_file(&path).context("Failed to open GGUF")?;
    let mut model = loader
        .load_hybrid(&encoder_device, &decoder_device)
        .context("Failed to load Q4 model (hybrid)")?;
    let head_dim = model.decoder().head_dim();
    model.enable_shannon_prime(head_dim);

    // Time embedding (on encoder device initially, will be transferred)
    let time_embed = TimeEmbedding::new(3072);
    let t_embed = time_embed.embed::<Backend>(delay as f32, &encoder_device);

    // Encode on discrete GPU
    let encode_start = Instant::now();
    let audio_embeds_encoder = model.encode_audio(mel_tensor);
    let seq_len = audio_embeds_encoder.dims()[1];
    let d_model = audio_embeds_encoder.dims()[2];
    // Force GPU sync
    let _ = audio_embeds_encoder
        .clone()
        .slice([0..1, 0..1, 0..1])
        .to_data();
    let encode_ms = encode_start.elapsed().as_secs_f64() * 1000.0;

    // Transfer to decoder device
    let transfer_start = Instant::now();
    let audio_embeds = {
        let data = audio_embeds_encoder.to_data();
        drop(audio_embeds_encoder);
        Tensor::from_data(data, &decoder_device)
    };
    let t_embed_decoder = {
        let data = t_embed.to_data();
        Tensor::from_data(data, &decoder_device)
    };
    // Force GPU sync on decoder side
    let _ = audio_embeds.clone().slice([0..1, 0..1, 0..1]).to_data();
    let transfer_ms = transfer_start.elapsed().as_secs_f64() * 1000.0;

    // Decode on integrated GPU
    let decode_start = Instant::now();

    const PREFIX_LEN: usize = 38;
    const BOS_TOKEN: i32 = 1;
    const STREAMING_PAD: i32 = 32;

    let mut prefix: Vec<i32> = vec![BOS_TOKEN];
    prefix.extend(std::iter::repeat_n(STREAMING_PAD, PREFIX_LEN - 1));

    let prefix_text_embeds = model
        .decoder()
        .embed_tokens_from_ids(&prefix, 1, PREFIX_LEN);
    let prefix_audio = audio_embeds
        .clone()
        .slice([0..1, 0..PREFIX_LEN, 0..d_model]);
    let prefix_inputs = prefix_audio + prefix_text_embeds;

    let mut decoder_cache = if let Some(sp_config) = model.shannon_prime_config() {
        model
            .decoder()
            .create_cache_preallocated_shannon_prime(seq_len, sp_config.clone())
    } else {
        model.create_decoder_cache_preallocated(seq_len)
    };

    let hidden = model.decoder().forward_hidden_with_cache(
        prefix_inputs,
        t_embed_decoder.clone(),
        &mut decoder_cache,
    );
    let logits = model.decoder().lm_head(hidden);

    let last_logits =
        logits
            .clone()
            .slice([0..1, (PREFIX_LEN - 1)..PREFIX_LEN, 0..logits.dims()[2]]);
    let first_pred = last_logits.argmax(2);
    let first_token: i32 = first_pred.into_scalar().elem();

    let mut generated = prefix;
    generated.push(first_token);

    let audio_slices: Vec<Tensor<Backend, 3>> = (PREFIX_LEN..seq_len)
        .map(|pos| audio_embeds.clone().slice([0..1, pos..pos + 1, 0..d_model]))
        .collect();
    drop(audio_embeds);

    for pos in (PREFIX_LEN + 1)..seq_len {
        let new_token = generated[pos - 1];
        let text_embed = model.decoder().embed_tokens_from_ids(&[new_token], 1, 1);
        let audio_pos = audio_slices[pos - 1 - PREFIX_LEN].clone();
        let input = audio_pos + text_embed;

        let hidden = model.decoder().forward_hidden_with_cache(
            input,
            t_embed_decoder.clone(),
            &mut decoder_cache,
        );
        let logits = model.decoder().lm_head(hidden);

        let pred = logits.argmax(2);
        let next_token: i32 = pred.into_scalar().elem();
        generated.push(next_token);
    }

    let decode_tokens = generated.len() - PREFIX_LEN;
    let decode_ms = decode_start.elapsed().as_secs_f64() * 1000.0;
    let total_ms = preprocess_ms + encode_ms + transfer_ms + decode_ms;
    let total_secs = total_ms / 1000.0;
    let rtf = total_secs / audio_duration as f64;
    let tokens_per_sec = if decode_ms > 0.0 {
        decode_tokens as f64 / (decode_ms / 1000.0)
    } else {
        0.0
    };

    Ok(BenchmarkResult {
        audio_file: audio_path.to_string(),
        mode: mode_name.to_string(),
        audio_duration_secs: audio_duration,
        preprocess_ms,
        encode_ms,
        transfer_ms,
        decode_ms,
        total_ms,
        rtf,
        decode_tokens,
        tokens_per_sec,
        peak_memory_kb: peak_rss_kb(),
        shannon_prime: true,
    })
}

/// Run Q4 GGUF benchmark in pipelined hybrid mode.
/// Uses chunked audio with overlapped encode/decode.
fn bench_q4_hybrid_pipelined(
    gguf_path: &str,
    audio_path: &str,
    delay: usize,
    max_mel_frames: usize,
    mode_name: &str,
) -> Result<BenchmarkResult> {
    use burn::backend::wgpu::WgpuDevice;
    use voxtral_mini_realtime::audio::mel::{MelConfig, MelSpectrogram};
    use voxtral_mini_realtime::audio::{
        chunk::{chunk_audio, needs_chunking, ChunkConfig},
        pad::{pad_audio, PadConfig},
        AudioBuffer,
    };
    use voxtral_mini_realtime::gguf::loader::Q4ModelLoader;

    let encoder_device = WgpuDevice::DiscreteGpu(0);
    let decoder_device = WgpuDevice::IntegratedGpu(0);

    // Preprocess — load, resample, chunk, compute mel for each chunk
    let preprocess_start = Instant::now();

    let audio =
        voxtral_mini_realtime::audio::io::load_wav(audio_path).context("Failed to load audio")?;
    let audio_duration = audio.duration_secs();
    let mut audio = if audio.sample_rate != 16000 {
        voxtral_mini_realtime::audio::resample::resample_to_16k(&audio)
            .context("Failed to resample")?
    } else {
        audio
    };
    audio.peak_normalize(0.95);
    let sample_rate = audio.sample_rate;

    let chunk_config = ChunkConfig::voxtral().with_max_frames(max_mel_frames);
    let chunks = if needs_chunking(audio.samples.len(), &chunk_config) {
        chunk_audio(&audio.samples, &chunk_config)
    } else {
        vec![voxtral_mini_realtime::audio::AudioChunk {
            samples: audio.samples.clone(),
            start_sample: 0,
            end_sample: audio.samples.len(),
            index: 0,
            is_last: true,
        }]
    };

    let mel_extractor = MelSpectrogram::new(MelConfig::voxtral());
    let pad_config = PadConfig::voxtral();

    let mut mel_tensors = Vec::with_capacity(chunks.len());
    for chunk in &chunks {
        let chunk_audio = AudioBuffer::new(chunk.samples.clone(), sample_rate);
        let padded = pad_audio(&chunk_audio, &pad_config);
        let mel = mel_extractor.compute_log(&padded.samples);
        let n_frames = mel.len();
        let n_mels = if n_frames > 0 { mel[0].len() } else { 0 };
        if n_frames == 0 {
            continue;
        }
        let mut mel_transposed = vec![vec![0.0f32; n_frames]; n_mels];
        for (frame_idx, frame) in mel.iter().enumerate() {
            for (mel_idx, &val) in frame.iter().enumerate() {
                mel_transposed[mel_idx][frame_idx] = val;
            }
        }
        let mel_flat: Vec<f32> = mel_transposed.into_iter().flatten().collect();
        let mel_tensor: Tensor<Backend, 3> = Tensor::from_data(
            TensorData::new(mel_flat, [1, n_mels, n_frames]),
            &encoder_device,
        );
        mel_tensors.push(mel_tensor);
    }
    let preprocess_ms = preprocess_start.elapsed().as_secs_f64() * 1000.0;

    // Load model in hybrid mode
    let path = PathBuf::from(gguf_path);
    let mut loader = Q4ModelLoader::from_file(&path).context("Failed to open GGUF")?;
    let mut model = loader
        .load_hybrid(&encoder_device, &decoder_device)
        .context("Failed to load Q4 model (hybrid)")?;
    let head_dim = model.decoder().head_dim();
    model.enable_shannon_prime(head_dim);

    // Time embedding
    let time_embed = TimeEmbedding::new(3072);
    let t_embed = time_embed.embed::<Backend>(delay as f32, &encoder_device);

    // Run pipelined inference
    let pipeline_start = Instant::now();
    let (all_tokens, timing) = model.transcribe_streaming_hybrid_pipelined(mel_tensors, t_embed);
    let pipeline_ms = pipeline_start.elapsed().as_secs_f64() * 1000.0;

    let decode_tokens: usize = all_tokens.iter().map(|t| t.len()).sum();
    let total_ms = preprocess_ms + pipeline_ms;
    let total_secs = total_ms / 1000.0;
    let rtf = total_secs / audio_duration as f64;
    let tokens_per_sec = if timing.decode_ms > 0.0 {
        decode_tokens as f64 / (timing.decode_ms / 1000.0)
    } else {
        0.0
    };

    Ok(BenchmarkResult {
        audio_file: audio_path.to_string(),
        mode: mode_name.to_string(),
        audio_duration_secs: audio_duration,
        preprocess_ms,
        encode_ms: timing.encode_ms,
        transfer_ms: timing.transfer_ms,
        decode_ms: timing.decode_ms,
        total_ms,
        rtf,
        decode_tokens,
        tokens_per_sec,
        peak_memory_kb: peak_rss_kb(),
        shannon_prime: true,
    })
}

/// Run f32 SafeTensors benchmark with stage-level timing.
fn bench_f32(
    model_dir: &str,
    audio_path: &str,
    delay: usize,
    device: &<Backend as burn::tensor::backend::Backend>::Device,
) -> Result<BenchmarkResult> {
    use voxtral_mini_realtime::models::loader::VoxtralModelLoader;

    // Preprocess
    let preprocess_start = Instant::now();
    let (mel_tensor, audio_duration) = preprocess_audio(audio_path, device)?;
    let preprocess_ms = preprocess_start.elapsed().as_secs_f64() * 1000.0;

    // Load model
    let model_dir_path = PathBuf::from(model_dir);
    let safetensors_path = model_dir_path.join("consolidated.safetensors");
    if !safetensors_path.exists() {
        bail!("Model not found at {}", safetensors_path.display());
    }

    let loader =
        VoxtralModelLoader::from_file(&safetensors_path).context("Failed to open model weights")?;
    let model = loader.load(device).context("Failed to load model")?;

    // Time embedding
    let time_embed = TimeEmbedding::new(3072);
    let t_embed = time_embed.embed::<Backend>(delay as f32, device);

    // Encode
    let encode_start = Instant::now();
    let audio_embeds = model.encode_audio(mel_tensor);
    let seq_len = audio_embeds.dims()[1];
    let d_model = audio_embeds.dims()[2];
    let _ = audio_embeds.clone().slice([0..1, 0..1, 0..1]).to_data();
    let encode_ms = encode_start.elapsed().as_secs_f64() * 1000.0;

    // Decode
    let decode_start = Instant::now();

    const PREFIX_LEN: usize = 38;
    const BOS_TOKEN: i32 = 1;
    const STREAMING_PAD: i32 = 32;

    let mut prefix: Vec<i32> = vec![BOS_TOKEN];
    prefix.extend(std::iter::repeat_n(STREAMING_PAD, PREFIX_LEN - 1));

    let prefix_tensor = Tensor::<Backend, 2, Int>::from_data(
        TensorData::new(prefix.clone(), [1, PREFIX_LEN]),
        device,
    );
    let prefix_text_embeds = model.decoder().embed_tokens(prefix_tensor);

    let prefix_audio = audio_embeds
        .clone()
        .slice([0..1, 0..PREFIX_LEN, 0..d_model]);
    let prefix_inputs = prefix_audio + prefix_text_embeds;

    let mut decoder_cache = model.create_decoder_cache();

    let hidden = model.decoder().forward_hidden_with_cache(
        prefix_inputs,
        t_embed.clone(),
        &mut decoder_cache,
    );
    let logits = model.decoder().lm_head(hidden);

    let vocab_size = logits.dims()[2];
    let last_logits = logits.slice([0..1, (PREFIX_LEN - 1)..PREFIX_LEN, 0..vocab_size]);
    let first_pred = last_logits.argmax(2);
    let first_token: i32 = first_pred.into_scalar().elem();

    let mut generated = prefix;
    generated.push(first_token);

    for pos in PREFIX_LEN + 1..seq_len {
        let new_token = generated[pos - 1];
        let token_tensor =
            Tensor::<Backend, 2, Int>::from_data(TensorData::new(vec![new_token], [1, 1]), device);
        let text_embed = model.decoder().embed_tokens(token_tensor);

        let audio_pos = audio_embeds
            .clone()
            .slice([0..1, (pos - 1)..pos, 0..d_model]);
        let input = audio_pos + text_embed;

        let hidden =
            model
                .decoder()
                .forward_hidden_with_cache(input, t_embed.clone(), &mut decoder_cache);
        let logits = model.decoder().lm_head(hidden);

        let pred = logits.argmax(2);
        let next_token: i32 = pred.into_scalar().elem();
        generated.push(next_token);
    }

    let decode_tokens = generated.len() - PREFIX_LEN;
    let decode_ms = decode_start.elapsed().as_secs_f64() * 1000.0;
    let total_ms = preprocess_ms + encode_ms + decode_ms;
    let total_secs = total_ms / 1000.0;
    let rtf = total_secs / audio_duration as f64;
    let tokens_per_sec = if decode_ms > 0.0 {
        decode_tokens as f64 / (decode_ms / 1000.0)
    } else {
        0.0
    };

    Ok(BenchmarkResult {
        audio_file: audio_path.to_string(),
        mode: "f32".to_string(),
        audio_duration_secs: audio_duration,
        preprocess_ms,
        encode_ms,
        transfer_ms: 0.0,
        decode_ms,
        total_ms,
        rtf,
        decode_tokens,
        tokens_per_sec,
        peak_memory_kb: peak_rss_kb(),
        shannon_prime: false,
    })
}

fn print_table(results: &[BenchmarkResult]) {
    println!(
        "\n{:<20} {:<14} {:>8} {:>9} {:>9} {:>9} {:>9} {:>9} {:>6} {:>8}",
        "Audio",
        "Mode",
        "Dur (s)",
        "Pre(ms)",
        "Enc(ms)",
        "Xfer(ms)",
        "Dec(ms)",
        "Total(ms)",
        "RTF",
        "Tok/s"
    );
    println!("{}", "-".repeat(130));

    for r in results {
        let filename = r
            .audio_file
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(&r.audio_file);
        let short_name = if filename.len() > 19 {
            &filename[..19]
        } else {
            filename
        };
        println!(
            "{:<20} {:<14} {:>8.2} {:>9.1} {:>9.1} {:>9.1} {:>9.1} {:>9.1} {:>6.3} {:>8.1}",
            short_name,
            r.mode,
            r.audio_duration_secs,
            r.preprocess_ms,
            r.encode_ms,
            r.transfer_ms,
            r.decode_ms,
            r.total_ms,
            r.rtf,
            r.tokens_per_sec,
        );
    }
}

fn print_comparison(results: &[BenchmarkResult]) {
    // Group by mode, show comparison
    println!("\n=== RTF Comparison ===\n");
    println!(
        "{:<16} {:>8} {:>9} {:>9} {:>9} {:>9} {:>8} {:>3}",
        "Mode", "RTF", "Enc(ms)", "Xfer(ms)", "Dec(ms)", "Total(ms)", "Tok/s", "SP"
    );
    println!("{}", "-".repeat(90));

    for r in results {
        println!(
            "{:<16} {:>8.4} {:>9.1} {:>9.1} {:>9.1} {:>9.1} {:>8.1} {:>3}",
            r.mode,
            r.rtf,
            r.encode_ms,
            r.transfer_ms,
            r.decode_ms,
            r.total_ms,
            r.tokens_per_sec,
            if r.shannon_prime { "yes" } else { "no" },
        );
    }

    // Find baseline (first result) and compute speedups
    if results.len() > 1 {
        let baseline_rtf = results[0].rtf;
        println!("\nRelative to {}:", results[0].mode);
        for r in &results[1..] {
            let speedup = baseline_rtf / r.rtf;
            let enc_ratio = r.encode_ms / results[0].encode_ms;
            let dec_ratio = r.decode_ms / results[0].decode_ms;
            println!(
                "  {} — {:.2}x overall, enc {:.2}x, dec {:.2}x",
                r.mode, speedup, enc_ratio, dec_ratio,
            );
        }
    }
}

/// Select device from CLI flag
fn select_device(device_str: &str) -> <Backend as burn::tensor::backend::Backend>::Device {
    use burn::backend::wgpu::WgpuDevice;
    match device_str {
        "integrated" => WgpuDevice::IntegratedGpu(0),
        "discrete" => WgpuDevice::DiscreteGpu(0),
        _ => WgpuDevice::default(),
    }
}

/// Average a set of benchmark results across iterations.
fn average_results(all_results: &[Vec<BenchmarkResult>]) -> Vec<BenchmarkResult> {
    if all_results.is_empty() {
        return Vec::new();
    }
    let n_files = all_results[0].len();
    let n_iter = all_results.len() as f64;
    let mut averaged = Vec::new();

    for file_idx in 0..n_files {
        let first = &all_results[0][file_idx];
        let mut avg = BenchmarkResult {
            audio_file: first.audio_file.clone(),
            mode: first.mode.clone(),
            audio_duration_secs: first.audio_duration_secs,
            preprocess_ms: 0.0,
            encode_ms: 0.0,
            transfer_ms: 0.0,
            decode_ms: 0.0,
            total_ms: 0.0,
            rtf: 0.0,
            decode_tokens: first.decode_tokens,
            tokens_per_sec: 0.0,
            peak_memory_kb: first.peak_memory_kb,
            shannon_prime: first.shannon_prime,
        };

        for iter_results in all_results {
            let r = &iter_results[file_idx];
            avg.preprocess_ms += r.preprocess_ms;
            avg.encode_ms += r.encode_ms;
            avg.transfer_ms += r.transfer_ms;
            avg.decode_ms += r.decode_ms;
            avg.total_ms += r.total_ms;
            avg.rtf += r.rtf;
            avg.tokens_per_sec += r.tokens_per_sec;
        }

        avg.preprocess_ms /= n_iter;
        avg.encode_ms /= n_iter;
        avg.transfer_ms /= n_iter;
        avg.decode_ms /= n_iter;
        avg.total_ms /= n_iter;
        avg.rtf /= n_iter;
        avg.tokens_per_sec /= n_iter;

        averaged.push(avg);
    }
    averaged
}

/// Run a single benchmark configuration for N iterations, returning averaged results.
fn run_bench_config<F>(
    label: &str,
    iterations: usize,
    warmup: usize,
    audio_paths: &[String],
    bench_fn: F,
) -> Result<Vec<BenchmarkResult>>
where
    F: Fn(&str) -> Result<BenchmarkResult>,
{
    println!("\n--- {label} ---");

    // Warmup
    if warmup > 0 {
        print!("  Warmup...");
        for _ in 0..warmup {
            for audio_path in audio_paths {
                bench_fn(audio_path)?;
            }
        }
        println!(" done");
    }

    // Timed iterations
    let mut all_results: Vec<Vec<BenchmarkResult>> = Vec::new();
    for iter in 0..iterations {
        let mut iter_results = Vec::new();
        for audio_path in audio_paths {
            iter_results.push(bench_fn(audio_path)?);
        }
        println!("  Iteration {} complete", iter + 1);
        all_results.push(iter_results);
    }

    Ok(average_results(&all_results))
}

fn main() -> Result<()> {
    tracing_subscriber::fmt().with_target(false).init();

    let cli = Cli::parse();

    if cli.audio.is_empty() {
        bail!("At least one --audio path is required");
    }

    let use_q4 = cli.gguf.is_some();
    let model_label = if use_q4 { "Q4 GGUF" } else { "f32 SafeTensors" };

    println!("Voxtral E2E Benchmark");
    println!("  Model: {model_label}");
    println!("  Delay: {} tokens ({}ms)", cli.delay, cli.delay * 80);
    println!("  Warmup: {}, Iterations: {}", cli.warmup, cli.iterations);
    println!("  Audio files: {}", cli.audio.len());

    if cli.compare_all {
        // ── Compare all three Q4 modes ──
        let gguf_path = cli
            .gguf
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("--compare-all requires --gguf"))?
            .clone();

        let mut all_averaged: Vec<BenchmarkResult> = Vec::new();

        // 1. Discrete GPU (baseline)
        {
            let device = select_device("discrete");
            let gguf = gguf_path.clone();
            let delay = cli.delay;
            let results = run_bench_config(
                "Discrete GPU (RTX)",
                cli.iterations,
                cli.warmup,
                &cli.audio,
                |audio_path| bench_q4(&gguf, audio_path, delay, &device, "discrete", false, false),
            )?;
            all_averaged.extend(results);
        }

        // 2. Discrete GPU + Shannon-Prime
        {
            let device = select_device("discrete");
            let gguf = gguf_path.clone();
            let delay = cli.delay;
            let results = run_bench_config(
                "Discrete GPU + Shannon-Prime",
                cli.iterations,
                cli.warmup,
                &cli.audio,
                |audio_path| {
                    bench_q4(
                        &gguf,
                        audio_path,
                        delay,
                        &device,
                        "discrete+SP",
                        true,
                        false,
                    )
                },
            )?;
            all_averaged.extend(results);
        }

        // 3. Integrated GPU + Shannon-Prime (compact embeddings)
        {
            let device = select_device("integrated");
            let gguf = gguf_path.clone();
            let delay = cli.delay;
            let results = run_bench_config(
                "Integrated GPU + Shannon-Prime (compact)",
                cli.iterations,
                cli.warmup,
                &cli.audio,
                |audio_path| {
                    bench_q4(
                        &gguf,
                        audio_path,
                        delay,
                        &device,
                        "integrated+SP",
                        true,
                        true,
                    )
                },
            )?;
            all_averaged.extend(results);
        }

        // 4. Hybrid (RTX encoder + iGPU decoder)
        {
            let gguf = gguf_path.clone();
            let delay = cli.delay;
            let results = run_bench_config(
                "Hybrid (RTX encoder + iGPU decoder)",
                cli.iterations,
                cli.warmup,
                &cli.audio,
                |audio_path| bench_q4_hybrid(&gguf, audio_path, delay, "hybrid"),
            )?;
            all_averaged.extend(results);
        }

        // 5. Hybrid + Pipelined (overlapped encode/decode with forced chunking)
        {
            let gguf = gguf_path.clone();
            let delay = cli.delay;
            let results = run_bench_config(
                "Hybrid + Pipelined (600-frame chunks)",
                cli.iterations,
                cli.warmup,
                &cli.audio,
                |audio_path| {
                    bench_q4_hybrid_pipelined(&gguf, audio_path, delay, 600, "hybrid+pipe")
                },
            )?;
            all_averaged.extend(results);
        }

        print_table(&all_averaged);
        print_comparison(&all_averaged);

        // JSON output
        if let Some(ref json_path) = cli.json_output {
            let report = BenchmarkReport {
                results: all_averaged,
                iterations: cli.iterations,
                warmup: cli.warmup,
                delay_tokens: cli.delay,
            };
            let json = serde_json::to_string_pretty(&report)?;
            std::fs::write(json_path, &json)?;
            println!("\nJSON results written to {json_path}");
        }
    } else {
        // ── Single mode benchmark ──
        let device = if cli.hybrid {
            select_device("discrete")
        } else {
            select_device(&cli.device)
        };

        let compact = cli.device == "integrated";
        let shannon_prime = cli.shannon_prime || cli.hybrid;

        let mode_name = if cli.hybrid {
            "hybrid"
        } else if shannon_prime {
            if compact {
                "integrated+SP"
            } else {
                "discrete+SP"
            }
        } else {
            match cli.device.as_str() {
                "integrated" => "integrated",
                "discrete" => "discrete",
                _ => "auto",
            }
        };

        let averaged = if cli.hybrid {
            let gguf_path = cli
                .gguf
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("--hybrid requires --gguf"))?
                .clone();
            let delay = cli.delay;
            run_bench_config(
                &format!("Hybrid (RTX + iGPU)"),
                cli.iterations,
                cli.warmup,
                &cli.audio,
                |audio_path| bench_q4_hybrid(&gguf_path, audio_path, delay, mode_name),
            )?
        } else if use_q4 {
            let gguf = cli.gguf.clone().unwrap();
            let delay = cli.delay;
            run_bench_config(
                &format!("Q4 GGUF ({mode_name})"),
                cli.iterations,
                cli.warmup,
                &cli.audio,
                |audio_path| {
                    bench_q4(
                        &gguf,
                        audio_path,
                        delay,
                        &device,
                        mode_name,
                        shannon_prime,
                        compact,
                    )
                },
            )?
        } else {
            let model_dir = cli.model.clone();
            let delay = cli.delay;
            run_bench_config(
                "f32 SafeTensors",
                cli.iterations,
                cli.warmup,
                &cli.audio,
                |audio_path| bench_f32(&model_dir, audio_path, delay, &device),
            )?
        };

        print_table(&averaged);

        // JSON output
        if let Some(ref json_path) = cli.json_output {
            let report = BenchmarkReport {
                results: averaged,
                iterations: cli.iterations,
                warmup: cli.warmup,
                delay_tokens: cli.delay,
            };
            let json = serde_json::to_string_pretty(&report)?;
            std::fs::write(json_path, &json)?;
            println!("\nJSON results written to {json_path}");
        }
    }

    Ok(())
}
