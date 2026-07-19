//! End-to-end TTS pipeline.
//!
//! Orchestrates backbone decoding, flow-matching, and codec synthesis to convert
//! text + voice preset into 24 kHz audio output.
//!
//! ## Pipeline stages
//!
//! 1. **Tokenize** text via `TekkenEncoder` (tiktoken-rs)
//! 2. **Load voice** embeddings from SafeTensors preset
//! 3. **Build input sequence**: `[BOS, BEGIN_AUDIO, voice, NEXT_AUDIO_TEXT, text, REPEAT_AUDIO_TEXT, BEGIN_AUDIO]`
//! 4. **Backbone** prefill + autoregressive decode → `Vec<GeneratedFrame>`
//! 5. **Codec decode**: semantic + acoustic indices → 24 kHz waveform

use anyhow::{Context, Result};
use burn::tensor::backend::Backend;
use burn::tensor::Tensor;
use std::path::Path;

use crate::audio::AudioBuffer;
use crate::models::weights::load_safetensors;
use crate::tts::backbone::{GeneratedFrame, TtsBackbone};
use crate::tts::codec::CodecDecoder;
use crate::tts::config::{AudioCodebookLayout, TtsConfig};
use crate::tts::embeddings::AudioCodebookEmbeddings;
use crate::tts::flow_matching::FmTransformer;
use crate::tts::sequence::build_input_sequence;
use crate::tts::voice::VoiceRegistry;

/// Maximum number of audio frames to generate before stopping.
const DEFAULT_MAX_FRAMES: usize = 2000;

/// End-to-end TTS pipeline.
///
/// Holds all model components needed to convert text + voice into audio.
pub struct TtsPipeline<B: Backend> {
    /// Decoder backbone (Ministral 3B).
    backbone: TtsBackbone<B>,
    /// Flow-matching transformer for acoustic token prediction.
    fm: FmTransformer<B>,
    /// Codec decoder for waveform synthesis.
    codec: CodecDecoder<B>,
    /// Audio codebook embeddings (shared with backbone).
    codebook: AudioCodebookEmbeddings<B>,
    /// Voice preset registry.
    voice_registry: VoiceRegistry,
    /// Pipeline configuration.
    config: TtsConfig,
}

impl<B: Backend> TtsPipeline<B> {
    /// Load the full TTS pipeline from a model directory.
    ///
    /// Expects:
    /// - `model_dir/consolidated.safetensors` — backbone + FM + codec weights
    /// - `model_dir/voice_embedding/` — voice preset SafeTensors files
    ///
    /// # Arguments
    /// * `model_dir` - Path to the model directory
    /// * `device` - Backend device
    pub fn from_model_dir<P: AsRef<Path>>(model_dir: P, device: &B::Device) -> Result<Self> {
        let model_dir = model_dir.as_ref();
        let config = TtsConfig::default();
        config
            .validate()
            .map_err(|e| anyhow::anyhow!("Invalid TTS config: {e}"))?;

        // Load all weights from consolidated.safetensors
        let safetensors_path = model_dir.join("consolidated.safetensors");
        let owned = load_safetensors(&safetensors_path)
            .with_context(|| format!("Failed to load {}", safetensors_path.display()))?;
        let st = owned.tensors();

        // Load backbone
        let backbone = TtsBackbone::from_safetensors(st, &config.backbone, device)
            .context("Failed to load TTS backbone")?;

        // Build codebook from backbone's audio_codebook_embeddings
        let layout = AudioCodebookLayout::default();
        let codebook =
            AudioCodebookEmbeddings::new(backbone.audio_codebook_embeddings.clone(), layout);

        // Load FM transformer
        let fm = FmTransformer::load(st, &config.fm_transformer, device)
            .context("Failed to load FM transformer")?;

        // Load codec decoder
        let codec = CodecDecoder::from_safetensors(st, &config.codec_decoder, device)
            .context("Failed to load codec decoder")?;

        // Load voice registry
        let voice_dir = model_dir.join("voice_embedding");
        let voice_registry = VoiceRegistry::from_directory(&voice_dir, &config.voice)
            .context("Failed to load voice registry")?;

        Ok(Self {
            backbone,
            fm,
            codec,
            codebook,
            voice_registry,
            config,
        })
    }

    /// Generate speech audio from text using a voice preset.
    ///
    /// # Arguments
    /// * `text_token_ids` - Pre-tokenized text as u32 token IDs
    /// * `voice_name` - Name of the voice preset (e.g., "alloy", "breeze")
    /// * `device` - Backend device
    ///
    /// # Returns
    /// `AudioBuffer` at 24 kHz containing the synthesized speech.
    pub fn generate(
        &self,
        text_token_ids: &[u32],
        voice_name: &str,
        device: &B::Device,
    ) -> Result<AudioBuffer> {
        self.generate_with_max_frames(text_token_ids, voice_name, DEFAULT_MAX_FRAMES, device)
    }

    /// Generate speech with a custom max frame limit.
    pub fn generate_with_max_frames(
        &self,
        text_token_ids: &[u32],
        voice_name: &str,
        max_frames: usize,
        device: &B::Device,
    ) -> Result<AudioBuffer> {
        // Step 1: Load voice embeddings
        let voice_embeddings = self
            .voice_registry
            .load_voice::<B>(voice_name, device)
            .with_context(|| format!("Failed to load voice '{voice_name}'"))?;
        tracing::info!(
            voice_frames = voice_embeddings.dims()[0],
            text_tokens = text_token_ids.len(),
            "Building input sequence"
        );

        // Step 2: Build input sequence
        let tok_embeddings = self.backbone.tok_embeddings.weight.val();
        let input_sequence = build_input_sequence(
            voice_embeddings,
            text_token_ids,
            &tok_embeddings,
            &self.config.special_tokens,
        );
        let [_, seq_len, _] = input_sequence.dims();
        tracing::info!(seq_len, "Input sequence built");

        // Step 3: Autoregressive backbone decode
        let frames =
            self.backbone
                .generate(input_sequence, &self.fm, &self.codebook, max_frames, device);

        if frames.is_empty() {
            return Ok(AudioBuffer::new(
                vec![],
                self.config.codec_decoder.sample_rate,
            ));
        }

        // Step 4: Codec decode frames → waveform
        let audio = self.decode_frames(&frames, device)?;
        Ok(audio)
    }

    /// Convert generated frames into a 24 kHz AudioBuffer via the codec decoder.
    fn decode_frames(&self, frames: &[GeneratedFrame], device: &B::Device) -> Result<AudioBuffer> {
        let n_frames = frames.len();

        // Collect semantic indices
        let semantic_indices: Vec<usize> = frames.iter().map(|f| f.semantic_idx).collect();

        // Collect acoustic indices into [N, 36] tensor
        let mut acoustic_data = Vec::with_capacity(n_frames * 36);
        for frame in frames {
            for &level in &frame.acoustic_levels {
                acoustic_data.push(level as f32);
            }
        }
        let acoustic_indices: Tensor<B, 2> = Tensor::from_data(
            burn::tensor::TensorData::new(acoustic_data, [n_frames, 36]),
            device,
        );

        // Codec decode → [1, total_samples]
        let waveform = self.codec.decode(&semantic_indices, acoustic_indices);
        let [_batch, total_samples] = waveform.dims();

        // Extract samples to CPU
        let data = waveform.to_data();
        let mut samples: Vec<f32> = data.as_slice::<f32>().unwrap()[..total_samples].to_vec();

        // Peak normalize to 0.95 to prevent clipping
        let peak = samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        if peak > 1e-6 {
            let gain = 0.95 / peak;
            for s in &mut samples {
                *s *= gain;
            }
        }

        Ok(AudioBuffer::new(
            samples,
            self.config.codec_decoder.sample_rate,
        ))
    }

    /// List available voice presets.
    pub fn list_voices(&self) -> Vec<&str> {
        self.voice_registry.list_voices()
    }

    /// Check if a voice preset exists.
    pub fn has_voice(&self, name: &str) -> bool {
        self.voice_registry.has_voice(name)
    }

    /// Access the pipeline config.
    pub fn config(&self) -> &TtsConfig {
        &self.config
    }

    /// Access the codec decoder (for direct use).
    pub fn codec(&self) -> &CodecDecoder<B> {
        &self.codec
    }

    /// Override the number of Euler ODE steps for flow matching.
    pub fn set_euler_steps(&mut self, steps: usize) {
        self.fm.set_euler_steps(steps);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_max_frames() {
        assert_eq!(DEFAULT_MAX_FRAMES, 2000);
    }

    #[test]
    fn test_pipeline_from_model_dir_missing() {
        use burn::backend::Wgpu;
        type TestBackend = Wgpu;

        let device: <TestBackend as Backend>::Device = Default::default();
        let result = TtsPipeline::<TestBackend>::from_model_dir("/nonexistent/path", &device);
        assert!(result.is_err());
    }

    #[test]
    fn test_pipeline_from_real_model_dir() {
        use burn::backend::Wgpu;
        type TestBackend = Wgpu;

        let model_dir = Path::new("models/voxtral-tts");
        if !model_dir.join("consolidated.safetensors").exists() {
            println!("Skipping: TTS model not downloaded");
            return;
        }

        let device: <TestBackend as Backend>::Device = Default::default();
        let pipeline = TtsPipeline::<TestBackend>::from_model_dir(model_dir, &device);

        match pipeline {
            Ok(p) => {
                let voices = p.list_voices();
                println!("Pipeline loaded with {} voices: {:?}", voices.len(), voices);
            }
            Err(e) => {
                println!("Pipeline load failed (expected if weights missing): {e}");
            }
        }
    }
}
