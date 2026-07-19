//! Terminal UI for real-time audio waveform visualization.
//!
//! Provides a ratatui-based interface showing a scrolling waveform
//! alongside live transcription text. Used by the CLI `voxtral transcribe`
//! and `voxtral speak` commands when running in interactive mode.

mod waveform_widget;

pub use waveform_widget::WaveformWidget;

use crate::audio::RingBuffer;
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
    ExecutableCommand,
};
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph, Wrap},
};
use std::io::{self, stdout};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Shared state between audio processing and TUI rendering.
pub struct TuiState {
    /// Ring buffer fed by audio pipeline.
    pub audio_buffer: Arc<Mutex<RingBuffer>>,
    /// Current transcription text (updated live).
    pub transcription: Arc<Mutex<String>>,
    /// Status message shown in the header.
    pub status: Arc<Mutex<String>>,
    /// Set to true to signal the TUI to exit.
    pub should_quit: Arc<Mutex<bool>>,
}

impl TuiState {
    /// Create a new TUI state with a 3-second audio buffer at 16kHz.
    pub fn new() -> Self {
        Self {
            audio_buffer: Arc::new(Mutex::new(RingBuffer::from_duration_secs(3.0, 16000))),
            transcription: Arc::new(Mutex::new(String::new())),
            status: Arc::new(Mutex::new("initializing...".to_string())),
            should_quit: Arc::new(Mutex::new(false)),
        }
    }

    /// Push audio samples into the shared buffer.
    pub fn push_audio(&self, samples: &[f32]) {
        if let Ok(mut buf) = self.audio_buffer.lock() {
            buf.push_slice(samples);
        }
    }

    /// Update the transcription text.
    pub fn set_transcription(&self, text: &str) {
        if let Ok(mut t) = self.transcription.lock() {
            *t = text.to_string();
        }
    }

    /// Update the status message.
    pub fn set_status(&self, msg: &str) {
        if let Ok(mut s) = self.status.lock() {
            *s = msg.to_string();
        }
    }

    /// Signal the TUI to quit.
    pub fn quit(&self) {
        if let Ok(mut q) = self.should_quit.lock() {
            *q = true;
        }
    }
}

impl Default for TuiState {
    fn default() -> Self {
        Self::new()
    }
}

/// Run the TUI event loop. Blocks until the user presses 'q' or Escape,
/// or `state.should_quit` is set to true.
///
/// This should be called from the main thread. Audio processing and
/// inference should happen on separate threads, pushing data into `state`.
pub fn run_tui(state: &TuiState) -> io::Result<()> {
    enable_raw_mode()?;
    stdout().execute(EnterAlternateScreen)?;

    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;

    loop {
        // Check quit flag
        if *state.should_quit.lock().unwrap_or_else(|e| e.into_inner()) {
            break;
        }

        // Draw
        terminal.draw(|frame| draw_ui(frame, state))?;

        // Poll events (non-blocking, 50ms timeout for ~20fps refresh)
        if event::poll(Duration::from_millis(50))? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    match key.code {
                        KeyCode::Char('q') | KeyCode::Esc => break,
                        _ => {}
                    }
                }
            }
        }
    }

    disable_raw_mode()?;
    stdout().execute(LeaveAlternateScreen)?;
    Ok(())
}

fn draw_ui(frame: &mut Frame, state: &TuiState) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),  // status bar
            Constraint::Length(10), // waveform
            Constraint::Min(3),     // transcription
            Constraint::Length(1),  // help line
        ])
        .split(frame.area());

    // Status bar
    let status_text = state.status.lock().map(|s| s.clone()).unwrap_or_default();
    let status = Paragraph::new(Line::from(vec![
        Span::styled(" voxtral ", Style::default().fg(Color::Yellow).bold()),
        Span::styled("│ ", Style::default().fg(Color::DarkGray)),
        Span::raw(status_text),
    ]));
    frame.render_widget(status, chunks[0]);

    // Waveform
    let peaks = state
        .audio_buffer
        .lock()
        .map(|buf| buf.snapshot_peaks(chunks[1].width as usize))
        .unwrap_or_default();

    let waveform = WaveformWidget::new(&peaks)
        .block(Block::default().borders(Borders::ALL).title(" waveform "))
        .color(Color::Rgb(207, 106, 76)); // orange
    frame.render_widget(waveform, chunks[1]);

    // Transcription
    let text = state
        .transcription
        .lock()
        .map(|t| t.clone())
        .unwrap_or_default();
    let transcription = Paragraph::new(if text.is_empty() {
        "waiting for audio...".to_string()
    } else {
        text
    })
    .block(
        Block::default()
            .borders(Borders::ALL)
            .title(" transcription "),
    )
    .wrap(Wrap { trim: false })
    .style(
        if state
            .transcription
            .lock()
            .map(|t| t.is_empty())
            .unwrap_or(true)
        {
            Style::default().fg(Color::DarkGray)
        } else {
            Style::default()
        },
    );
    frame.render_widget(transcription, chunks[2]);

    // Help
    let help = Paragraph::new(Line::from(vec![
        Span::styled(" q", Style::default().fg(Color::Yellow)),
        Span::raw(" quit"),
    ]))
    .style(Style::default().fg(Color::DarkGray));
    frame.render_widget(help, chunks[3]);
}
