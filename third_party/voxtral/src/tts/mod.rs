//! Text-to-speech pipeline for Voxtral 4B TTS.
//!
//! Three-stage pipeline: backbone (Ministral 3B) -> flow-matching transformer
//! -> codec decoder -> 24 kHz waveform.

pub mod backbone;
pub mod config;
pub mod voice;

pub mod embeddings;
pub mod flow_matching;
pub mod sequence;

pub mod codec;
pub mod pipeline;
