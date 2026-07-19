//! TTS configuration structs.
//!
//! Defines configs for the three TTS pipeline stages (backbone, flow-matching
//! transformer, codec decoder) plus special token IDs and voice embedding metadata.

use serde::{Deserialize, Serialize};

/// Decoder backbone configuration (Ministral 3B architecture).
///
/// Identical to the ASR decoder except: no ADA RMSNorm, no sliding window
/// specified in weights, and RoPE theta = 1M.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TtsBackboneConfig {
    /// Number of transformer layers.
    #[serde(default = "default_backbone_n_layers")]
    pub n_layers: usize,
    /// Model hidden dimension.
    #[serde(default = "default_backbone_dim")]
    pub dim: usize,
    /// Number of query attention heads.
    #[serde(default = "default_backbone_n_heads")]
    pub n_heads: usize,
    /// Number of KV attention heads (GQA).
    #[serde(default = "default_backbone_n_kv_heads")]
    pub n_kv_heads: usize,
    /// Per-head dimension.
    #[serde(default = "default_backbone_head_dim")]
    pub head_dim: usize,
    /// SwiGLU FFN hidden dimension.
    #[serde(default = "default_backbone_ffn_dim")]
    pub ffn_dim: usize,
    /// RoPE theta for positional encoding.
    #[serde(default = "default_backbone_rope_theta")]
    pub rope_theta: f64,
    /// Vocabulary size (Tekken tokenizer).
    #[serde(default = "default_vocab_size")]
    pub vocab_size: usize,
    /// Whether token embeddings are tied with the LM head.
    #[serde(default = "default_true")]
    pub tied_embeddings: bool,
    /// RMSNorm epsilon.
    #[serde(default = "default_norm_eps")]
    pub norm_eps: f64,
}

impl Default for TtsBackboneConfig {
    fn default() -> Self {
        Self {
            n_layers: default_backbone_n_layers(),
            dim: default_backbone_dim(),
            n_heads: default_backbone_n_heads(),
            n_kv_heads: default_backbone_n_kv_heads(),
            head_dim: default_backbone_head_dim(),
            ffn_dim: default_backbone_ffn_dim(),
            rope_theta: default_backbone_rope_theta(),
            vocab_size: default_vocab_size(),
            tied_embeddings: true,
            norm_eps: default_norm_eps(),
        }
    }
}

impl TtsBackboneConfig {
    /// GQA group size (queries per KV head).
    pub fn gqa_groups(&self) -> usize {
        self.n_heads / self.n_kv_heads
    }

    /// Validate config invariants.
    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.n_layers == 0 {
            return Err(ConfigError::InvalidValue("n_layers must be > 0".into()));
        }
        if self.dim == 0 {
            return Err(ConfigError::InvalidValue("dim must be > 0".into()));
        }
        if self.n_heads == 0 || self.n_kv_heads == 0 {
            return Err(ConfigError::InvalidValue(
                "n_heads and n_kv_heads must be > 0".into(),
            ));
        }
        if !self.n_heads.is_multiple_of(self.n_kv_heads) {
            return Err(ConfigError::InvalidValue(
                "n_heads must be divisible by n_kv_heads".into(),
            ));
        }
        if !self.dim.is_multiple_of(self.n_heads) {
            return Err(ConfigError::InvalidValue(
                "dim must be divisible by n_heads".into(),
            ));
        }
        Ok(())
    }
}

/// Flow-matching transformer configuration.
///
/// A small bidirectional (non-causal) transformer that predicts acoustic tokens
/// from backbone hidden states via an Euler ODE solver.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FmTransformerConfig {
    /// Number of transformer layers.
    #[serde(default = "default_fm_n_layers")]
    pub n_layers: usize,
    /// Model hidden dimension.
    #[serde(default = "default_backbone_dim")]
    pub dim: usize,
    /// Number of query attention heads.
    #[serde(default = "default_backbone_n_heads")]
    pub n_heads: usize,
    /// Number of KV attention heads (GQA).
    #[serde(default = "default_backbone_n_kv_heads")]
    pub n_kv_heads: usize,
    /// Per-head dimension.
    #[serde(default = "default_backbone_head_dim")]
    pub head_dim: usize,
    /// SwiGLU FFN hidden dimension.
    #[serde(default = "default_backbone_ffn_dim")]
    pub ffn_dim: usize,
    /// RoPE theta (10K, different from backbone's 1M).
    #[serde(default = "default_fm_rope_theta")]
    pub rope_theta: f64,
    /// RMSNorm epsilon.
    #[serde(default = "default_norm_eps")]
    pub norm_eps: f64,
    /// Acoustic state dimensionality (FSQ 36 dims).
    #[serde(default = "default_acoustic_dim")]
    pub acoustic_dim: usize,
    /// Semantic codebook output size (8192 VQ + 128 specials).
    #[serde(default = "default_semantic_output_size")]
    pub semantic_output_size: usize,
    /// Number of Euler ODE steps.
    #[serde(default = "default_euler_steps")]
    pub euler_steps: usize,
    /// Classifier-free guidance scale.
    #[serde(default = "default_cfg_alpha")]
    pub cfg_alpha: f32,
}

impl Default for FmTransformerConfig {
    fn default() -> Self {
        Self {
            n_layers: default_fm_n_layers(),
            dim: default_backbone_dim(),
            n_heads: default_backbone_n_heads(),
            n_kv_heads: default_backbone_n_kv_heads(),
            head_dim: default_backbone_head_dim(),
            ffn_dim: default_backbone_ffn_dim(),
            rope_theta: default_fm_rope_theta(),
            norm_eps: default_norm_eps(),
            acoustic_dim: default_acoustic_dim(),
            semantic_output_size: default_semantic_output_size(),
            euler_steps: default_euler_steps(),
            cfg_alpha: default_cfg_alpha(),
        }
    }
}

impl FmTransformerConfig {
    /// Validate config invariants.
    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.n_layers == 0 {
            return Err(ConfigError::InvalidValue("n_layers must be > 0".into()));
        }
        if self.dim == 0 {
            return Err(ConfigError::InvalidValue("dim must be > 0".into()));
        }
        if !self.n_heads.is_multiple_of(self.n_kv_heads) {
            return Err(ConfigError::InvalidValue(
                "n_heads must be divisible by n_kv_heads".into(),
            ));
        }
        if self.euler_steps == 0 {
            return Err(ConfigError::InvalidValue("euler_steps must be > 0".into()));
        }
        Ok(())
    }
}

/// Codec decoder configuration.
///
/// Conv-transformer autoencoder that converts tokens back to a 24 kHz waveform.
/// Uses ALiBi positional bias, QK-norm, LayerScale, and weight-normed convolutions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CodecDecoderConfig {
    /// Hidden dimension for transformer layers.
    #[serde(default = "default_codec_dim")]
    pub dim: usize,
    /// Number of MHA heads (not GQA).
    #[serde(default = "default_codec_n_heads")]
    pub n_heads: usize,
    /// Per-head dimension.
    #[serde(default = "default_codec_head_dim")]
    pub head_dim: usize,
    /// SwiGLU FFN hidden dimension.
    #[serde(default = "default_codec_ffn_dim")]
    pub ffn_dim: usize,
    /// Number of transformer layers per block.
    #[serde(default = "default_codec_layers_per_block")]
    pub layers_per_block: usize,
    /// Sliding window sizes for the 4 transformer block groups.
    #[serde(default = "default_codec_sliding_windows")]
    pub sliding_windows: Vec<usize>,
    /// Input conv: channels in (semantic 256 + acoustic 36 = 292).
    #[serde(default = "default_codec_input_channels")]
    pub input_channels: usize,
    /// Output conv: samples per patch.
    #[serde(default = "default_codec_output_patch_size")]
    pub output_patch_size: usize,
    /// Output sample rate in Hz.
    #[serde(default = "default_codec_sample_rate")]
    pub sample_rate: u32,
    /// Number of semantic VQ codebook entries.
    #[serde(default = "default_semantic_vq_size")]
    pub semantic_vq_size: usize,
    /// Semantic embedding dimension (per entry).
    #[serde(default = "default_semantic_embed_dim")]
    pub semantic_embed_dim: usize,
    /// Number of acoustic FSQ dimensions.
    #[serde(default = "default_acoustic_dim")]
    pub acoustic_fsq_dims: usize,
    /// Number of FSQ levels per dimension.
    #[serde(default = "default_fsq_levels")]
    pub fsq_levels: usize,
    /// RMSNorm epsilon (codec uses 0.01, much larger than backbone's 1e-5).
    #[serde(default = "default_codec_norm_eps")]
    pub norm_eps: f64,
    /// QK-norm epsilon for codec attention.
    #[serde(default = "default_codec_qk_norm_eps")]
    pub qk_norm_eps: f64,
}

impl Default for CodecDecoderConfig {
    fn default() -> Self {
        Self {
            dim: default_codec_dim(),
            n_heads: default_codec_n_heads(),
            head_dim: default_codec_head_dim(),
            ffn_dim: default_codec_ffn_dim(),
            layers_per_block: default_codec_layers_per_block(),
            sliding_windows: default_codec_sliding_windows(),
            input_channels: default_codec_input_channels(),
            output_patch_size: default_codec_output_patch_size(),
            sample_rate: default_codec_sample_rate(),
            semantic_vq_size: default_semantic_vq_size(),
            semantic_embed_dim: default_semantic_embed_dim(),
            acoustic_fsq_dims: default_acoustic_dim(),
            fsq_levels: default_fsq_levels(),
            norm_eps: default_codec_norm_eps(),
            qk_norm_eps: default_codec_qk_norm_eps(),
        }
    }
}

impl CodecDecoderConfig {
    /// Total number of transformer blocks (4 groups of `layers_per_block`).
    pub fn total_transformer_layers(&self) -> usize {
        self.sliding_windows.len() * self.layers_per_block
    }

    /// Validate config invariants.
    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.dim == 0 {
            return Err(ConfigError::InvalidValue("dim must be > 0".into()));
        }
        if self.sliding_windows.is_empty() {
            return Err(ConfigError::InvalidValue(
                "sliding_windows must not be empty".into(),
            ));
        }
        if self.n_heads == 0 {
            return Err(ConfigError::InvalidValue("n_heads must be > 0".into()));
        }
        if !self.dim.is_multiple_of(self.n_heads) {
            return Err(ConfigError::InvalidValue(
                "dim must be divisible by n_heads".into(),
            ));
        }
        Ok(())
    }
}

/// Special token IDs for TTS sequence construction.
///
/// Input sequence format (per vLLM/mistral-common reference):
/// ```text
/// [BOS(1)] [BEGIN_AUDIO(25)] [voice_0..N] [NEXT_AUDIO_TEXT(35)] [text_0..M] [REPEAT_AUDIO_TEXT(36)] [BEGIN_AUDIO(25)]
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TtsSpecialTokens {
    /// Beginning of sequence.
    pub bos_token_id: u32,
    /// Marks start of audio section (token 25).
    pub begin_audio_token_id: u32,
    /// Transition from audio to text (token 35, `[NEXT_AUDIO_TEXT]`).
    pub next_audio_text_token_id: u32,
    /// Transition from text back to audio (token 36, `[REPEAT_AUDIO_TEXT]`).
    pub repeat_audio_text_token_id: u32,
    /// Audio placeholder token (token 24, replaced by voice embeddings at embedding level).
    pub audio_token_id: u32,
    /// Empty audio sentinel in the audio codebook (index 0 per codebook).
    pub empty_audio_idx: u32,
    /// End-of-audio sentinel in the audio codebook (index 1 per codebook).
    pub end_audio_idx: u32,
}

impl Default for TtsSpecialTokens {
    fn default() -> Self {
        Self {
            bos_token_id: 1,
            begin_audio_token_id: 25,       // [BEGIN_AUDIO] = rank 25
            next_audio_text_token_id: 36,   // [NEXT_AUDIO_TEXT] = rank 36 (text→audio transition)
            repeat_audio_text_token_id: 35, // [REPEAT_AUDIO_TEXT] = rank 35 (audio→text transition)
            audio_token_id: 24,             // [AUDIO] = rank 24 (placeholder)
            empty_audio_idx: 0,
            end_audio_idx: 1,
        }
    }
}

/// Voice embedding metadata for preset voices.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VoiceEmbeddingConfig {
    /// Expected embedding dimension (must match backbone dim).
    #[serde(default = "default_backbone_dim")]
    pub embed_dim: usize,
    /// Known preset voice names. An empty list means accept any.
    #[serde(default = "default_voice_presets")]
    pub preset_names: Vec<String>,
}

impl Default for VoiceEmbeddingConfig {
    fn default() -> Self {
        Self {
            embed_dim: default_backbone_dim(),
            preset_names: default_voice_presets(),
        }
    }
}

/// Audio codebook embedding layout constants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioCodebookLayout {
    /// Number of semantic VQ entries.
    pub semantic_vq_size: usize,
    /// Number of acoustic FSQ dimensions (codebooks).
    pub acoustic_codebooks: usize,
    /// Number of FSQ levels per acoustic codebook.
    pub fsq_levels: usize,
    /// Number of special tokens per codebook (EMPTY_AUDIO, END_AUDIO).
    pub specials_per_codebook: usize,
}

impl Default for AudioCodebookLayout {
    fn default() -> Self {
        Self {
            semantic_vq_size: 8192,
            acoustic_codebooks: 36,
            fsq_levels: 21,
            specials_per_codebook: 2,
        }
    }
}

impl AudioCodebookLayout {
    /// Stride per acoustic codebook (specials + levels).
    pub fn acoustic_stride(&self) -> usize {
        self.specials_per_codebook + self.fsq_levels
    }

    /// Start index of acoustic codebook region in the embedding table.
    pub fn acoustic_region_start(&self) -> usize {
        self.specials_per_codebook + self.semantic_vq_size
    }

    /// Total meaningful entries in the embedding table.
    pub fn total_entries(&self) -> usize {
        // 2 semantic specials + 8192 semantic VQ + 36 * 23 acoustic
        self.specials_per_codebook
            + self.semantic_vq_size
            + self.acoustic_codebooks * self.acoustic_stride()
    }

    /// Global index for a semantic token value.
    pub fn semantic_global_index(&self, raw_semantic_idx: usize) -> usize {
        raw_semantic_idx + self.specials_per_codebook
    }

    /// Global index for an acoustic codebook level.
    pub fn acoustic_global_index(&self, codebook: usize, level: usize) -> usize {
        self.acoustic_region_start()
            + codebook * self.acoustic_stride()
            + level
            + self.specials_per_codebook
    }
}

/// Top-level TTS configuration combining all stage configs.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TtsConfig {
    pub backbone: TtsBackboneConfig,
    pub fm_transformer: FmTransformerConfig,
    pub codec_decoder: CodecDecoderConfig,
    pub special_tokens: TtsSpecialTokens,
    pub voice: VoiceEmbeddingConfig,
}

impl TtsConfig {
    /// Validate all sub-configs.
    pub fn validate(&self) -> Result<(), ConfigError> {
        self.backbone.validate()?;
        self.fm_transformer.validate()?;
        self.codec_decoder.validate()?;

        // Cross-config consistency: FM dim must match backbone dim
        if self.fm_transformer.dim != self.backbone.dim {
            return Err(ConfigError::InvalidValue(
                "fm_transformer.dim must match backbone.dim".into(),
            ));
        }

        // Voice embed dim must match backbone dim
        if self.voice.embed_dim != self.backbone.dim {
            return Err(ConfigError::InvalidValue(
                "voice.embed_dim must match backbone.dim".into(),
            ));
        }

        Ok(())
    }
}

/// Configuration validation error.
#[derive(Debug, Clone, thiserror::Error)]
pub enum ConfigError {
    #[error("invalid config value: {0}")]
    InvalidValue(String),
}

// --- Default value functions ---

fn default_backbone_n_layers() -> usize {
    26
}
fn default_backbone_dim() -> usize {
    3072
}
fn default_backbone_n_heads() -> usize {
    32
}
fn default_backbone_n_kv_heads() -> usize {
    8
}
fn default_backbone_head_dim() -> usize {
    128
}
fn default_backbone_ffn_dim() -> usize {
    9216
}
fn default_backbone_rope_theta() -> f64 {
    1_000_000.0
}
fn default_vocab_size() -> usize {
    131_072
}
fn default_norm_eps() -> f64 {
    1e-5
}
fn default_codec_norm_eps() -> f64 {
    0.01 // from params.json: audio_tokenizer_args.norm_eps
}
fn default_codec_qk_norm_eps() -> f64 {
    1e-6 // from params.json: audio_tokenizer_args.qk_norm_eps
}
fn default_true() -> bool {
    true
}

fn default_fm_n_layers() -> usize {
    3
}
fn default_fm_rope_theta() -> f64 {
    10_000.0
}
fn default_acoustic_dim() -> usize {
    36
}
fn default_semantic_output_size() -> usize {
    8320
}
fn default_euler_steps() -> usize {
    8
}
fn default_cfg_alpha() -> f32 {
    1.2
}

fn default_codec_dim() -> usize {
    1024
}
fn default_codec_n_heads() -> usize {
    8
}
fn default_codec_head_dim() -> usize {
    128
}
fn default_codec_ffn_dim() -> usize {
    4096
}
fn default_codec_layers_per_block() -> usize {
    2
}
fn default_codec_sliding_windows() -> Vec<usize> {
    vec![2, 4, 8, 16]
}
fn default_codec_input_channels() -> usize {
    292
}
fn default_codec_output_patch_size() -> usize {
    240
}
fn default_codec_sample_rate() -> u32 {
    24_000
}
fn default_semantic_vq_size() -> usize {
    8192
}
fn default_semantic_embed_dim() -> usize {
    256
}
fn default_fsq_levels() -> usize {
    21
}

fn default_voice_presets() -> Vec<String> {
    [
        "alloy",
        "ash",
        "ballad",
        "breeze",
        "casual_female",
        "casual_male",
        "coral",
        "echo",
        "fable",
        "nova",
        "onyx",
        "professional_female",
        "professional_male",
        "sage",
        "shimmer",
        "spirit",
        "verse",
        "warm_female",
        "warm_male",
        "whisper",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backbone_defaults() {
        let config = TtsBackboneConfig::default();
        assert_eq!(config.n_layers, 26);
        assert_eq!(config.dim, 3072);
        assert_eq!(config.n_heads, 32);
        assert_eq!(config.n_kv_heads, 8);
        assert_eq!(config.head_dim, 128);
        assert_eq!(config.ffn_dim, 9216);
        assert_eq!(config.rope_theta, 1_000_000.0);
        assert_eq!(config.vocab_size, 131_072);
        assert!(config.tied_embeddings);
        assert_eq!(config.gqa_groups(), 4);
    }

    #[test]
    fn test_fm_transformer_defaults() {
        let config = FmTransformerConfig::default();
        assert_eq!(config.n_layers, 3);
        assert_eq!(config.dim, 3072);
        assert_eq!(config.n_heads, 32);
        assert_eq!(config.n_kv_heads, 8);
        assert_eq!(config.head_dim, 128);
        assert_eq!(config.ffn_dim, 9216);
        assert_eq!(config.rope_theta, 10_000.0);
        assert_eq!(config.acoustic_dim, 36);
        assert_eq!(config.semantic_output_size, 8320);
        assert_eq!(config.euler_steps, 8);
        assert!((config.cfg_alpha - 1.2).abs() < 1e-6);
    }

    #[test]
    fn test_codec_decoder_defaults() {
        let config = CodecDecoderConfig::default();
        assert_eq!(config.dim, 1024);
        assert_eq!(config.n_heads, 8);
        assert_eq!(config.head_dim, 128);
        assert_eq!(config.layers_per_block, 2);
        assert_eq!(config.sliding_windows, vec![2, 4, 8, 16]);
        assert_eq!(config.input_channels, 292);
        assert_eq!(config.output_patch_size, 240);
        assert_eq!(config.sample_rate, 24_000);
        assert_eq!(config.total_transformer_layers(), 8);
    }

    #[test]
    fn test_special_tokens_defaults() {
        let tokens = TtsSpecialTokens::default();
        assert_eq!(tokens.audio_token_id, 24);
        assert_eq!(tokens.begin_audio_token_id, 25);
        assert_eq!(tokens.bos_token_id, 1);
        assert_eq!(tokens.empty_audio_idx, 0);
        assert_eq!(tokens.end_audio_idx, 1);
    }

    #[test]
    fn test_voice_embedding_defaults() {
        let config = VoiceEmbeddingConfig::default();
        assert_eq!(config.embed_dim, 3072);
        assert_eq!(config.preset_names.len(), 20);
        assert!(config.preset_names.contains(&"casual_female".to_string()));
        assert!(config.preset_names.contains(&"whisper".to_string()));
    }

    #[test]
    fn test_audio_codebook_layout() {
        let layout = AudioCodebookLayout::default();
        assert_eq!(layout.acoustic_stride(), 23);
        assert_eq!(layout.acoustic_region_start(), 8194);
        // 2 + 8192 + 36*23 = 2 + 8192 + 828 = 9022
        assert_eq!(layout.total_entries(), 9022);

        // Semantic index: raw 0 -> global 2
        assert_eq!(layout.semantic_global_index(0), 2);
        assert_eq!(layout.semantic_global_index(8191), 8193);

        // Acoustic: codebook 0, level 0 -> 8194 + 0*23 + 0 + 2 = 8196
        assert_eq!(layout.acoustic_global_index(0, 0), 8196);
        // Acoustic: codebook 35, level 20 -> 8194 + 35*23 + 20 + 2 = 8194 + 805 + 22 = 9021
        assert_eq!(layout.acoustic_global_index(35, 20), 9021);
    }

    #[test]
    fn test_tts_config_validates() {
        let config = TtsConfig::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_validation_rejects_zero_layers() {
        let mut config = TtsBackboneConfig::default();
        config.n_layers = 0;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validation_rejects_mismatched_heads() {
        let mut config = TtsBackboneConfig::default();
        config.n_heads = 7;
        config.n_kv_heads = 3;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validation_rejects_dim_head_mismatch() {
        let mut config = TtsBackboneConfig::default();
        config.dim = 100;
        config.n_heads = 32;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validation_rejects_fm_zero_euler_steps() {
        let mut config = FmTransformerConfig::default();
        config.euler_steps = 0;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validation_rejects_empty_sliding_windows() {
        let mut config = CodecDecoderConfig::default();
        config.sliding_windows = vec![];
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_cross_config_validation_dim_mismatch() {
        let mut config = TtsConfig::default();
        config.fm_transformer.dim = 1024;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_cross_config_validation_voice_dim_mismatch() {
        let mut config = TtsConfig::default();
        config.voice.embed_dim = 512;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_serde_roundtrip_backbone() {
        let config = TtsBackboneConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let parsed: TtsBackboneConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, parsed);
    }

    #[test]
    fn test_serde_roundtrip_tts_config() {
        let config = TtsConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let parsed: TtsConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, parsed);
    }

    #[test]
    fn test_serde_partial_deserialize() {
        // Should fill in defaults for missing fields
        let json = r#"{"n_layers": 12, "dim": 768}"#;
        let config: TtsBackboneConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.n_layers, 12);
        assert_eq!(config.dim, 768);
        // Defaults for the rest
        assert_eq!(config.n_heads, 32);
        assert_eq!(config.vocab_size, 131_072);
    }
}
