//! TTS decoder backbone (Ministral 3B architecture).
//!
//! Loads the 234 TTS backbone tensors from `consolidated.safetensors` into
//! plain-mode decoder layers (no ADA RMSNorm). Reuses the same layer
//! primitives as the ASR decoder.
//!
//! ## Autoregressive Decoding (T-07)
//!
//! The `generate()` method runs the backbone autoregressively:
//! 1. **Prefill**: process the full input sequence (BOS + voice + text + repeat) with KV caching
//! 2. **Decode loop**: one step at a time, producing hidden state `h` [1, 1, 3072]
//!    - `fm.semantic_logits(h)` → argmax → semantic token (check for END_AUDIO)
//!    - `fm.euler_ode_solve(h, noise)` → FSQ quantize → 36 acoustic indices
//!    - `AudioCodebookEmbeddings::embed_frame()` → next input embedding
//! 3. Terminate on END_AUDIO (semantic index 1) or max-length limit

use anyhow::{Context, Result};
use burn::module::{Param, ParamId};
use burn::nn::Embedding;
use burn::prelude::ElementConversion;
use burn::tensor::backend::Backend;
use burn::tensor::Tensor;
use safetensors::SafeTensors;

use crate::models::layers::{Attention, DecoderLayer, LayerCaches, RmsNorm, RoPE, RoPEConfig};
use crate::models::weights::{linear_from_weights, load_tensor};

use super::config::TtsBackboneConfig;
use super::embeddings::AudioCodebookEmbeddings;
use super::flow_matching::FmTransformer;

/// Weight name prefixes for TTS backbone tensors.
pub mod prefixes {
    /// Token embeddings (shared with LM head via tied embeddings).
    pub const TOK_EMBEDDINGS: &str = "mm_audio_embeddings.tok_embeddings.weight";
    /// Audio codebook embeddings [9088, 3072].
    pub const AUDIO_CODEBOOK: &str =
        "mm_audio_embeddings.audio_codebook_embeddings.embeddings.weight";
    /// Final RMSNorm.
    pub const FINAL_NORM: &str = "norm.weight";
    /// Decoder layer prefix (bare, not nested under mm_audio_embeddings).
    pub const LAYERS: &str = "layers";
}

/// Weight names for a TTS backbone decoder layer.
///
/// Unlike the ASR decoder, TTS layers have no ADA RMSNorm weights.
struct TtsLayerWeightNames {
    attention_norm: String,
    wq_weight: String,
    wk_weight: String,
    wv_weight: String,
    wo_weight: String,
    ffn_norm: String,
    w1_weight: String,
    w2_weight: String,
    w3_weight: String,
}

fn tts_layer_weight_names(layer_idx: usize) -> TtsLayerWeightNames {
    let prefix = format!("{}.{}", prefixes::LAYERS, layer_idx);
    TtsLayerWeightNames {
        attention_norm: format!("{prefix}.attention_norm.weight"),
        wq_weight: format!("{prefix}.attention.wq.weight"),
        wk_weight: format!("{prefix}.attention.wk.weight"),
        wv_weight: format!("{prefix}.attention.wv.weight"),
        wo_weight: format!("{prefix}.attention.wo.weight"),
        ffn_norm: format!("{prefix}.ffn_norm.weight"),
        w1_weight: format!("{prefix}.feed_forward.w1.weight"),
        w2_weight: format!("{prefix}.feed_forward.w2.weight"),
        w3_weight: format!("{prefix}.feed_forward.w3.weight"),
    }
}

/// TTS decoder backbone.
///
/// Ministral 3B architecture with plain pre-norm (no ADA RMSNorm).
/// Holds 26 transformer layers, token embeddings (tied with LM head),
/// audio codebook embeddings, and final RMSNorm.
pub struct TtsBackbone<B: Backend> {
    /// Plain-mode transformer layers (no temporal conditioning).
    pub layers: Vec<DecoderLayer<B>>,
    /// Final RMSNorm before output projection.
    pub norm: RmsNorm<B>,
    /// Token embeddings [vocab_size, dim] — tied with LM head.
    pub tok_embeddings: Embedding<B>,
    /// Audio codebook embeddings [9088, dim].
    pub audio_codebook_embeddings: Tensor<B, 2>,
    /// RoPE for positional encoding.
    pub rope: RoPE<B>,
    /// Config for reference.
    pub config: TtsBackboneConfig,
}

impl<B: Backend> TtsBackbone<B> {
    /// Load TTS backbone from SafeTensors.
    pub fn from_safetensors(
        safetensors: &SafeTensors,
        config: &TtsBackboneConfig,
        device: &B::Device,
    ) -> Result<Self> {
        config
            .validate()
            .map_err(|e| anyhow::anyhow!("Invalid backbone config: {e}"))?;

        // Load token embeddings [131072, 3072]
        let tok_embeddings_weight: Tensor<B, 2> =
            load_tensor(safetensors, prefixes::TOK_EMBEDDINGS, device)
                .context("Failed to load tok_embeddings")?;
        let tok_embeddings = Embedding {
            weight: Param::initialized(ParamId::new(), tok_embeddings_weight),
        };

        // Load audio codebook embeddings [9088, 3072]
        let audio_codebook_embeddings: Tensor<B, 2> =
            load_tensor(safetensors, prefixes::AUDIO_CODEBOOK, device)
                .context("Failed to load audio_codebook_embeddings")?;

        // Load transformer layers (plain mode — no ADA RMSNorm)
        let mut layers = Vec::with_capacity(config.n_layers);
        for i in 0..config.n_layers {
            let layer = load_tts_decoder_layer(safetensors, i, config, device)
                .with_context(|| format!("Failed to load backbone layer {i}"))?;
            layers.push(layer);
        }

        // Load final norm
        let final_norm_weight: Tensor<B, 1> =
            load_tensor(safetensors, prefixes::FINAL_NORM, device)
                .context("Failed to load final norm")?;
        let norm = RmsNorm {
            weight: burn::nn::RmsNorm {
                gamma: Param::initialized(ParamId::new(), final_norm_weight),
                epsilon: config.norm_eps,
            },
        };

        // Initialize RoPE (computed from config, not loaded)
        let rope = RoPEConfig::new(config.head_dim, 131_072)
            .with_theta(config.rope_theta)
            .init(device);

        Ok(Self {
            layers,
            norm,
            tok_embeddings,
            audio_codebook_embeddings,
            rope,
            config: config.clone(),
        })
    }

    /// Embed token IDs via the token embedding table.
    pub fn embed_tokens(&self, token_ids: Tensor<B, 2, burn::tensor::Int>) -> Tensor<B, 3> {
        self.tok_embeddings.forward(token_ids)
    }

    /// Forward pass through all layers (no cache).
    ///
    /// # Arguments
    /// * `x` - Input hidden states [batch, seq, dim]
    /// * `offset` - Position offset for RoPE
    ///
    /// # Returns
    /// Normalized hidden states [batch, seq, dim]
    pub fn forward(&self, x: Tensor<B, 3>, offset: usize) -> Tensor<B, 3> {
        let mut x = x;
        for layer in &self.layers {
            x = layer.forward(x, None, &self.rope, offset);
        }
        self.norm.forward(x)
    }

    /// Forward pass with KV cache (for autoregressive decoding).
    ///
    /// # Arguments
    /// * `x` - Input hidden states [batch, seq, dim]
    /// * `caches` - KV caches for all layers
    ///
    /// # Returns
    /// Normalized hidden states [batch, seq, dim]
    pub fn forward_with_cache(&self, x: Tensor<B, 3>, caches: &mut LayerCaches<B>) -> Tensor<B, 3> {
        let mut x = x;
        for (i, layer) in self.layers.iter().enumerate() {
            if let Some(cache) = caches.get_mut(i) {
                x = layer.forward_with_cache(x, None, &self.rope, cache);
            }
        }
        self.norm.forward(x)
    }

    /// Compute logits via tied embeddings (LM head).
    ///
    /// # Arguments
    /// * `hidden_states` - Hidden states [batch, seq, dim]
    ///
    /// # Returns
    /// Logits [batch, seq, vocab_size]
    pub fn lm_head(&self, hidden_states: Tensor<B, 3>) -> Tensor<B, 3> {
        let [batch, seq, _dim] = hidden_states.dims();
        let embed_weights = self.tok_embeddings.weight.val();
        let vocab_size = embed_weights.dims()[0];

        // [batch, seq, dim] @ [dim, vocab_size] -> [batch, seq, vocab_size]
        let embed_t = embed_weights.transpose().unsqueeze::<3>();
        let logits = hidden_states.matmul(embed_t);
        logits.reshape([batch, seq, vocab_size])
    }

    /// Create a new set of KV caches for autoregressive decoding.
    pub fn create_cache(&self) -> LayerCaches<B> {
        LayerCaches::new(self.layers.len())
    }

    /// Number of layers.
    pub fn n_layers(&self) -> usize {
        self.layers.len()
    }

    /// Run autoregressive generation to produce audio frames.
    ///
    /// # Arguments
    /// * `input_sequence` - Pre-built input embeddings [1, seq_len, dim] from `build_input_sequence()`
    /// * `fm` - Flow-matching transformer for semantic logits and acoustic ODE
    /// * `codebook` - Audio codebook embeddings for frame embedding lookup
    /// * `max_frames` - Maximum number of audio frames to generate
    /// * `device` - Backend device
    ///
    /// # Returns
    /// Vector of generated frames (semantic index + 36 acoustic levels per frame).
    pub fn generate(
        &self,
        input_sequence: Tensor<B, 3>,
        fm: &FmTransformer<B>,
        codebook: &AudioCodebookEmbeddings<B>,
        max_frames: usize,
        device: &B::Device,
    ) -> Vec<GeneratedFrame> {
        use crate::tts::codec::quantizer::Fsq;

        let acoustic_dim = fm.config().acoustic_dim;
        let mut caches = self.create_cache();
        let mut frames = Vec::with_capacity(max_frames);

        // Phase 1: Prefill — process the entire input sequence, populate KV caches.
        let prefill_out = self.forward_with_cache(input_sequence, &mut caches);

        // Extract the last hidden state from prefill as the first decode input
        let [batch, seq_len, dim] = prefill_out.dims();
        let mut h = prefill_out.slice([0..batch, (seq_len - 1)..seq_len, 0..dim]); // [1, 1, dim]

        if tracing::enabled!(tracing::Level::TRACE) {
            let h_data = h.clone().reshape([dim]).to_data();
            let h_slice = h_data.as_slice::<f32>().unwrap();
            let h_norm: f32 = h_slice.iter().map(|x| x * x).sum::<f32>().sqrt();
            tracing::trace!(h_norm = format!("{h_norm:.4}"), "Prefill hidden state");
        }

        // Phase 2: Decode loop — one frame per iteration.
        for frame_idx in 0..max_frames {
            // Semantic token: direct projection of h → logits → argmax
            let semantic_logits = fm.semantic_logits(h.clone()); // [1, semantic_output_size]

            if tracing::enabled!(tracing::Level::TRACE) {
                let logits_data = semantic_logits.clone().to_data();
                let logits_slice = logits_data.as_slice::<f32>().unwrap();
                let mut indexed: Vec<(usize, f32)> =
                    logits_slice.iter().copied().enumerate().collect();
                indexed.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
                let top3: Vec<(usize, f32)> =
                    indexed.iter().take(3).map(|&(i, v)| (i, v)).collect();
                tracing::trace!(
                    frame = frame_idx,
                    top3 = ?top3,
                    "Semantic logit distribution"
                );
            }

            let semantic_idx = semantic_logits.argmax(1); // [1, 1]
            let semantic_idx_val: i32 = semantic_idx.into_scalar().elem();
            let semantic_idx_val = semantic_idx_val as usize;

            // Log semantic token for debugging
            tracing::debug!(
                frame = frame_idx,
                semantic_idx = semantic_idx_val,
                "Generated semantic token"
            );

            // Check for END_AUDIO (index 1 in the semantic codebook output)
            if semantic_idx_val == 1 {
                tracing::info!(frame = frame_idx, "END_AUDIO token detected, stopping");
                break;
            }

            // Acoustic tokens: Euler ODE from noise → FSQ quantize
            let noise: Tensor<B, 2> = Tensor::random(
                [1, acoustic_dim],
                burn::tensor::Distribution::Normal(0.0, 1.0),
                device,
            );
            let acoustic_raw = fm.euler_ode_solve(h.clone(), noise.clone()); // [1, 36]

            if tracing::enabled!(tracing::Level::TRACE) {
                let raw_data = acoustic_raw.clone().to_data();
                let raw_slice = raw_data.as_slice::<f32>().unwrap();
                let first4: Vec<f32> = raw_slice.iter().take(4).copied().collect();
                let raw_norm: f32 = raw_slice.iter().map(|x| x * x).sum::<f32>().sqrt();
                tracing::trace!(
                    frame = frame_idx,
                    ode_output = ?first4,
                    ode_norm = format!("{raw_norm:.2}"),
                    "ODE solver output"
                );
            }

            // FSQ quantize: continuous R^36 → discrete indices [0, 20]
            let acoustic_indices = Fsq::quantize(acoustic_raw); // [1, 36]
            let acoustic_data = acoustic_indices.to_data();
            let acoustic_slice = acoustic_data.as_slice::<f32>().unwrap();

            let mut acoustic_levels = [0usize; 36];
            for (i, &v) in acoustic_slice.iter().enumerate().take(36) {
                acoustic_levels[i] = v as usize;
            }

            // The semantic_idx_val from argmax over the masked logits gives us a
            // "raw" index in [0, 8320). Indices 0-1 are specials, 2..8193 are VQ.
            // embed_semantic expects the raw VQ index (0..8191), so subtract 2.
            // Note: EMPTY_AUDIO (idx 0) would map to raw_semantic 0 via saturating_sub —
            // harmless since END_AUDIO (idx 1) is already caught above.
            let raw_semantic = semantic_idx_val.saturating_sub(2);

            frames.push(GeneratedFrame {
                semantic_idx: raw_semantic,
                acoustic_levels,
            });

            // Embed frame → next input for backbone
            let frame_embed = codebook.embed_frame(raw_semantic, &acoustic_levels); // [1, dim]

            if tracing::enabled!(tracing::Level::TRACE) {
                let fe_norm: f32 = frame_embed
                    .clone()
                    .powf_scalar(2.0)
                    .sum()
                    .sqrt()
                    .into_scalar()
                    .elem();
                tracing::trace!(
                    frame = frame_idx,
                    frame_embed_norm = format!("{fe_norm:.2}"),
                    acoustic_levels = ?&acoustic_levels[..4],
                    "Frame feedback"
                );
            }

            let next_input = frame_embed.unsqueeze_dim::<3>(0); // [1, 1, dim]

            // Forward through backbone with cache → next hidden state
            h = self.forward_with_cache(next_input, &mut caches);
        }

        frames
    }
}

/// A single generated audio frame from autoregressive decoding.
#[derive(Debug, Clone)]
pub struct GeneratedFrame {
    /// Semantic VQ index (raw, 0..8191 — without the +2 offset).
    pub semantic_idx: usize,
    /// Acoustic FSQ level indices per codebook (36 values, each in 0..20).
    pub acoustic_levels: [usize; 36],
}

/// Load a single TTS decoder layer (plain mode, no ADA RMSNorm).
fn load_tts_decoder_layer<B: Backend>(
    safetensors: &SafeTensors,
    layer_idx: usize,
    config: &TtsBackboneConfig,
    device: &B::Device,
) -> Result<DecoderLayer<B>> {
    let names = tts_layer_weight_names(layer_idx);

    // Load attention norm
    let attention_norm_weight: Tensor<B, 1> =
        load_tensor(safetensors, &names.attention_norm, device)?;

    // Load attention weights (no biases in Ministral)
    let wq = load_linear_no_bias::<B>(safetensors, &names.wq_weight, device)?;
    let wk = load_linear_no_bias::<B>(safetensors, &names.wk_weight, device)?;
    let wv = load_linear_no_bias::<B>(safetensors, &names.wv_weight, device)?;
    let wo = load_linear_no_bias::<B>(safetensors, &names.wo_weight, device)?;

    let attention = Attention::new(
        wq,
        wk,
        wv,
        wo,
        config.n_heads,
        config.n_kv_heads,
        config.head_dim,
        None, // No sliding window specified in TTS weights
    );

    // Load FFN norm
    let ffn_norm_weight: Tensor<B, 1> = load_tensor(safetensors, &names.ffn_norm, device)?;

    // Load SwiGLU weights (no biases)
    let w1 = load_linear_no_bias::<B>(safetensors, &names.w1_weight, device)?;
    let w2 = load_linear_no_bias::<B>(safetensors, &names.w2_weight, device)?;
    let w3 = load_linear_no_bias::<B>(safetensors, &names.w3_weight, device)?;

    // Use plain mode constructor (no ADA RMSNorm)
    Ok(DecoderLayer::new_plain(
        attention_norm_weight,
        attention,
        ffn_norm_weight,
        w1,
        w2,
        w3,
        config.norm_eps,
    ))
}

/// Load a Linear layer without bias from SafeTensors.
fn load_linear_no_bias<B: Backend>(
    safetensors: &SafeTensors,
    weight_name: &str,
    device: &B::Device,
) -> Result<burn::nn::Linear<B>> {
    let weight: Tensor<B, 2> = load_tensor(safetensors, weight_name, device)?;
    Ok(linear_from_weights(weight, None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use burn::backend::Wgpu;

    type TestBackend = Wgpu;

    /// Build a small TtsBackbone with random weights for shape testing.
    fn make_test_backbone(
        device: &<TestBackend as burn::tensor::backend::Backend>::Device,
    ) -> TtsBackbone<TestBackend> {
        use crate::models::layers::DecoderLayerConfig;

        let config = TtsBackboneConfig {
            n_layers: 2,
            dim: 64,
            n_heads: 4,
            n_kv_heads: 2,
            head_dim: 16,
            ffn_dim: 256,
            rope_theta: 10_000.0,
            vocab_size: 100,
            tied_embeddings: true,
            norm_eps: 1e-5,
        };

        let mut layers = Vec::new();
        for _ in 0..config.n_layers {
            let layer = DecoderLayerConfig::new(
                config.dim,
                config.n_heads,
                config.n_kv_heads,
                config.head_dim,
                config.ffn_dim,
            )
            .with_sliding_window(None)
            .init::<TestBackend>(device);
            layers.push(layer);
        }

        let norm =
            crate::models::layers::RmsNormConfig::new(config.dim).init::<TestBackend>(device);
        let tok_embeddings =
            burn::nn::EmbeddingConfig::new(config.vocab_size, config.dim).init(device);
        let audio_codebook_embeddings = Tensor::<TestBackend, 2>::zeros([9088, config.dim], device);
        let rope = RoPEConfig::new(config.head_dim, 1024)
            .with_theta(config.rope_theta)
            .init::<TestBackend>(device);

        TtsBackbone {
            layers,
            norm,
            tok_embeddings,
            audio_codebook_embeddings,
            rope,
            config,
        }
    }

    #[test]
    fn test_tts_layer_weight_names() {
        let names = tts_layer_weight_names(0);
        assert_eq!(names.attention_norm, "layers.0.attention_norm.weight");
        assert_eq!(names.wq_weight, "layers.0.attention.wq.weight");
        assert_eq!(names.w1_weight, "layers.0.feed_forward.w1.weight");

        let names = tts_layer_weight_names(25);
        assert_eq!(names.ffn_norm, "layers.25.ffn_norm.weight");
    }

    #[test]
    fn test_backbone_forward_shape() {
        let device = Default::default();
        let backbone = make_test_backbone(&device);
        let dim = backbone.config.dim;
        let vocab_size = backbone.config.vocab_size;

        // Test forward
        let x = Tensor::<TestBackend, 3>::zeros([1, 10, dim], &device);
        let out = backbone.forward(x, 0);
        assert_eq!(out.dims(), [1, 10, dim]);

        // Test embed_tokens
        let ids = Tensor::<TestBackend, 2, burn::tensor::Int>::zeros([1, 5], &device);
        let embedded = backbone.embed_tokens(ids);
        assert_eq!(embedded.dims(), [1, 5, dim]);

        // Test LM head
        let logits = backbone.lm_head(out);
        assert_eq!(logits.dims(), [1, 10, vocab_size]);
    }

    #[test]
    fn test_backbone_forward_with_cache() {
        let device = Default::default();
        let backbone = make_test_backbone(&device);
        let dim = backbone.config.dim;
        let mut caches = backbone.create_cache();

        // Prefill
        let x = Tensor::<TestBackend, 3>::zeros([1, 10, dim], &device);
        let out = backbone.forward_with_cache(x, &mut caches);
        assert_eq!(out.dims(), [1, 10, dim]);

        // Decode step
        let x = Tensor::<TestBackend, 3>::zeros([1, 1, dim], &device);
        let out = backbone.forward_with_cache(x, &mut caches);
        assert_eq!(out.dims(), [1, 1, dim]);
    }

    #[test]
    fn test_load_tts_backbone_from_safetensors() {
        // Integration test — requires TTS model weights
        let model_path = std::path::Path::new("models/voxtral-tts/consolidated.safetensors");
        if !model_path.exists() {
            println!(
                "Skipping: TTS model not downloaded at {}",
                model_path.display()
            );
            return;
        }

        let device = Default::default();
        let owned = crate::models::weights::load_safetensors(model_path)
            .expect("Failed to load safetensors");
        let config = TtsBackboneConfig::default();

        let backbone =
            TtsBackbone::<TestBackend>::from_safetensors(owned.tensors(), &config, &device)
                .expect("Failed to load TTS backbone");

        assert_eq!(backbone.n_layers(), 26);
        assert_eq!(backbone.tok_embeddings.weight.dims(), [131_072, 3072]);
        assert_eq!(backbone.audio_codebook_embeddings.dims(), [9088, 3072]);

        println!("TTS backbone loaded: {} layers", backbone.n_layers());
    }

    #[test]
    fn test_generated_frame_struct() {
        let frame = GeneratedFrame {
            semantic_idx: 42,
            acoustic_levels: [10; 36],
        };
        assert_eq!(frame.semantic_idx, 42);
        assert_eq!(frame.acoustic_levels[0], 10);
        assert_eq!(frame.acoustic_levels[35], 10);

        // Clone works
        let frame2 = frame.clone();
        assert_eq!(frame2.semantic_idx, frame.semantic_idx);
    }

    #[test]
    fn test_prefill_and_decode_shapes_with_cache() {
        // Verify that the prefill+decode pattern used in generate() works correctly
        let device = Default::default();
        let backbone = make_test_backbone(&device);
        let dim = backbone.config.dim;
        let mut caches = backbone.create_cache();

        // Prefill: 10 tokens
        let input_seq = Tensor::<TestBackend, 3>::zeros([1, 10, dim], &device);
        let prefill_out = backbone.forward_with_cache(input_seq, &mut caches);
        assert_eq!(prefill_out.dims(), [1, 10, dim]);

        // Extract last hidden state (what generate does)
        let [batch, seq_len, d] = prefill_out.dims();
        let h = prefill_out.slice([0..batch, (seq_len - 1)..seq_len, 0..d]);
        assert_eq!(h.dims(), [1, 1, dim]);

        // Multiple single-step decodes (simulating the decode loop)
        for _ in 0..5 {
            let step_input = Tensor::<TestBackend, 3>::zeros([1, 1, dim], &device);
            let step_out = backbone.forward_with_cache(step_input, &mut caches);
            assert_eq!(step_out.dims(), [1, 1, dim]);
        }
    }
}
