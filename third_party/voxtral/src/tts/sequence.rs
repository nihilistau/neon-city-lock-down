//! Input sequence construction for TTS.
//!
//! Builds the TTS input sequence from voice embeddings and tokenized text
//! (per vLLM/mistral-common reference):
//! ```text
//! [BOS(1)] [BEGIN_AUDIO(25)] [voice_0..N] [NEXT_AUDIO_TEXT(36)] [text_0..M] [REPEAT_AUDIO_TEXT(35)] [BEGIN_AUDIO(25)]
//! ```
//!
//! - Voice embeddings are raw [3072] vectors (from pre-encoded `.safetensors` files)
//! - Text tokens and special tokens are embedded via `tok_embeddings.weight` [131072, 3072]
//! - Returns [1, seq_len, 3072] ready for backbone prefill

use burn::tensor::backend::Backend;
use burn::tensor::Tensor;

use crate::tts::config::TtsSpecialTokens;

/// Build the TTS input embedding sequence for backbone prefill.
///
/// Concatenates: `[BOS_embed, voice_0..N, next_embed, text_0..M, repeat_embed]`
///
/// # Arguments
/// * `voice_embeddings` - Pre-encoded voice reference [N, dim]
/// * `text_token_ids` - Tokenized text as u32 IDs
/// * `tok_embeddings` - Shared token embedding table [vocab_size, dim]
/// * `special_tokens` - Special token IDs for BOS, next, repeat
///
/// # Returns
/// Input embedding tensor [1, seq_len, dim] where seq_len = 1 + N + 1 + M + 1
pub fn build_input_sequence<B: Backend>(
    voice_embeddings: Tensor<B, 2>,
    text_token_ids: &[u32],
    tok_embeddings: &Tensor<B, 2>,
    special_tokens: &TtsSpecialTokens,
) -> Tensor<B, 3> {
    let [_vocab, dim] = tok_embeddings.dims();

    // Embed special tokens via tok_embeddings lookup
    // Sequence: [BOS(1)] [BEGIN_AUDIO(25)] [voice_0..N] [NEXT_AUDIO_TEXT(36)] [text_0..M] [REPEAT_AUDIO_TEXT(35)] [BEGIN_AUDIO(25)]
    let bos_embed = lookup_token(tok_embeddings, special_tokens.bos_token_id as usize, dim);
    let begin_audio_embed = lookup_token(
        tok_embeddings,
        special_tokens.begin_audio_token_id as usize,
        dim,
    );
    let next_audio_text_embed = lookup_token(
        tok_embeddings,
        special_tokens.next_audio_text_token_id as usize,
        dim,
    );
    let repeat_audio_text_embed = lookup_token(
        tok_embeddings,
        special_tokens.repeat_audio_text_token_id as usize,
        dim,
    );

    // Embed text tokens
    let text_embeds: Vec<Tensor<B, 2>> = text_token_ids
        .iter()
        .map(|&id| lookup_token(tok_embeddings, id as usize, dim))
        .collect();

    // Build sequence: [BOS, BEGIN_AUDIO, voice_0..N, NEXT_AUDIO_TEXT, text_0..M, REPEAT_AUDIO_TEXT, BEGIN_AUDIO]
    let mut parts: Vec<Tensor<B, 2>> = vec![
        bos_embed,
        begin_audio_embed.clone(),
        voice_embeddings,
        next_audio_text_embed,
    ];
    parts.extend(text_embeds);
    parts.push(repeat_audio_text_embed);
    parts.push(begin_audio_embed);

    // Concatenate along sequence dimension: each part is [1, dim] or [k, dim]
    let seq = Tensor::cat(parts, 0); // [seq_len, dim]
    let [seq_len, _] = seq.dims();
    seq.reshape([1, seq_len, dim])
}

/// Look up a single token from the embedding table.
///
/// Returns [1, dim] tensor.
fn lookup_token<B: Backend>(
    tok_embeddings: &Tensor<B, 2>,
    token_id: usize,
    dim: usize,
) -> Tensor<B, 2> {
    tok_embeddings
        .clone()
        .slice([token_id..token_id + 1, 0..dim])
}

/// Compute the expected sequence length for a given input.
///
/// `seq_len = 1 (BOS) + 1 (BEGIN_AUDIO) + n_voice + 1 (NEXT_AUDIO_TEXT) + n_text + 1 (REPEAT_AUDIO_TEXT) + 1 (BEGIN_AUDIO)`
pub fn expected_seq_len(n_voice: usize, n_text: usize) -> usize {
    1 + 1 + n_voice + 1 + n_text + 1 + 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use burn::backend::Wgpu;
    use burn::tensor::TensorData;

    type TestBackend = Wgpu;

    /// Create a test embedding table where each row is filled with the row index.
    fn make_test_embeddings(vocab_size: usize, dim: usize) -> Tensor<TestBackend, 2> {
        let device = Default::default();
        let mut data = vec![0.0f32; vocab_size * dim];
        for row in 0..vocab_size {
            for col in 0..dim {
                data[row * dim + col] = row as f32;
            }
        }
        Tensor::from_data(TensorData::new(data, [vocab_size, dim]), &device)
    }

    #[test]
    fn test_expected_seq_len() {
        // 1(BOS) + 1(BEGIN_AUDIO) + voice + 1(NEXT) + text + 1(REPEAT) + 1(BEGIN_AUDIO)
        assert_eq!(expected_seq_len(10, 5), 1 + 1 + 10 + 1 + 5 + 1 + 1);
        assert_eq!(expected_seq_len(0, 0), 5); // BOS + BEGIN_AUDIO + NEXT + REPEAT + BEGIN_AUDIO
    }

    #[test]
    fn test_build_input_sequence_shape() {
        let dim = 8;
        let vocab_size = 100;
        let device = Default::default();

        let tok_embeddings = make_test_embeddings(vocab_size, dim);
        let voice_embeddings = Tensor::<TestBackend, 2>::zeros([5, dim], &device);
        let text_token_ids = vec![10u32, 20, 30];
        let special_tokens = TtsSpecialTokens::default();

        let seq = build_input_sequence(
            voice_embeddings,
            &text_token_ids,
            &tok_embeddings,
            &special_tokens,
        );

        // seq_len = 1(BOS) + 1(BEGIN_AUDIO) + 5(voice) + 1(NEXT) + 3(text) + 1(REPEAT) + 1(BEGIN_AUDIO) = 13
        assert_eq!(seq.dims(), [1, 13, dim]);
    }

    #[test]
    fn test_build_input_sequence_token_positions() {
        let dim = 4;
        let vocab_size = 100;
        let device = Default::default();

        let tok_embeddings = make_test_embeddings(vocab_size, dim);
        // Voice embeddings: 2 vectors filled with 999.0 (distinguishable from tok lookups)
        let voice_data = vec![999.0f32; 2 * dim];
        let voice_embeddings = Tensor::from_data(TensorData::new(voice_data, [2, dim]), &device);
        let text_token_ids = vec![42u32, 77];
        let special_tokens = TtsSpecialTokens::default();

        let seq = build_input_sequence(
            voice_embeddings,
            &text_token_ids,
            &tok_embeddings,
            &special_tokens,
        );

        // seq_len = 1(BOS) + 1(BEGIN_AUDIO) + 2(voice) + 1(NEXT) + 2(text) + 1(REPEAT) + 1(BEGIN_AUDIO) = 9
        assert_eq!(seq.dims(), [1, 9, dim]);

        let data = seq.to_data();
        let slice = data.as_slice::<f32>().unwrap();

        // Helper: get the first element of position p (all dims have same value in our test table)
        let val_at = |pos: usize| slice[pos * dim];

        // Position 0: BOS (token_id=1)
        assert_eq!(val_at(0), 1.0, "pos 0 should be BOS embed (token 1)");

        // Position 1: BEGIN_AUDIO (token_id=25)
        assert_eq!(
            val_at(1),
            25.0,
            "pos 1 should be BEGIN_AUDIO embed (token 25)"
        );

        // Positions 2-3: voice embeddings (filled with 999.0)
        assert_eq!(val_at(2), 999.0, "pos 2 should be voice embed");
        assert_eq!(val_at(3), 999.0, "pos 3 should be voice embed");

        // Position 4: NEXT_AUDIO_TEXT (token_id=36)
        assert_eq!(
            val_at(4),
            36.0,
            "pos 4 should be NEXT_AUDIO_TEXT embed (token 36)"
        );

        // Positions 5-6: text tokens (42, 77)
        assert_eq!(val_at(5), 42.0, "pos 5 should be text token 42");
        assert_eq!(val_at(6), 77.0, "pos 6 should be text token 77");

        // Position 7: REPEAT_AUDIO_TEXT (token_id=35)
        assert_eq!(
            val_at(7),
            35.0,
            "pos 7 should be REPEAT_AUDIO_TEXT embed (token 35)"
        );

        // Position 8: BEGIN_AUDIO (token_id=25)
        assert_eq!(
            val_at(8),
            25.0,
            "pos 8 should be trailing BEGIN_AUDIO embed (token 25)"
        );
    }

    #[test]
    fn test_build_input_sequence_empty_text() {
        let dim = 4;
        let vocab_size = 100;
        let device = Default::default();

        let tok_embeddings = make_test_embeddings(vocab_size, dim);
        let voice_embeddings = Tensor::<TestBackend, 2>::zeros([3, dim], &device);
        let text_token_ids: Vec<u32> = vec![];
        let special_tokens = TtsSpecialTokens::default();

        let seq = build_input_sequence(
            voice_embeddings,
            &text_token_ids,
            &tok_embeddings,
            &special_tokens,
        );

        // seq_len = 1(BOS) + 1(BEGIN_AUDIO) + 3(voice) + 1(NEXT) + 0(text) + 1(REPEAT) + 1(BEGIN_AUDIO) = 8
        assert_eq!(seq.dims(), [1, 8, dim]);
    }

    #[test]
    fn test_build_input_sequence_single_voice() {
        let dim = 4;
        let vocab_size = 100;
        let device = Default::default();

        let tok_embeddings = make_test_embeddings(vocab_size, dim);
        let voice_embeddings = Tensor::<TestBackend, 2>::ones([1, dim], &device) * 500.0;
        let text_token_ids = vec![10u32];
        let special_tokens = TtsSpecialTokens::default();

        let seq = build_input_sequence(
            voice_embeddings,
            &text_token_ids,
            &tok_embeddings,
            &special_tokens,
        );

        // seq_len = 1(BOS) + 1(BEGIN_AUDIO) + 1(voice) + 1(NEXT) + 1(text) + 1(REPEAT) + 1(BEGIN_AUDIO) = 7
        assert_eq!(seq.dims(), [1, 7, dim]);

        let data = seq.to_data();
        let slice = data.as_slice::<f32>().unwrap();
        let val_at = |pos: usize| slice[pos * dim];

        assert_eq!(val_at(0), 1.0, "BOS");
        assert_eq!(val_at(1), 25.0, "BEGIN_AUDIO");
        assert_eq!(val_at(2), 500.0, "voice");
        assert_eq!(val_at(3), 36.0, "NEXT_AUDIO_TEXT");
        assert_eq!(val_at(4), 10.0, "text");
        assert_eq!(val_at(5), 35.0, "REPEAT_AUDIO_TEXT");
        assert_eq!(val_at(6), 25.0, "trailing BEGIN_AUDIO");
    }

    #[test]
    fn test_lookup_token() {
        let dim = 4;
        let tok_embeddings = make_test_embeddings(50, dim);

        let row = lookup_token(&tok_embeddings, 7, dim);
        assert_eq!(row.dims(), [1, dim]);

        let data = row.to_data();
        let slice = data.as_slice::<f32>().unwrap();
        for &v in slice {
            assert_eq!(v, 7.0);
        }
    }
}
