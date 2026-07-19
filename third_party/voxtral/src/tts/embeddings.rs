//! Audio codebook embedding layer for TTS.
//!
//! Maps semantic + acoustic token indices to backbone input vectors using the
//! [9088, 3072] embedding table. Three regions: semantic VQ, acoustic FSQ,
//! and special tokens. See T-05 in docs/tts-tasks.md for full spec.
//!
//! ## Index Layout
//!
//! | Range          | Content                                    |
//! |----------------|--------------------------------------------|
//! | 0..1           | Semantic specials (EMPTY_AUDIO, END_AUDIO) |
//! | 2..8193        | Semantic VQ (8192 entries, offset +2)       |
//! | 8194..9021     | 36 acoustic codebooks × 23 entries each     |
//! | 9022..9087     | Alignment padding (unused zeros)           |
//!
//! Per acoustic codebook (stride 23): 2 specials + 21 FSQ levels.
//! Per-frame embedding: **sum** all 37 embeddings (1 semantic + 36 acoustic).

use burn::tensor::backend::Backend;
use burn::tensor::Tensor;

use crate::tts::config::AudioCodebookLayout;

/// Audio codebook embedding layer.
///
/// Holds a reference to the [9088, 3072] embedding table loaded by the backbone
/// (T-03). Provides index arithmetic and per-frame embedding computation.
#[derive(Debug)]
pub struct AudioCodebookEmbeddings<B: Backend> {
    /// The embedding table [9088, 3072]. Owned — passed in from backbone at construction.
    table: Tensor<B, 2>,
    /// Embedding dimension (3072).
    dim: usize,
    /// Layout constants for index arithmetic.
    layout: AudioCodebookLayout,
}

impl<B: Backend> AudioCodebookEmbeddings<B> {
    /// Create from an embedding table tensor.
    ///
    /// The table is expected to be [table_size, dim] where table_size >= layout.total_entries().
    pub fn new(table: Tensor<B, 2>, layout: AudioCodebookLayout) -> Self {
        let [_table_size, dim] = table.dims();
        Self { table, dim, layout }
    }

    /// Look up a single embedding by global index.
    ///
    /// Returns a tensor of shape [1, dim].
    pub fn lookup(&self, global_index: usize) -> Tensor<B, 2> {
        self.table
            .clone()
            .slice([global_index..global_index + 1, 0..self.dim])
    }

    /// Look up the embedding for a semantic token (raw index 0..8191).
    ///
    /// Applies the +2 offset to skip semantic specials.
    pub fn embed_semantic(&self, raw_semantic_idx: usize) -> Tensor<B, 2> {
        let global = self.layout.semantic_global_index(raw_semantic_idx);
        self.lookup(global)
    }

    /// Look up the embedding for an acoustic codebook level.
    ///
    /// `codebook`: 0..35, `level`: 0..20.
    pub fn embed_acoustic(&self, codebook: usize, level: usize) -> Tensor<B, 2> {
        let global = self.layout.acoustic_global_index(codebook, level);
        self.lookup(global)
    }

    /// Look up the EMPTY_AUDIO special embedding (global index 0).
    pub fn embed_empty_audio(&self) -> Tensor<B, 2> {
        self.lookup(0)
    }

    /// Look up the END_AUDIO special embedding (global index 1).
    pub fn embed_end_audio(&self) -> Tensor<B, 2> {
        self.lookup(1)
    }

    /// Compute the per-frame embedding by summing 1 semantic + 36 acoustic embeddings.
    ///
    /// Returns a tensor of shape [1, dim] (the summed embedding for one audio frame).
    pub fn embed_frame(&self, semantic_idx: usize, acoustic_levels: &[usize; 36]) -> Tensor<B, 2> {
        let mut sum = self.embed_semantic(semantic_idx);
        for (cb, &level) in acoustic_levels.iter().enumerate() {
            sum = sum + self.embed_acoustic(cb, level);
        }
        sum
    }

    /// Embedding dimension.
    pub fn dim(&self) -> usize {
        self.dim
    }

    /// Layout constants.
    pub fn layout(&self) -> &AudioCodebookLayout {
        &self.layout
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use burn::backend::Wgpu;
    use burn::prelude::ElementConversion;
    use burn::tensor::TensorData;

    type TestBackend = Wgpu;

    /// Create a test embedding table where each row is filled with the row index value.
    /// This makes it easy to verify which rows are being looked up.
    fn make_test_table(table_size: usize, dim: usize) -> Tensor<TestBackend, 2> {
        let device = Default::default();
        let mut data = vec![0.0f32; table_size * dim];
        for row in 0..table_size {
            for col in 0..dim {
                data[row * dim + col] = row as f32;
            }
        }
        Tensor::from_data(TensorData::new(data, [table_size, dim]), &device)
    }

    #[test]
    fn test_lookup_returns_correct_row() {
        let layout = AudioCodebookLayout::default();
        let table = make_test_table(9088, 8);
        let embed = AudioCodebookEmbeddings::new(table, layout);

        // Row 5 should have all values = 5.0
        let row = embed.lookup(5);
        assert_eq!(row.dims(), [1, 8]);
        let data = row.to_data();
        let slice = data.as_slice::<f32>().unwrap();
        for &v in slice {
            assert_eq!(v, 5.0);
        }
    }

    #[test]
    fn test_semantic_index_offset() {
        let layout = AudioCodebookLayout::default();
        let table = make_test_table(9088, 4);
        let embed = AudioCodebookEmbeddings::new(table, layout);

        // Semantic raw 0 → global 2
        let row = embed.embed_semantic(0);
        let data = row.to_data();
        let slice = data.as_slice::<f32>().unwrap();
        assert_eq!(
            slice[0], 2.0,
            "raw_semantic_idx=0 should map to global index 2"
        );

        // Semantic raw 8191 → global 8193
        let row = embed.embed_semantic(8191);
        let data = row.to_data();
        let slice = data.as_slice::<f32>().unwrap();
        assert_eq!(
            slice[0], 8193.0,
            "raw_semantic_idx=8191 should map to global index 8193"
        );
    }

    #[test]
    fn test_acoustic_index_layout() {
        let layout = AudioCodebookLayout::default();
        let table = make_test_table(9088, 4);
        let embed = AudioCodebookEmbeddings::new(table, layout);

        // Codebook 0, level 0 → 8194 + 0*23 + 0 + 2 = 8196
        let row = embed.embed_acoustic(0, 0);
        let data = row.to_data();
        let slice = data.as_slice::<f32>().unwrap();
        assert_eq!(
            slice[0], 8196.0,
            "codebook=0, level=0 should map to global index 8196"
        );

        // Codebook 0, level 20 → 8194 + 0*23 + 20 + 2 = 8216
        let row = embed.embed_acoustic(0, 20);
        let data = row.to_data();
        let slice = data.as_slice::<f32>().unwrap();
        assert_eq!(
            slice[0], 8216.0,
            "codebook=0, level=20 should map to global index 8216"
        );

        // Codebook 35, level 20 → 8194 + 35*23 + 20 + 2 = 9021
        let row = embed.embed_acoustic(35, 20);
        let data = row.to_data();
        let slice = data.as_slice::<f32>().unwrap();
        assert_eq!(
            slice[0], 9021.0,
            "codebook=35, level=20 should map to global index 9021"
        );
    }

    #[test]
    fn test_special_tokens() {
        let layout = AudioCodebookLayout::default();
        let table = make_test_table(9088, 4);
        let embed = AudioCodebookEmbeddings::new(table, layout);

        // EMPTY_AUDIO = global 0
        let row = embed.embed_empty_audio();
        let data = row.to_data();
        assert_eq!(data.as_slice::<f32>().unwrap()[0], 0.0);

        // END_AUDIO = global 1
        let row = embed.embed_end_audio();
        let data = row.to_data();
        assert_eq!(data.as_slice::<f32>().unwrap()[0], 1.0);
    }

    #[test]
    fn test_embed_frame_sums_all_37() {
        let layout = AudioCodebookLayout::default();
        let dim = 4;
        let table = make_test_table(9088, dim);
        let embed = AudioCodebookEmbeddings::new(table, layout);

        // Use semantic_idx=0 (global=2) and all acoustic levels=0
        // Each acoustic codebook 0..35 at level 0 maps to:
        //   8194 + cb*23 + 0 + 2 = 8196 + cb*23
        let acoustic_levels = [0usize; 36];
        let frame = embed.embed_frame(0, &acoustic_levels);
        assert_eq!(frame.dims(), [1, dim]);

        // Expected sum:
        // semantic: global index 2 → value 2.0
        // acoustic: sum of (8196 + cb*23) for cb in 0..36
        let semantic_val = 2.0f32;
        let acoustic_sum: f32 = (0..36).map(|cb| (8196 + cb * 23) as f32).sum();
        let expected = semantic_val + acoustic_sum;

        let data = frame.to_data();
        let slice = data.as_slice::<f32>().unwrap();
        // All dims have the same value since our test table fills each row uniformly
        assert!(
            (slice[0] - expected).abs() < 0.1,
            "Frame sum should be {expected}, got {}",
            slice[0]
        );
    }

    #[test]
    fn test_embed_frame_different_levels_produce_different_results() {
        let layout = AudioCodebookLayout::default();
        let table = make_test_table(9088, 4);
        let embed = AudioCodebookEmbeddings::new(table, layout);

        let levels_a = [0usize; 36];
        let levels_b = [10usize; 36];

        let frame_a = embed.embed_frame(0, &levels_a);
        let frame_b = embed.embed_frame(0, &levels_b);

        let diff = (frame_a - frame_b).abs().sum().into_scalar().elem::<f32>();
        assert!(
            diff > 0.0,
            "Different acoustic levels should produce different frame embeddings"
        );
    }

    #[test]
    fn test_layout_consistency_with_config() {
        let layout = AudioCodebookLayout::default();

        // Verify layout matches spec
        assert_eq!(layout.semantic_vq_size, 8192);
        assert_eq!(layout.acoustic_codebooks, 36);
        assert_eq!(layout.fsq_levels, 21);
        assert_eq!(layout.specials_per_codebook, 2);

        // Derived values
        assert_eq!(layout.acoustic_stride(), 23); // 2 specials + 21 levels
        assert_eq!(layout.acoustic_region_start(), 8194); // 2 + 8192
        assert_eq!(layout.total_entries(), 9022); // 2 + 8192 + 36*23

        // Total entries should fit in the 9088 table
        assert!(layout.total_entries() <= 9088);
    }
}
