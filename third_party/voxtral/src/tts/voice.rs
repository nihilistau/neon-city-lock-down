//! Voice preset loading for TTS.
//!
//! Loads pre-encoded voice reference embeddings from SafeTensors files.
//! Each voice is a variable-length `[N, 3072]` BF16 tensor representing
//! the voice in the backbone's hidden space.
//!
//! Voice files are expected as SafeTensors in `voice_embedding/` directory.
//! Use `scripts/convert_voice_embeds.py` to convert from PyTorch `.pt` format.

use anyhow::{bail, Context, Result};
use burn::tensor::backend::Backend;
use burn::tensor::Tensor;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::models::weights::load_tensor;

use super::config::VoiceEmbeddingConfig;

/// Registry of available voice presets.
///
/// Built by scanning a directory of SafeTensors voice embedding files.
#[derive(Debug)]
pub struct VoiceRegistry {
    /// Map from voice name to file path.
    voices: HashMap<String, PathBuf>,
    /// Expected embedding dimension.
    embed_dim: usize,
}

impl VoiceRegistry {
    /// Build a voice registry by scanning a directory for `.safetensors` files.
    ///
    /// Each file should be named `<voice_name>.safetensors` and contain a single
    /// tensor named `"embedding"` with shape `[N, embed_dim]`.
    pub fn from_directory<P: AsRef<Path>>(dir: P, config: &VoiceEmbeddingConfig) -> Result<Self> {
        let dir = dir.as_ref();
        if !dir.is_dir() {
            bail!(
                "Voice embedding directory not found: {}. \
                 Download voice embeddings or run scripts/convert_voice_embeds.py",
                dir.display()
            );
        }

        let mut voices = HashMap::new();
        for entry in std::fs::read_dir(dir).context("Failed to read voice directory")? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "safetensors") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    voices.insert(stem.to_string(), path);
                }
            }
        }

        if voices.is_empty() {
            bail!(
                "No .safetensors voice files found in {}. \
                 Run scripts/convert_voice_embeds.py to convert .pt files.",
                dir.display()
            );
        }

        Ok(Self {
            voices,
            embed_dim: config.embed_dim,
        })
    }

    /// List available voice names.
    pub fn list_voices(&self) -> Vec<&str> {
        let mut names: Vec<&str> = self.voices.keys().map(|s| s.as_str()).collect();
        names.sort();
        names
    }

    /// Check if a voice preset exists.
    pub fn has_voice(&self, name: &str) -> bool {
        self.voices.contains_key(name)
    }

    /// Number of registered voices.
    pub fn len(&self) -> usize {
        self.voices.len()
    }

    /// Whether the registry is empty.
    pub fn is_empty(&self) -> bool {
        self.voices.is_empty()
    }

    /// Load a voice embedding by name.
    ///
    /// Returns tensor `[N, embed_dim]` where N is the number of frames
    /// (variable per voice, duration = N / 12.5 seconds).
    pub fn load_voice<B: Backend>(&self, name: &str, device: &B::Device) -> Result<Tensor<B, 2>> {
        let path = self.voices.get(name).with_context(|| {
            format!(
                "Voice '{}' not found. Available: {}",
                name,
                self.list_voices().join(", ")
            )
        })?;

        load_voice_embedding(path, self.embed_dim, device)
    }
}

/// Load a voice embedding from in-memory SafeTensors bytes.
///
/// Used in WASM where voice files are fetched via HTTP rather than
/// loaded from the filesystem.
pub fn load_voice_from_bytes<B: Backend>(
    bytes: &[u8],
    expected_dim: usize,
    device: &B::Device,
) -> Result<Tensor<B, 2>> {
    let st = safetensors::SafeTensors::deserialize(bytes)
        .context("Failed to deserialize voice SafeTensors bytes")?;

    let embedding: Tensor<B, 2> = load_tensor(&st, "embedding", device)
        .context("Voice bytes must contain a tensor named 'embedding'")?;

    validate_voice_embedding(&embedding, expected_dim, "bytes")
}

/// Load a single voice embedding from a SafeTensors file.
///
/// Expects a tensor named `"embedding"` with shape `[N, embed_dim]`.
pub fn load_voice_embedding<B: Backend>(
    path: &Path,
    expected_dim: usize,
    device: &B::Device,
) -> Result<Tensor<B, 2>> {
    let owned = crate::models::weights::load_safetensors(path)
        .with_context(|| format!("Failed to load voice file: {}", path.display()))?;

    let embedding: Tensor<B, 2> =
        load_tensor(owned.tensors(), "embedding", device).with_context(|| {
            format!(
                "Voice file {} must contain a tensor named 'embedding'",
                path.display()
            )
        })?;

    validate_voice_embedding(&embedding, expected_dim, &path.display().to_string())
}

/// Validate a voice embedding tensor's shape.
fn validate_voice_embedding<B: Backend>(
    embedding: &Tensor<B, 2>,
    expected_dim: usize,
    source: &str,
) -> Result<Tensor<B, 2>> {
    let [n_frames, dim] = embedding.dims();
    if dim != expected_dim {
        bail!("Voice embedding dimension mismatch in {source}: expected {expected_dim}, got {dim}",);
    }
    if n_frames == 0 {
        bail!("Voice embedding in {source} has zero frames");
    }
    Ok(embedding.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_voice_registry_from_directory_missing() {
        let config = VoiceEmbeddingConfig::default();
        let result = VoiceRegistry::from_directory("/nonexistent/path", &config);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().to_string().contains("not found"),
            "Error should mention directory not found"
        );
    }

    #[test]
    fn test_voice_registry_from_real_directory() {
        let voice_dir = Path::new("models/voxtral-tts/voice_embedding");
        if !voice_dir.exists() {
            println!(
                "Skipping: voice directory not found at {}",
                voice_dir.display()
            );
            return;
        }

        let config = VoiceEmbeddingConfig::default();
        let registry = VoiceRegistry::from_directory(voice_dir, &config);

        match registry {
            Ok(reg) => {
                println!("Found {} voices: {:?}", reg.len(), reg.list_voices());
                assert!(!reg.is_empty());
            }
            Err(e) => {
                // May not have .safetensors files yet (only .pt)
                println!("Registry creation failed (expected if not converted): {e}");
            }
        }
    }

    #[test]
    fn test_load_voice_embedding_real() {
        use burn::backend::Wgpu;
        type TestBackend = Wgpu;

        let voice_dir = Path::new("models/voxtral-tts/voice_embedding");
        if !voice_dir.exists() {
            println!("Skipping: voice directory not found");
            return;
        }

        let config = VoiceEmbeddingConfig::default();
        let registry = match VoiceRegistry::from_directory(voice_dir, &config) {
            Ok(r) => r,
            Err(_) => {
                println!("Skipping: no .safetensors voice files");
                return;
            }
        };

        let device = Default::default();
        let voices = registry.list_voices();
        if let Some(name) = voices.first() {
            let embedding = registry.load_voice::<TestBackend>(name, &device).unwrap();
            let [n, dim] = embedding.dims();
            assert_eq!(dim, 3072);
            assert!(n > 0);
            println!("Voice '{name}': [{n}, {dim}] ({:.1}s)", n as f64 / 12.5);
        }
    }

    #[test]
    fn test_load_voice_not_found() {
        use burn::backend::Wgpu;
        type TestBackend = Wgpu;

        // Create a temp dir with no voice files to test the missing voice error
        let temp = std::env::temp_dir().join("voxtral_test_voice_empty");
        let _ = std::fs::create_dir_all(&temp);

        // Write a dummy .safetensors file so registry creation succeeds
        let dummy_path = temp.join("dummy.safetensors");
        if !dummy_path.exists() {
            // Create minimal safetensors with a tiny embedding
            use burn::tensor::TensorData;
            let data = TensorData::new(vec![0.0f32; 6], [2, 3]);
            let bytes_vec = data.as_bytes().to_vec();
            let map = std::collections::HashMap::from([(
                "embedding".to_string(),
                safetensors::tensor::TensorView::new(
                    safetensors::Dtype::F32,
                    vec![2, 3],
                    &bytes_vec,
                )
                .unwrap(),
            )]);
            let bytes = safetensors::tensor::serialize(&map, None).unwrap();
            std::fs::write(&dummy_path, bytes).unwrap();
        }

        let config = VoiceEmbeddingConfig {
            embed_dim: 3,
            ..Default::default()
        };
        let registry = VoiceRegistry::from_directory(&temp, &config).unwrap();

        let device: <Wgpu as Backend>::Device = Default::default();
        let result = registry.load_voice::<TestBackend>("nonexistent", &device);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));

        // Cleanup
        let _ = std::fs::remove_dir_all(&temp);
    }
}
