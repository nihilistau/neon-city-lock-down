//! Tekken BPE encoder using tiktoken-rs.
//!
//! Builds a `CoreBPE` from tekken.json for text → token ID encoding.
//! Token IDs are offset by 1000 (special tokens occupy 0-999).

use std::path::Path;

use anyhow::{Context, Result};
use base64::prelude::*;
use rustc_hash::FxHashMap;
use tiktoken_rs::CoreBPE;

use super::{TekkenJson, TEXT_TOKEN_OFFSET};

/// Tekken BPE encoder for text → token IDs.
///
/// Wraps tiktoken's `CoreBPE` with the correct vocab and regex pattern
/// from a tekken.json file. Output token IDs include the 1000 offset
/// (matching the model's embedding table layout).
pub struct TekkenEncoder {
    bpe: CoreBPE,
}

impl TekkenEncoder {
    /// Load encoder from a `tekken.json` file.
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let path = path.as_ref();
        let file = std::fs::File::open(path)
            .with_context(|| format!("Failed to open tokenizer: {}", path.display()))?;
        let reader = std::io::BufReader::new(file);
        let tekken: TekkenJson = serde_json::from_reader(reader)
            .with_context(|| format!("Failed to parse tekken.json: {}", path.display()))?;
        Self::from_tekken(tekken)
    }

    /// Load encoder from a JSON string.
    pub fn from_json(json: &str) -> Result<Self> {
        let tekken: TekkenJson =
            serde_json::from_str(json).context("Failed to parse tekken JSON")?;
        Self::from_tekken(tekken)
    }

    fn from_tekken(tekken: TekkenJson) -> Result<Self> {
        let pattern = &tekken.config.pattern;
        let inner_vocab_size =
            tekken.config.default_vocab_size - tekken.config.default_num_special_tokens;

        // Build mergeable_ranks: bytes → rank (for non-special tokens only)
        let mut mergeable_ranks: FxHashMap<Vec<u8>, u32> =
            FxHashMap::with_capacity_and_hasher(inner_vocab_size, Default::default());

        for entry in &tekken.vocab {
            if entry.is_control {
                continue;
            }

            let rank = entry.rank;
            if rank as usize >= inner_vocab_size {
                continue;
            }

            let bytes = if let Some(b64) = &entry.token_bytes {
                BASE64_STANDARD
                    .decode(b64)
                    .with_context(|| format!("Bad base64 for rank {rank}"))?
            } else if let Some(s) = &entry.token_str {
                s.as_bytes().to_vec()
            } else {
                continue;
            };

            mergeable_ranks.insert(bytes, rank);
        }

        let special_tokens: FxHashMap<String, u32> = FxHashMap::default();
        let bpe = CoreBPE::new(mergeable_ranks, special_tokens, pattern)
            .map_err(|e| anyhow::anyhow!("Failed to create CoreBPE: {e}"))?;

        Ok(Self { bpe })
    }

    /// Encode text to token IDs (with 1000 offset applied).
    ///
    /// Returns token IDs matching the model's embedding table layout:
    /// IDs 0-999 are special tokens, 1000+ are text tokens.
    pub fn encode(&self, text: &str) -> Vec<u32> {
        let ranks = self.bpe.encode_ordinary(text);
        ranks.into_iter().map(|r| r + TEXT_TOKEN_OFFSET).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tts_tokenizer_path() -> PathBuf {
        PathBuf::from("models/voxtral-tts/tekken.json")
    }

    fn asr_tokenizer_path() -> PathBuf {
        PathBuf::from("models/voxtral/tekken.json")
    }

    #[test]
    fn test_encode_hello_world() {
        let path = tts_tokenizer_path();
        if !path.exists() {
            let path2 = asr_tokenizer_path();
            if !path2.exists() {
                println!("Skipping: no tokenizer available");
                return;
            }
            let enc = TekkenEncoder::from_file(&path2).unwrap();
            let ids = enc.encode("Hello world");
            // Both ASR and TTS tokenizers use the same Tekken vocab
            assert_eq!(ids, vec![22177, 4304]);
            return;
        }
        let enc = TekkenEncoder::from_file(&path).unwrap();
        let ids = enc.encode("Hello world");
        assert_eq!(ids, vec![22177, 4304]);
    }

    #[test]
    fn test_encode_various_texts() {
        let path = tts_tokenizer_path();
        let path = if path.exists() {
            path
        } else {
            let p = asr_tokenizer_path();
            if !p.exists() {
                println!("Skipping: no tokenizer available");
                return;
            }
            p
        };

        let enc = TekkenEncoder::from_file(&path).unwrap();

        // Verified against Python: Tekkenizer.encode(text, bos=False, eos=False)
        assert_eq!(
            enc.encode("Mary had a little lamb"),
            vec![48650, 1880, 1261, 4945, 56914]
        );
        assert_eq!(
            enc.encode("The quick brown fox jumps over the lazy dog."),
            vec![1784, 7586, 22980, 94137, 72993, 2136, 1278, 42757, 10575, 1046]
        );
    }

    #[test]
    fn test_encode_offset() {
        let path = tts_tokenizer_path();
        let path = if path.exists() {
            path
        } else {
            let p = asr_tokenizer_path();
            if !p.exists() {
                println!("Skipping: no tokenizer available");
                return;
            }
            p
        };

        let enc = TekkenEncoder::from_file(&path).unwrap();
        let ids = enc.encode("a");
        // All IDs should be >= 1000 (TEXT_TOKEN_OFFSET)
        for &id in &ids {
            assert!(id >= TEXT_TOKEN_OFFSET, "Token ID {id} below offset");
        }
    }
}
