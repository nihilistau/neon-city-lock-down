//! Tokenizer for Voxtral (Tekken format).
//!
//! Voxtral uses Mistral's Tekken tokenizer with 131,072 vocabulary size.
//! This is a custom format that stores tokens as base64-encoded bytes.
//!
//! - [`VoxtralTokenizer`]: Decode-only (ASR). Works everywhere including WASM.
//! - [`TekkenEncoder`]: Encode + decode (TTS). Requires `native-tokenizer` feature.

use anyhow::{Context, Result};
use base64::prelude::*;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

#[cfg(feature = "native-tokenizer")]
mod encoder;
#[cfg(feature = "native-tokenizer")]
pub use encoder::TekkenEncoder;

/// Tekken tokenizer configuration from JSON.
#[derive(Debug, Deserialize)]
struct TekkenConfig {
    #[allow(dead_code)]
    pattern: String,
    #[allow(dead_code)]
    num_vocab_tokens: usize,
    default_vocab_size: usize,
    #[allow(dead_code)]
    default_num_special_tokens: usize,
    #[allow(dead_code)]
    version: String,
}

/// Single vocabulary entry.
#[derive(Debug, Deserialize)]
struct VocabEntry {
    rank: u32,
    #[serde(default)]
    token_bytes: Option<String>,
    #[serde(default)]
    token_str: Option<String>,
    #[serde(default)]
    is_control: bool,
}

/// Tekken JSON structure.
#[derive(Debug, Deserialize)]
struct TekkenJson {
    config: TekkenConfig,
    vocab: Vec<VocabEntry>,
}

/// Tekken tokenizer wrapper for Voxtral (decode only).
///
/// For ASR we receive token IDs from the model and decode them to text.
/// This works everywhere including WASM (no heavy dependencies).
///
/// Note: Text token IDs are offset by 1000 from the vocab index.
/// Token ID 1000+ maps to vocab index (token_id - 1000).
/// Token IDs 0-999 are reserved for special/control tokens.
pub struct VoxtralTokenizer {
    /// Vocab index -> decoded bytes (for text tokens)
    /// Token ID = vocab_index + 1000 for text tokens
    vocab_bytes: Vec<Option<Vec<u8>>>,
    /// Special token ID -> string representation (token IDs 0-999)
    special_tokens: HashMap<u32, String>,
    /// Vocabulary size
    vocab_size: usize,
}

/// Offset for text tokens. Token ID 1000 = vocab index 0.
pub(crate) const TEXT_TOKEN_OFFSET: u32 = 1000;

/// Parse tekken.json from a reader.
fn parse_tekken(tekken: TekkenJson) -> (Vec<Option<Vec<u8>>>, HashMap<u32, String>, usize) {
    let vocab_size = tekken.config.default_vocab_size;

    let mut vocab_bytes: Vec<Option<Vec<u8>>> = vec![None; tekken.vocab.len()];
    let mut special_tokens = HashMap::new();

    for (idx, entry) in tekken.vocab.iter().enumerate() {
        if entry.is_control {
            if let Some(s) = &entry.token_str {
                special_tokens.insert(entry.rank, s.clone());
            }
            continue;
        }

        if let Some(b64) = &entry.token_bytes {
            if let Ok(bytes) = BASE64_STANDARD.decode(b64) {
                vocab_bytes[idx] = Some(bytes);
                continue;
            }
        }

        if let Some(s) = &entry.token_str {
            vocab_bytes[idx] = Some(s.as_bytes().to_vec());
        }
    }

    (vocab_bytes, special_tokens, vocab_size)
}

impl VoxtralTokenizer {
    /// Load tokenizer from a `tekken.json` file.
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let path = path.as_ref();
        let file = std::fs::File::open(path)
            .with_context(|| format!("Failed to open tokenizer file: {}", path.display()))?;
        let reader = std::io::BufReader::new(file);
        let tekken: TekkenJson = serde_json::from_reader(reader)
            .with_context(|| format!("Failed to parse tekken.json: {}", path.display()))?;
        let (vocab_bytes, special_tokens, vocab_size) = parse_tekken(tekken);
        Ok(Self {
            vocab_bytes,
            special_tokens,
            vocab_size,
        })
    }

    /// Load tokenizer from a model directory.
    pub fn from_model_dir<P: AsRef<Path>>(dir: P) -> Result<Self> {
        Self::from_file(dir.as_ref().join("tekken.json"))
    }

    /// Load tokenizer from a JSON string.
    ///
    /// This is useful for WASM where file access is not available.
    pub fn from_json(json: &str) -> Result<Self> {
        let tekken: TekkenJson =
            serde_json::from_str(json).context("Failed to parse tekken JSON")?;
        let (vocab_bytes, special_tokens, vocab_size) = parse_tekken(tekken);
        Ok(Self {
            vocab_bytes,
            special_tokens,
            vocab_size,
        })
    }

    /// Decode token IDs to text.
    ///
    /// Token IDs >= 1000 are text tokens (vocab_index = token_id - 1000).
    /// Token IDs < 1000 are special/control tokens and are skipped.
    pub fn decode(&self, ids: &[u32]) -> Result<String> {
        let mut bytes = Vec::new();

        for &id in ids {
            if id < TEXT_TOKEN_OFFSET {
                continue;
            }

            let vocab_idx = (id - TEXT_TOKEN_OFFSET) as usize;
            if vocab_idx < self.vocab_bytes.len() {
                if let Some(token_bytes) = &self.vocab_bytes[vocab_idx] {
                    bytes.extend_from_slice(token_bytes);
                }
            }
        }

        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// Decode a single token ID to its string representation.
    pub fn decode_token(&self, id: u32) -> Option<String> {
        if id < TEXT_TOKEN_OFFSET {
            return self.special_tokens.get(&id).cloned();
        }

        let vocab_idx = (id - TEXT_TOKEN_OFFSET) as usize;
        if vocab_idx < self.vocab_bytes.len() {
            if let Some(bytes) = &self.vocab_bytes[vocab_idx] {
                return Some(String::from_utf8_lossy(bytes).into_owned());
            }
        }
        None
    }

    /// Get vocabulary size.
    pub fn vocab_size(&self) -> usize {
        self.vocab_size
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tokenizer_path() -> PathBuf {
        PathBuf::from("models/voxtral/tekken.json")
    }

    #[test]
    fn test_load_tokenizer() {
        let path = tokenizer_path();
        if !path.exists() {
            println!("Skipping: tokenizer not downloaded");
            return;
        }

        let tokenizer = VoxtralTokenizer::from_file(&path).unwrap();
        assert_eq!(tokenizer.vocab_size(), 131072);
        let vocab_count = tokenizer.vocab_bytes.iter().filter(|v| v.is_some()).count();
        println!(
            "Loaded tokenizer with {} text vocab entries, {} special tokens",
            vocab_count,
            tokenizer.special_tokens.len()
        );
    }

    #[test]
    fn test_decode_simple() {
        let path = tokenizer_path();
        if !path.exists() {
            println!("Skipping: tokenizer not downloaded");
            return;
        }

        let tokenizer = VoxtralTokenizer::from_file(&path).unwrap();

        let test_tokens = [1362_u32, 19135, 1294, 1278, 4618, 40307, 3910, 1046];
        let expected = " I spoke in the original phonograph.";

        for &id in &test_tokens {
            if let Some(s) = tokenizer.decode_token(id) {
                println!("Token {}: {:?}", id, s);
            }
        }

        let decoded = tokenizer.decode(&test_tokens).unwrap();
        println!("Full decode: {:?}", decoded);
        assert_eq!(decoded, expected);
    }
}
