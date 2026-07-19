//! `voxtral transcribe` subcommand — speech-to-text.

use anyhow::{bail, Context, Result};
use burn::backend::Wgpu;
use burn::prelude::ElementConversion;
use burn::tensor::Tensor;
use clap::Parser;
use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tracing::info;

use voxtral_mini_realtime::audio::{
    chunk::{chunk_audio, needs_chunking, ChunkConfig},
    io::load_wav,
    mel::{MelConfig, MelSpectrogram},
    pad::{pad_audio, PadConfig},
    resample::resample_to_16k,
    AudioBuffer,
};
use voxtral_mini_realtime::models::time_embedding::TimeEmbedding;
use voxtral_mini_realtime::tokenizer::VoxtralTokenizer;
use voxtral_mini_realtime::tui::TuiState;

type Backend = Wgpu;

#[derive(Parser)]
pub struct Args {
    /// Audio file(s) to transcribe (WAV format).
    #[arg(short, long, required_unless_present = "audio_list")]
    audio: Vec<String>,

    /// File containing audio paths (one per line).
    #[arg(long, conflicts_with = "audio")]
    audio_list: Option<String>,

    /// BF16 SafeTensors model directory.
    #[arg(short, long, default_value = "models/voxtral", conflicts_with = "gguf")]
    model: String,

    /// Q4 GGUF model file (use instead of --model for quantized inference).
    #[arg(long, conflicts_with = "model")]
    gguf: Option<String>,

    /// Tekken tokenizer JSON (auto-discovered from model dir).
    #[arg(long)]
    tokenizer: Option<String>,

    /// Streaming lookahead in tokens (1 token = 80ms).
    #[arg(short, long, default_value = "6")]
    delay: usize,

    /// Max mel frames per chunk.
    #[arg(long, default_value_t = 1200)]
    max_mel_frames: usize,

    /// Show real-time waveform TUI during transcription.
    #[arg(long)]
    tui: bool,

    /// GPU device selection: "integrated", "discrete", or "auto" (default).
    /// Use "integrated" on Intel NUC / SVM systems for zero-copy CPU↔iGPU.
    #[arg(long, default_value = "auto")]
    device: String,

    /// Enable Shannon-Prime VHT2 KV cache compression (~4.6x).
    /// Reduces memory bandwidth in autoregressive decode, keeping KV cache
    /// in L3 on SVM architectures (Intel NUC, Android DSP).
    #[arg(long)]
    shannon_prime: bool,

    /// Hybrid split-device mode: encoder on discrete GPU (RTX), decoder on
    /// integrated GPU (iGPU) with Shannon-Prime KV cache compression.
    /// Maximizes throughput by using the RTX for fast encoding and the iGPU
    /// for zero-copy KV cache access via shared L3 on UMA/SVM architectures.
    #[arg(long)]
    hybrid: bool,

    /// Enable pipelined inference for chunked audio in hybrid mode.
    /// Overlaps encoding chunk N+1 on RTX while decoding chunk N on iGPU.
    /// Requires --hybrid. Most effective on long audio with multiple chunks.
    #[arg(long, requires = "hybrid")]
    pipelined: bool,
}

pub fn run(args: Args) -> Result<()> {
    let device = if args.hybrid {
        // In hybrid mode, the primary device is the discrete GPU (encoder).
        // The decoder device is handled separately inside the model.
        info!("Hybrid mode: encoder on discrete GPU, decoder on integrated GPU");
        burn::backend::wgpu::WgpuDevice::DiscreteGpu(0)
    } else {
        match args.device.as_str() {
            "integrated" => {
                info!("Using integrated GPU (SVM zero-copy mode)");
                burn::backend::wgpu::WgpuDevice::IntegratedGpu(0)
            }
            "discrete" => {
                info!("Using discrete GPU");
                burn::backend::wgpu::WgpuDevice::DiscreteGpu(0)
            }
            _ => Default::default(),
        }
    };

    if args.max_mel_frames == 0 {
        bail!("--max-mel-frames must be greater than 0");
    }

    // Collect audio paths
    let audio_paths: Vec<String> = if let Some(list_path) = &args.audio_list {
        std::fs::read_to_string(list_path)
            .with_context(|| format!("Failed to read audio list: {list_path}"))?
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| l.trim().to_string())
            .collect()
    } else {
        args.audio.clone()
    };

    if audio_paths.is_empty() {
        bail!("No audio files specified");
    }

    // Resolve tokenizer
    let tokenizer_path = match &args.tokenizer {
        Some(p) => PathBuf::from(p),
        None => {
            if args.gguf.is_some() {
                // Q4 path: try common locations
                let candidates = [
                    PathBuf::from("models/voxtral/tekken.json"),
                    PathBuf::from("models/tekken.json"),
                ];
                candidates.into_iter().find(|p| p.exists()).ok_or_else(|| {
                    anyhow::anyhow!(
                        "Tokenizer not found. Provide --tokenizer or place tekken.json in models/"
                    )
                })?
            } else {
                PathBuf::from(&args.model).join("tekken.json")
            }
        }
    };
    if !tokenizer_path.exists() {
        bail!("Tokenizer not found at {}", tokenizer_path.display());
    }

    info!("Loading tokenizer from {}", tokenizer_path.display());
    let tokenizer =
        VoxtralTokenizer::from_file(&tokenizer_path).context("Failed to load tokenizer")?;

    let mel_extractor = MelSpectrogram::new(MelConfig::voxtral());
    let pad_config = PadConfig::voxtral();
    let time_embed = TimeEmbedding::new(3072);
    let t_embed = time_embed.embed::<Backend>(args.delay as f32, &device);

    let use_compact = args.device == "integrated";
    let shannon_prime = args.shannon_prime || args.hybrid; // hybrid implies Shannon-Prime
    let model_state = if args.hybrid {
        load_model_hybrid(&args, &device)?
    } else {
        load_model(&args, &device, shannon_prime, use_compact)?
    };
    let chunk_config = ChunkConfig::voxtral().with_max_frames(args.max_mel_frames);

    // Set up optional TUI
    let tui_state = if args.tui {
        Some(TuiState::new())
    } else {
        None
    };

    // Launch TUI on a background thread if requested
    let tui_handle = tui_state.as_ref().map(|state| {
        let audio_buf = state.audio_buffer.clone();
        let transcription = state.transcription.clone();
        let status = state.status.clone();
        let should_quit = state.should_quit.clone();

        let tui_state_clone = TuiState {
            audio_buffer: audio_buf,
            transcription,
            status,
            should_quit,
        };
        std::thread::spawn(move || {
            let _ = voxtral_mini_realtime::tui::run_tui(&tui_state_clone);
        })
    });

    if let Some(ref state) = tui_state {
        state.set_status("model loaded — transcribing...");
    }

    for audio_path in &audio_paths {
        // Push raw audio to TUI waveform
        if let Some(ref state) = tui_state {
            if let Ok(audio_preview) = load_wav(audio_path) {
                state.push_audio(&audio_preview.samples);
            }
        }

        let text = run_with_chunk_hint(args.max_mel_frames, || {
            transcribe_one(
                audio_path,
                &model_state,
                &tokenizer,
                &mel_extractor,
                &pad_config,
                &chunk_config,
                &t_embed,
                &device,
                args.pipelined,
            )
        })?;

        if let Some(ref state) = tui_state {
            state.set_transcription(&text);
            state.set_status("done — press q to exit");
        } else {
            println!("{text}");
        }
    }

    // Wait for TUI to exit (user presses q)
    if let Some(handle) = tui_handle {
        let _ = handle.join();
    }

    // Print final transcription to stdout if TUI was used
    if let Some(ref state) = tui_state {
        if let Ok(t) = state.transcription.lock() {
            if !t.is_empty() {
                println!("{t}");
            }
        }
    }

    Ok(())
}

#[allow(clippy::large_enum_variant)]
enum ModelState {
    F32 {
        model: voxtral_mini_realtime::models::voxtral::VoxtralModel<Backend>,
    },
    Q4 {
        model: voxtral_mini_realtime::gguf::model::Q4VoxtralModel,
    },
}

fn load_model(
    args: &Args,
    device: &<Backend as burn::tensor::backend::Backend>::Device,
    shannon_prime: bool,
    compact: bool,
) -> Result<ModelState> {
    if let Some(gguf_path) = &args.gguf {
        use voxtral_mini_realtime::gguf::loader::Q4ModelLoader;
        let path = PathBuf::from(gguf_path);
        if !path.exists() {
            bail!("GGUF model not found at {}", path.display());
        }
        let start = Instant::now();
        info!("Loading Q4 GGUF model from {}", path.display());
        let mut loader = Q4ModelLoader::from_file(&path).context("Failed to open GGUF")?;
        let mut model = if compact {
            info!("Using compact mode (Q4 embeddings, ~216 MB instead of ~1.5 GiB)");
            loader
                .load_compact(device)
                .context("Failed to load Q4 model (compact)")?
        } else {
            loader.load(device).context("Failed to load Q4 model")?
        };
        if shannon_prime {
            // Decoder head_dim: d_model(3072) / n_heads(32) = 96... but the
            // actual GQA head_dim is 128 (independent parameter). Use the
            // model's reported head_dim.
            let head_dim = model.decoder().head_dim();
            info!(head_dim, "Enabling Shannon-Prime VHT2 KV cache compression");
            model.enable_shannon_prime(head_dim);
        }
        info!(
            elapsed_ms = start.elapsed().as_millis() as u64,
            "Q4 model loaded"
        );
        Ok(ModelState::Q4 { model })
    } else {
        use voxtral_mini_realtime::models::loader::VoxtralModelLoader;
        let model_dir = PathBuf::from(&args.model);
        let safetensors_path = model_dir.join("consolidated.safetensors");
        if !safetensors_path.exists() {
            bail!(
                "Model not found at {}\nDownload: hf download mistralai/Voxtral-Mini-4B-Realtime-2602 --local-dir {}",
                safetensors_path.display(),
                model_dir.display()
            );
        }
        let start = Instant::now();
        info!("Loading BF16 model from {}", model_dir.display());
        let loader = VoxtralModelLoader::from_file(&safetensors_path)
            .context("Failed to open model weights")?;
        let model = loader.load(device).context("Failed to load model")?;
        info!(
            elapsed_ms = start.elapsed().as_millis() as u64,
            "BF16 model loaded"
        );
        Ok(ModelState::F32 { model })
    }
}

/// Load model in hybrid split-device mode: encoder on discrete, decoder on integrated.
fn load_model_hybrid(
    args: &Args,
    encoder_device: &<Backend as burn::tensor::backend::Backend>::Device,
) -> Result<ModelState> {
    let gguf_path = args
        .gguf
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("--hybrid requires --gguf (Q4 model)"))?;

    use voxtral_mini_realtime::gguf::loader::Q4ModelLoader;
    let path = PathBuf::from(gguf_path);
    if !path.exists() {
        bail!("GGUF model not found at {}", path.display());
    }

    let decoder_device = burn::backend::wgpu::WgpuDevice::IntegratedGpu(0);

    let start = Instant::now();
    info!(
        "Loading Q4 GGUF model in hybrid mode from {}",
        path.display()
    );
    let mut loader = Q4ModelLoader::from_file(&path).context("Failed to open GGUF")?;
    let mut model = loader
        .load_hybrid(encoder_device, &decoder_device)
        .context("Failed to load Q4 model (hybrid)")?;

    let head_dim = model.decoder().head_dim();
    info!(
        head_dim,
        "Enabling Shannon-Prime VHT2 KV cache compression (hybrid)"
    );
    model.enable_shannon_prime(head_dim);

    info!(
        elapsed_ms = start.elapsed().as_millis() as u64,
        "Hybrid model loaded"
    );
    Ok(ModelState::Q4 { model })
}

#[allow(clippy::too_many_arguments)]
fn transcribe_one(
    audio_path: &str,
    model_state: &ModelState,
    tokenizer: &VoxtralTokenizer,
    mel_extractor: &MelSpectrogram,
    pad_config: &PadConfig,
    chunk_config: &ChunkConfig,
    t_embed: &Tensor<Backend, 3>,
    device: &<Backend as burn::tensor::backend::Backend>::Device,
    pipelined: bool,
) -> Result<String> {
    let start = Instant::now();
    info!(path = %audio_path, "Loading audio");
    let audio = load_wav(audio_path).with_context(|| format!("Failed to load {audio_path}"))?;

    let mut audio = if audio.sample_rate != 16000 {
        info!("Resampling to 16 kHz");
        resample_to_16k(&audio).context("Failed to resample audio")?
    } else {
        audio
    };
    audio.peak_normalize(0.95);
    let sample_rate = audio.sample_rate;

    let chunks = if needs_chunking(audio.samples.len(), chunk_config) {
        let chunks = chunk_audio(&audio.samples, chunk_config);
        info!(
            total_chunks = chunks.len(),
            max_mel_frames = chunk_config.max_mel_frames,
            "Chunking audio"
        );
        chunks
    } else {
        vec![voxtral_mini_realtime::audio::AudioChunk {
            samples: audio.samples.clone(),
            start_sample: 0,
            end_sample: audio.samples.len(),
            index: 0,
            is_last: true,
        }]
    };

    let total_chunks = chunks.len();
    let mut texts = Vec::new();

    // ── Pipelined path: collect all mel chunks, process in one pipelined call ──
    if pipelined {
        if let ModelState::Q4 { model } = model_state {
            if model.is_hybrid() {
                info!(
                    chunks = total_chunks,
                    "Starting pipelined hybrid transcription"
                );
                let mut mel_tensors = Vec::with_capacity(total_chunks);
                for chunk in &chunks {
                    let chunk_audio = AudioBuffer::new(chunk.samples.clone(), sample_rate);
                    let mel_tensor =
                        mel_tensor_from_audio(&chunk_audio, mel_extractor, pad_config, device)?;
                    mel_tensors.push(mel_tensor);
                }

                let (all_tokens, timing) =
                    model.transcribe_streaming_hybrid_pipelined(mel_tensors, t_embed.clone());

                info!(
                    encode_ms = format!("{:.1}", timing.encode_ms),
                    transfer_ms = format!("{:.1}", timing.transfer_ms),
                    decode_ms = format!("{:.1}", timing.decode_ms),
                    total_ms = format!("{:.1}", timing.total_ms),
                    "Pipelined transcription complete"
                );

                for generated in &all_tokens {
                    let text_tokens: Vec<u32> = generated
                        .iter()
                        .filter(|&&t| t >= 1000)
                        .map(|&t| t as u32)
                        .collect();
                    let text = tokenizer
                        .decode(&text_tokens)
                        .context("Failed to decode tokens")?;
                    if !text.trim().is_empty() {
                        texts.push(text.trim().to_string());
                    }
                }

                return Ok(texts.join(" "));
            }
        }
    }

    // ── Sequential path (default) ──
    for (i, chunk) in chunks.iter().enumerate() {
        if total_chunks > 1 {
            let elapsed = start.elapsed();
            let eta = if i > 0 {
                Duration::from_secs_f64(
                    elapsed.as_secs_f64() / i as f64 * (total_chunks - i) as f64,
                )
            } else {
                Duration::ZERO
            };
            info!(
                chunk = format!("{}/{}", i + 1, total_chunks),
                start_sec = format!("{:.2}", chunk.start_time(sample_rate)),
                end_sec = format!("{:.2}", chunk.end_time(sample_rate)),
                elapsed = format_duration(elapsed),
                eta = format_duration(eta),
                "Transcribing chunk"
            );
        }

        let chunk_audio = AudioBuffer::new(chunk.samples.clone(), sample_rate);
        let mel_tensor = mel_tensor_from_audio(&chunk_audio, mel_extractor, pad_config, device)?;

        let generated = match model_state {
            ModelState::Q4 { model } => {
                if model.is_hybrid() {
                    model.transcribe_streaming_hybrid(mel_tensor, t_embed.clone())
                } else {
                    model.transcribe_streaming(mel_tensor, t_embed.clone())
                }
            }
            ModelState::F32 { model } => {
                transcribe_f32(model, mel_tensor, t_embed.clone(), device)?
            }
        };

        let text_tokens: Vec<u32> = generated
            .iter()
            .filter(|&&t| t >= 1000)
            .map(|&t| t as u32)
            .collect();
        let text = tokenizer
            .decode(&text_tokens)
            .context("Failed to decode tokens")?;
        if !text.trim().is_empty() {
            texts.push(text.trim().to_string());
        }
    }

    Ok(texts.join(" "))
}

fn mel_tensor_from_audio(
    audio: &AudioBuffer,
    mel_extractor: &MelSpectrogram,
    pad_config: &PadConfig,
    device: &<Backend as burn::tensor::backend::Backend>::Device,
) -> Result<Tensor<Backend, 3>> {
    let padded = pad_audio(audio, pad_config);
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
    Ok(Tensor::from_data(
        burn::tensor::TensorData::new(mel_flat, [1, n_mels, n_frames]),
        device,
    ))
}

fn transcribe_f32(
    model: &voxtral_mini_realtime::models::voxtral::VoxtralModel<Backend>,
    mel_tensor: Tensor<Backend, 3>,
    t_embed: Tensor<Backend, 3>,
    device: &<Backend as burn::tensor::backend::Backend>::Device,
) -> Result<Vec<i32>> {
    use burn::tensor::Int;

    let audio_embeds = model.encode_audio(mel_tensor);
    let seq_len = audio_embeds.dims()[1];
    let d_model = audio_embeds.dims()[2];

    const PREFIX_LEN: usize = 38;
    const BOS_TOKEN: i32 = 1;
    const STREAMING_PAD: i32 = 32;

    if seq_len < PREFIX_LEN {
        return Ok(Vec::new());
    }

    let mut decoder_cache = model.create_decoder_cache_preallocated(seq_len, device);

    let mut prefix: Vec<i32> = vec![BOS_TOKEN];
    prefix.extend(std::iter::repeat_n(STREAMING_PAD, PREFIX_LEN - 1));

    let prefix_tensor = Tensor::<Backend, 2, Int>::from_data(
        burn::tensor::TensorData::new(prefix.clone(), [1, PREFIX_LEN]),
        device,
    );
    let prefix_text_embeds = model.decoder().embed_tokens(prefix_tensor);
    let prefix_audio = audio_embeds
        .clone()
        .slice([0..1, 0..PREFIX_LEN, 0..d_model]);
    let prefix_inputs = prefix_audio + prefix_text_embeds;
    let hidden = model.decoder().forward_hidden_with_cache(
        prefix_inputs,
        t_embed.clone(),
        &mut decoder_cache,
    );
    let logits = model.decoder().lm_head(hidden);
    let vocab_size = logits.dims()[2];
    let last_logits = logits.slice([0..1, (PREFIX_LEN - 1)..PREFIX_LEN, 0..vocab_size]);
    let first_token: i32 = last_logits.argmax(2).into_scalar().elem();

    let mut generated = prefix;
    generated.push(first_token);

    for pos in PREFIX_LEN + 1..seq_len {
        let new_token = generated[pos - 1];
        let token_tensor = Tensor::<Backend, 2, Int>::from_data(
            burn::tensor::TensorData::new(vec![new_token], [1, 1]),
            device,
        );
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
        let next_token: i32 = logits.argmax(2).into_scalar().elem();
        generated.push(next_token);
    }

    Ok(generated.into_iter().skip(PREFIX_LEN).collect())
}

fn format_duration(d: Duration) -> String {
    let s = d.as_secs();
    format!("{:02}:{:02}:{:02}", s / 3600, (s % 3600) / 60, s % 60)
}

fn run_with_chunk_hint<F, T>(max_mel_frames: usize, f: F) -> Result<T>
where
    F: FnOnce() -> Result<T>,
{
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(result) => result,
        Err(payload) => {
            let msg = panic_payload_to_string(payload.as_ref());
            if msg.contains("Unable to launch matmul")
                || msg.contains("shared memory bytes")
                || msg.contains("hardware limit is")
            {
                let suggested = (max_mel_frames - 200).max(600);
                bail!(
                    "GPU kernel launch failed (shared-memory limits).\n\
                     Try: --max-mel-frames {suggested} (current: {max_mel_frames})"
                );
            }
            bail!("Transcription panicked: {msg}");
        }
    }
}

fn panic_payload_to_string(payload: &(dyn Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<String>() {
        return s.clone();
    }
    if let Some(s) = payload.downcast_ref::<&str>() {
        return (*s).to_string();
    }
    "unknown panic payload".to_string()
}
