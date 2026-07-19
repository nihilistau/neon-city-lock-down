//! Unified CLI for Voxtral ASR and TTS.
//!
//! ```text
//! voxtral transcribe --audio file.wav [--gguf model.gguf | --model dir/]
//! voxtral speak --text "Hello" --voice casual_female [--gguf model.gguf | --model dir/]
//! ```

mod speak;
mod transcribe;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "voxtral")]
#[command(about = "Voxtral speech recognition and synthesis")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Transcribe audio to text (ASR)
    Transcribe(transcribe::Args),
    /// Synthesize speech from text (TTS)
    Speak(speak::Args),
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_writer(std::io::stderr)
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();
    match cli.command {
        Command::Transcribe(args) => transcribe::run(args),
        Command::Speak(args) => speak::run(args),
    }
}
