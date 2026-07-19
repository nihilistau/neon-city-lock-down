//! WASM bindings for Voxtral using Q4 GGUF weights and wgpu (WebGPU) backend.
//!
//! This module provides JavaScript-callable APIs for GPU-accelerated Q4 inference
//! in browsers with WebGPU support. The Q4 GGUF model is ~2GB, small enough to
//! load entirely in the browser.

#[cfg(target_family = "wasm")]
use wasm_bindgen::prelude::*;

use std::sync::OnceLock;

use burn::backend::wgpu::{Wgpu, WgpuDevice};
use burn::tensor::{Int, Tensor};

use crate::audio::chunk::{chunk_audio, needs_chunking, ChunkConfig};
use crate::audio::mel::{MelConfig, MelSpectrogram};
use crate::audio::pad::{pad_audio, PadConfig};
use crate::audio::AudioBuffer;
use crate::gguf::loader::Q4ModelLoader;
use crate::gguf::model::Q4VoxtralModel;
use crate::models::time_embedding::TimeEmbedding;
use crate::tokenizer::VoxtralTokenizer;

type Backend = Wgpu<f32, i32>;

/// Device initialized by `initWgpuDevice()` — used by `VoxtralQ4` instances.
static WGPU_DEVICE: OnceLock<WgpuDevice> = OnceLock::new();

fn wasm_log(msg: &str) {
    #[cfg(target_family = "wasm")]
    web_sys::console::log_1(&msg.into());
    #[cfg(not(target_family = "wasm"))]
    let _ = msg;
}

/// Initialize panic hook for better error messages in browser console.
#[cfg_attr(target_family = "wasm", wasm_bindgen(start))]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// Initialize the WebGPU device asynchronously.
///
/// **Must** be called (and awaited) before creating `VoxtralQ4`.
///
/// Manually creates the wgpu device requesting the adapter's full limits
/// (especially `max_compute_invocations_per_workgroup`) instead of relying
/// on `init_setup_async` which may end up with WebGPU spec-defaults (256).
#[cfg_attr(target_family = "wasm", wasm_bindgen(js_name = initWgpuDevice))]
pub async fn init_wgpu_device() {
    use burn::backend::wgpu::{init_device, RuntimeOptions, WgpuSetup};

    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends: wgpu::Backends::BROWSER_WEBGPU,
        ..Default::default()
    });

    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: None,
        })
        .await
        .expect("No WebGPU adapter found");

    let info = adapter.get_info();
    let adapter_limits = adapter.limits();
    wasm_log(&format!(
        "[wgpu] Adapter: {} ({:?}), backend: {:?}",
        info.name, info.device_type, info.backend
    ));
    wasm_log(&format!(
        "[wgpu] Adapter limits: max_compute_invocations_per_workgroup={}, workgroup_size=({},{},{}), max_buffer_size={}",
        adapter_limits.max_compute_invocations_per_workgroup,
        adapter_limits.max_compute_workgroup_size_x,
        adapter_limits.max_compute_workgroup_size_y,
        adapter_limits.max_compute_workgroup_size_z,
        adapter_limits.max_buffer_size,
    ));

    // Request device with the adapter's full limits — not spec defaults
    let features = adapter.features() - wgpu::Features::MAPPABLE_PRIMARY_BUFFERS;
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("voxtral-wgpu"),
            required_features: features,
            required_limits: adapter_limits,
            memory_hints: wgpu::MemoryHints::MemoryUsage,
            trace: wgpu::Trace::Off,
        })
        .await
        .expect("Failed to create WebGPU device");

    wasm_log(&format!(
        "[wgpu] Device created: max_compute_invocations_per_workgroup={}",
        device.limits().max_compute_invocations_per_workgroup,
    ));

    let setup = WgpuSetup {
        instance,
        adapter,
        device,
        queue,
        backend: info.backend,
    };

    let wgpu_device = init_device(setup, RuntimeOptions::default());
    WGPU_DEVICE.set(wgpu_device).ok();
}

/// Q4 GGUF Voxtral transcription model for browser use.
///
/// Loads a Q4-quantized GGUF model (split into ≤512 MB shards to stay
/// under the browser's 2 GB `ArrayBuffer` limit) and provides a simple
/// API for transcribing audio via WebGPU.
#[cfg_attr(target_family = "wasm", wasm_bindgen)]
pub struct VoxtralQ4 {
    model: Option<Q4VoxtralModel>,
    tokenizer: Option<VoxtralTokenizer>,
    mel_extractor: MelSpectrogram,
    pad_config: PadConfig,
    time_embed: TimeEmbedding,
    device: WgpuDevice,
    /// Sharded GGUF loading — each shard is kept as a separate Vec to stay
    /// under the WASM32 ~2 GB per-allocation limit.
    shard_bufs: Vec<Vec<u8>>,
}

#[cfg_attr(target_family = "wasm", wasm_bindgen)]
impl VoxtralQ4 {
    /// Create a new VoxtralQ4 instance.
    ///
    /// Call `initWgpuDevice()` first, then create this, then load GGUF weights.
    #[cfg_attr(target_family = "wasm", wasm_bindgen(constructor))]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        let device = WGPU_DEVICE
            .get()
            .cloned()
            .unwrap_or_else(WgpuDevice::default);
        Self {
            model: None,
            tokenizer: None,
            mel_extractor: MelSpectrogram::new(MelConfig::voxtral()),
            pad_config: PadConfig::voxtral(),
            time_embed: TimeEmbedding::new(3072),
            device,
            shard_bufs: Vec::new(),
        }
    }

    /// Load model weights from a GGUF byte array and tokenizer JSON.
    ///
    /// # Arguments
    /// * `gguf_bytes` - The Q4 GGUF model as a Uint8Array (~2GB)
    /// * `tokenizer_json` - The tokenizer configuration as a string (from tekken.json)
    #[cfg_attr(target_family = "wasm", wasm_bindgen(js_name = loadModel))]
    pub fn load_model(&mut self, gguf_bytes: &[u8], tokenizer_json: &str) -> Result<(), String> {
        // Load tokenizer from JSON string
        self.tokenizer = Some(
            VoxtralTokenizer::from_json(tokenizer_json)
                .map_err(|e| format!("Failed to load tokenizer: {}", e))?,
        );

        // Load Q4 model from GGUF bytes
        let mut loader = Q4ModelLoader::from_bytes(gguf_bytes)
            .map_err(|e| format!("Failed to parse GGUF: {}", e))?;

        self.model = Some(
            loader
                .load(&self.device)
                .map_err(|e| format!("Failed to load Q4 model: {}", e))?,
        );

        Ok(())
    }

    /// Append a GGUF shard to the internal buffer.
    ///
    /// Call this once per shard (in order), then call `loadModelFromShards`
    /// to parse and load the assembled GGUF.  Each shard should be ≤512 MB
    /// so it fits in a single browser `ArrayBuffer`.
    #[cfg_attr(target_family = "wasm", wasm_bindgen(js_name = appendModelShard))]
    pub fn append_model_shard(&mut self, shard: &[u8]) {
        self.shard_bufs.push(shard.to_vec());
    }

    /// Parse the accumulated shards as a GGUF file and load the model.
    ///
    /// Must be called after all shards have been appended via `appendModelShard`.
    /// Uses two-phase loading: all Q4 tensors are loaded first, then the GGUF
    /// reader is dropped (freeing ~2.5 GB of shard data), and finally the
    /// token embeddings are dequantized to f32 (~1.5 GiB).
    #[cfg_attr(target_family = "wasm", wasm_bindgen(js_name = loadModelFromShards))]
    pub fn load_model_from_shards(&mut self, tokenizer_json: &str) -> Result<(), String> {
        if self.shard_bufs.is_empty() {
            return Err("No shards appended. Call appendModelShard first.".into());
        }

        // Load tokenizer
        self.tokenizer = Some(
            VoxtralTokenizer::from_json(tokenizer_json)
                .map_err(|e| format!("Failed to load tokenizer: {}", e))?,
        );

        // Phase 1: Load all Q4 tensors from GGUF (tok_embeddings stay as raw Q4 bytes)
        let shards = std::mem::take(&mut self.shard_bufs);
        let parts = {
            let mut loader = Q4ModelLoader::from_shards(shards)
                .map_err(|e| format!("Failed to parse GGUF: {}", e))?;
            loader
                .load_deferred(&self.device)
                .map_err(|e| format!("Failed to load Q4 model: {}", e))?
            // loader (and its 2.5 GB shard data) dropped here
        };

        // Phase 2: Create Q4 tok_embeddings on GPU (~216 MB) with CPU copy for embed lookups
        self.model = Some(
            parts
                .finalize(&self.device)
                .map_err(|e| format!("Failed to finalize model: {}", e))?,
        );

        Ok(())
    }

    /// Check if the model is loaded and ready for transcription.
    #[cfg_attr(target_family = "wasm", wasm_bindgen(js_name = isReady))]
    pub fn is_ready(&self) -> bool {
        self.model.is_some() && self.tokenizer.is_some()
    }

    /// Transcribe audio to text.
    ///
    /// Long audio is automatically chunked to stay within WebGPU's shared
    /// memory limits (max 1200 mel frames per chunk, matching the CLI).
    ///
    /// # Arguments
    /// * `audio` - Audio samples as a Float32Array (must be 16kHz mono)
    ///
    /// # Returns
    /// The transcribed text.
    #[cfg_attr(target_family = "wasm", wasm_bindgen)]
    pub async fn transcribe(&self, audio: &[f32]) -> Result<String, String> {
        let model = self
            .model
            .as_ref()
            .ok_or("Model not loaded. Call loadModel first.")?;
        let tokenizer = self
            .tokenizer
            .as_ref()
            .ok_or("Tokenizer not loaded. Call loadModel first.")?;

        // Normalize peak amplitude — Q4 can't resolve subtle mel features from
        // quiet audio, so we lift to 0.95 before mel computation.
        let mut audio_buf = AudioBuffer {
            samples: audio.to_vec(),
            sample_rate: 16000,
        };
        audio_buf.peak_normalize(0.95);

        // Chunk long audio to stay within WebGPU shared memory limits.
        let chunk_config = ChunkConfig::voxtral().with_max_frames(1200);
        let sample_chunks = if needs_chunking(audio_buf.samples.len(), &chunk_config) {
            chunk_audio(&audio_buf.samples, &chunk_config)
        } else {
            vec![crate::audio::AudioChunk {
                samples: audio_buf.samples.clone(),
                start_sample: 0,
                end_sample: audio_buf.samples.len(),
                index: 0,
                is_last: true,
            }]
        };

        let t_embed = self.time_embed.embed::<Backend>(6.0, &self.device);
        let mut texts = Vec::new();

        for chunk in &sample_chunks {
            let chunk_audio = AudioBuffer::new(chunk.samples.clone(), audio_buf.sample_rate);
            let mel_tensor = self.audio_to_mel(&chunk_audio)?;

            let audio_embeds = model.encode_audio(mel_tensor);
            let generated_tokens = self
                .decode_with_cache_async(model, audio_embeds, t_embed.clone())
                .await?;

            let text_tokens: Vec<u32> = generated_tokens
                .iter()
                .filter(|&&t| t >= 1000)
                .map(|&t| t as u32)
                .collect();

            let text = tokenizer
                .decode(&text_tokens)
                .map_err(|e| format!("Failed to decode tokens: {}", e))?;

            if !text.trim().is_empty() {
                texts.push(text.trim().to_string());
            }
        }

        Ok(texts.join(" "))
    }

    /// Convert an audio buffer to a mel spectrogram tensor.
    fn audio_to_mel(&self, audio: &AudioBuffer) -> Result<Tensor<Backend, 3>, String> {
        let padded = pad_audio(audio, &self.pad_config);
        let mel = self.mel_extractor.compute_log(&padded.samples);
        let n_frames = mel.len();
        let n_mels = if n_frames > 0 { mel[0].len() } else { 0 };

        if n_frames == 0 {
            return Err("Audio too short to produce mel frames".to_string());
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
            &self.device,
        ))
    }

    /// Get the expected sample rate for input audio.
    #[cfg_attr(target_family = "wasm", wasm_bindgen(js_name = getSampleRate))]
    pub fn get_sample_rate(&self) -> u32 {
        16000
    }
}

impl VoxtralQ4 {
    /// Async autoregressive decode loop for WASM compatibility.
    ///
    /// Uses `into_data_async().await` instead of `into_scalar().elem()` to
    /// avoid the synchronous `block_on()` that panics in the browser.
    async fn decode_with_cache_async(
        &self,
        model: &Q4VoxtralModel,
        audio_embeds: Tensor<Backend, 3>,
        t_embed: Tensor<Backend, 3>,
    ) -> Result<Vec<i32>, String> {
        let seq_len = audio_embeds.dims()[1];
        let d_model = audio_embeds.dims()[2];

        const PREFIX_LEN: usize = 38;
        const BOS_TOKEN: i32 = 1;
        const STREAMING_PAD: i32 = 32;

        if seq_len < PREFIX_LEN {
            return Ok(Vec::new());
        }

        let mut decoder_cache = model.decoder().create_cache();

        // Build prefix: BOS + 37 STREAMING_PAD
        let mut prefix: Vec<i32> = vec![BOS_TOKEN];
        prefix.extend(std::iter::repeat_n(STREAMING_PAD, PREFIX_LEN - 1));

        // Embed prefix tokens (from CPU IDs — avoids GPU readback on WASM)
        let prefix_text_embeds = model
            .decoder()
            .embed_tokens_from_ids(&prefix, 1, PREFIX_LEN);

        // Slice audio embeddings for prefix
        let prefix_audio = audio_embeds
            .clone()
            .slice([0..1, 0..PREFIX_LEN, 0..d_model]);

        // Combine and run forward
        let prefix_inputs = prefix_audio + prefix_text_embeds;
        let hidden = model.decoder().forward_hidden_with_cache(
            prefix_inputs,
            t_embed.clone(),
            &mut decoder_cache,
        );
        let logits = model.decoder().lm_head(hidden);

        // Get first prediction (async-safe)
        let vocab_size = logits.dims()[2];
        let last_logits = logits.slice([0..1, (PREFIX_LEN - 1)..PREFIX_LEN, 0..vocab_size]);
        let first_pred = last_logits.argmax(2);
        let first_token: i32 = Tensor::<Backend, 3, Int>::into_data_async(first_pred)
            .await
            .map_err(|e| format!("Failed to read prediction tensor: {e}"))?
            .to_vec::<i32>()
            .map_err(|e| format!("Failed to extract prediction data: {e}"))?[0];

        let mut generated = prefix;
        generated.push(first_token);

        // Autoregressive generation with cache
        for pos in PREFIX_LEN + 1..seq_len {
            let new_token = generated[pos - 1];
            let text_embed = model.decoder().embed_tokens_from_ids(&[new_token], 1, 1);

            let audio_pos = audio_embeds
                .clone()
                .slice([0..1, (pos - 1)..pos, 0..d_model]);

            let input = audio_pos + text_embed;
            let hidden = model.decoder().forward_hidden_with_cache(
                input,
                t_embed.clone(),
                &mut decoder_cache,
            );
            let logits = model.decoder().lm_head(hidden);

            let pred = logits.argmax(2);
            let next_token: i32 = Tensor::<Backend, 3, Int>::into_data_async(pred)
                .await
                .map_err(|e| format!("Failed to read prediction tensor: {e}"))?
                .to_vec::<i32>()
                .map_err(|e| format!("Failed to extract prediction data: {e}"))?[0];
            generated.push(next_token);
        }

        Ok(generated.into_iter().skip(PREFIX_LEN).collect())
    }
}

impl Default for VoxtralQ4 {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tekken tokenizer for browser TTS
// ---------------------------------------------------------------------------

use crate::tokenizer::TekkenEncoder;

/// Tekken BPE tokenizer for browser use.
///
/// Loads from a tekken.json string and encodes text to token IDs.
#[cfg_attr(target_family = "wasm", wasm_bindgen)]
pub struct TekkenTokenizerWasm {
    encoder: TekkenEncoder,
}

#[cfg_attr(target_family = "wasm", wasm_bindgen)]
impl TekkenTokenizerWasm {
    /// Load tokenizer from a JSON string (fetched from HuggingFace).
    #[cfg_attr(target_family = "wasm", wasm_bindgen(constructor))]
    pub fn new(json: &str) -> Result<TekkenTokenizerWasm, String> {
        let encoder =
            TekkenEncoder::from_json(json).map_err(|e| format!("Failed to load tokenizer: {e}"))?;
        Ok(Self { encoder })
    }

    /// Encode text to token IDs (Uint32Array).
    pub fn encode(&self, text: &str) -> Vec<u32> {
        self.encoder.encode(text)
    }
}

// ---------------------------------------------------------------------------
// VoxtralTts — Q4 TTS pipeline for browser
// ---------------------------------------------------------------------------

use crate::gguf::tts_loader::Q4TtsModelLoader;
use crate::gguf::tts_model::{Q4FmTransformer, Q4TtsBackbone};
use crate::tts::backbone::GeneratedFrame;
use crate::tts::codec::CodecDecoder;
use crate::tts::config::{AudioCodebookLayout, TtsSpecialTokens};
use crate::tts::embeddings::AudioCodebookEmbeddings;
use crate::tts::voice::load_voice_from_bytes;

/// Q4 GGUF Voxtral TTS model for browser use.
///
/// Loads a Q4-quantized GGUF model (split into ≤512 MB shards) and provides
/// an async API for synthesizing speech via WebGPU.
#[cfg_attr(target_family = "wasm", wasm_bindgen)]
pub struct VoxtralTts {
    backbone: Option<Q4TtsBackbone>,
    fm: Option<Q4FmTransformer>,
    codec: Option<CodecDecoder<Wgpu>>,
    codebook: Option<AudioCodebookEmbeddings<Wgpu>>,
    device: WgpuDevice,
    shard_bufs: Vec<Vec<u8>>,
    voice_embed: Option<Tensor<Wgpu, 2>>,
}

#[cfg_attr(target_family = "wasm", wasm_bindgen)]
impl VoxtralTts {
    /// Create a new VoxtralTts instance.
    ///
    /// Call `initWgpuDevice()` first, then create this, then load GGUF weights.
    #[cfg_attr(target_family = "wasm", wasm_bindgen(constructor))]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        let device = WGPU_DEVICE
            .get()
            .cloned()
            .unwrap_or_else(WgpuDevice::default);
        Self {
            backbone: None,
            fm: None,
            codec: None,
            codebook: None,
            device,
            shard_bufs: Vec::new(),
            voice_embed: None,
        }
    }

    /// Append a GGUF shard to the internal buffer.
    #[cfg_attr(target_family = "wasm", wasm_bindgen(js_name = appendModelShard))]
    pub fn append_model_shard(&mut self, shard: &[u8]) {
        self.shard_bufs.push(shard.to_vec());
    }

    /// Parse the accumulated shards as a GGUF file and load the TTS model.
    ///
    /// Uses two-phase loading: Q4 tensors loaded first, then GGUF reader
    /// dropped (freeing shard memory), then tok_embeddings finalized.
    #[cfg_attr(target_family = "wasm", wasm_bindgen(js_name = loadModelFromShards))]
    pub fn load_model_from_shards(&mut self) -> Result<(), String> {
        if self.shard_bufs.is_empty() {
            return Err("No shards appended. Call appendModelShard first.".into());
        }

        let shards = std::mem::take(&mut self.shard_bufs);
        let parts = {
            let mut loader = Q4TtsModelLoader::from_shards(shards)
                .map_err(|e| format!("Failed to parse GGUF: {e}"))?;
            loader
                .load_deferred(&self.device)
                .map_err(|e| format!("Failed to load Q4 TTS model: {e}"))?
        };

        let (backbone, fm, codec) = parts
            .finalize()
            .map_err(|e| format!("Failed to finalize TTS model: {e}"))?;

        // Build AudioCodebookEmbeddings from backbone's table
        let layout = AudioCodebookLayout::default();
        let codebook =
            AudioCodebookEmbeddings::new(backbone.audio_codebook_embeddings().clone(), layout);

        self.backbone = Some(backbone);
        self.fm = Some(fm);
        self.codec = Some(codec);
        self.codebook = Some(codebook);

        Ok(())
    }

    /// Load a voice embedding from SafeTensors bytes.
    ///
    /// Call this before `synthesize()`. Voices are ~200 KB each.
    #[cfg_attr(target_family = "wasm", wasm_bindgen(js_name = loadVoice))]
    pub fn load_voice(&mut self, voice_bytes: &[u8]) -> Result<(), String> {
        let embed: Tensor<Wgpu, 2> = load_voice_from_bytes(voice_bytes, 3072, &self.device)
            .map_err(|e| format!("Failed to load voice: {e}"))?;
        self.voice_embed = Some(embed);
        Ok(())
    }

    /// Check if the model and a voice are loaded.
    #[cfg_attr(target_family = "wasm", wasm_bindgen(js_name = isReady))]
    pub fn is_ready(&self) -> bool {
        self.backbone.is_some() && self.voice_embed.is_some()
    }

    /// Synthesize speech from token IDs.
    ///
    /// Returns a Float32Array of 24 kHz audio samples.
    #[cfg_attr(target_family = "wasm", wasm_bindgen)]
    pub async fn synthesize(&self, token_ids: &[u32], max_frames: u32) -> Result<Vec<f32>, String> {
        let backbone = self
            .backbone
            .as_ref()
            .ok_or("Model not loaded. Call loadModelFromShards first.")?;
        let fm = self.fm.as_ref().ok_or("FM transformer not loaded.")?;
        let codec = self.codec.as_ref().ok_or("Codec not loaded.")?;
        let codebook = self.codebook.as_ref().ok_or("Codebook not loaded.")?;
        let voice_embed = self
            .voice_embed
            .as_ref()
            .ok_or("No voice loaded. Call loadVoice first.")?;

        // Build input sequence using Q4 backbone's CPU-side embedding lookup
        let input_sequence =
            self.build_input_sequence_q4(backbone, voice_embed.clone(), token_ids)?;

        // Async autoregressive decode (uses into_data_async for WASM safety)
        let frames = backbone
            .generate_async(input_sequence, fm, codebook, max_frames as usize)
            .await?;

        if frames.is_empty() {
            return Ok(Vec::new());
        }

        // Codec decode → waveform
        let samples = self.decode_frames_async(codec, &frames).await?;
        Ok(samples)
    }
}

impl VoxtralTts {
    /// Build the TTS input sequence using Q4 backbone's CPU-side embedding lookup.
    fn build_input_sequence_q4(
        &self,
        backbone: &Q4TtsBackbone,
        voice_embeddings: Tensor<Wgpu, 2>,
        text_token_ids: &[u32],
    ) -> Result<Tensor<Wgpu, 3>, String> {
        let special = TtsSpecialTokens::default();
        let dim = backbone.d_model();

        // Embed special tokens via CPU Q4 dequant (WASM-safe)
        let bos_embed = backbone.embed_tokens_from_ids(&[special.bos_token_id as i32], 1, 1);
        let begin_audio_embed =
            backbone.embed_tokens_from_ids(&[special.begin_audio_token_id as i32], 1, 1);
        let next_audio_text_embed =
            backbone.embed_tokens_from_ids(&[special.next_audio_text_token_id as i32], 1, 1);
        let repeat_audio_text_embed =
            backbone.embed_tokens_from_ids(&[special.repeat_audio_text_token_id as i32], 1, 1);

        // Embed text tokens
        let text_ids: Vec<i32> = text_token_ids.iter().map(|&id| id as i32).collect();
        let text_embeds = if text_ids.is_empty() {
            Tensor::<Wgpu, 3>::zeros([1, 0, dim], &self.device)
        } else {
            backbone.embed_tokens_from_ids(&text_ids, 1, text_ids.len())
        };

        // Voice embeddings: [N, dim] → [1, N, dim]
        let voice_3d = voice_embeddings.unsqueeze_dim::<3>(0);

        // Concatenate: [BOS, BEGIN_AUDIO, voice, NEXT_AUDIO_TEXT, text, REPEAT_AUDIO_TEXT, BEGIN_AUDIO]
        let sequence = Tensor::cat(
            vec![
                bos_embed,
                begin_audio_embed.clone(),
                voice_3d,
                next_audio_text_embed,
                text_embeds,
                repeat_audio_text_embed,
                begin_audio_embed,
            ],
            1,
        );

        Ok(sequence)
    }

    /// Decode generated frames through the codec to produce audio samples.
    async fn decode_frames_async(
        &self,
        codec: &CodecDecoder<Wgpu>,
        frames: &[GeneratedFrame],
    ) -> Result<Vec<f32>, String> {
        let n_frames = frames.len();

        let semantic_indices: Vec<usize> = frames.iter().map(|f| f.semantic_idx).collect();

        let mut acoustic_data = Vec::with_capacity(n_frames * 36);
        for frame in frames {
            for &level in &frame.acoustic_levels {
                acoustic_data.push(level as f32);
            }
        }
        let acoustic_indices: Tensor<Wgpu, 2> = Tensor::from_data(
            burn::tensor::TensorData::new(acoustic_data, [n_frames, 36]),
            &self.device,
        );

        let waveform = codec.decode(&semantic_indices, acoustic_indices);
        let [_batch, total_samples] = waveform.dims();

        // Async readback of waveform samples
        let wav_data = Tensor::<Wgpu, 2>::into_data_async(waveform)
            .await
            .map_err(|e| format!("waveform readback: {e}"))?;
        let mut samples: Vec<f32> = wav_data
            .to_vec::<f32>()
            .map_err(|e| format!("waveform vec: {e}"))?;
        samples.truncate(total_samples);

        // Peak normalize to 0.95
        let peak = samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        if peak > 1e-6 {
            let gain = 0.95 / peak;
            for s in &mut samples {
                *s *= gain;
            }
        }

        Ok(samples)
    }
}

impl Default for VoxtralTts {
    fn default() -> Self {
        Self::new()
    }
}
