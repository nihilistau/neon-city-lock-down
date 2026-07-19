//! Custom ratatui widget for rendering audio waveform.
//!
//! Renders a mirrored amplitude bar chart using Unicode block characters,
//! giving a smooth waveform appearance in the terminal.

use ratatui::{
    buffer::Buffer,
    layout::{Position, Rect},
    style::{Color, Style},
    widgets::{Block, Widget},
};

/// A terminal waveform widget that renders peak amplitude data
/// as a mirrored bar chart centered vertically.
pub struct WaveformWidget<'a> {
    /// Peak amplitude values (0.0..1.0), one per column.
    peaks: &'a [f32],
    /// Optional surrounding block.
    block: Option<Block<'a>>,
    /// Waveform bar color.
    color: Color,
}

impl<'a> WaveformWidget<'a> {
    pub fn new(peaks: &'a [f32]) -> Self {
        Self {
            peaks,
            block: None,
            color: Color::Green,
        }
    }

    pub fn block(mut self, block: Block<'a>) -> Self {
        self.block = Some(block);
        self
    }

    pub fn color(mut self, color: Color) -> Self {
        self.color = color;
        self
    }
}

/// Unicode block characters for sub-cell resolution (8 levels).
const BLOCKS: [char; 8] = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

impl<'a> Widget for WaveformWidget<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        // Render optional block and get inner area
        let inner = if let Some(block) = self.block {
            let inner = block.inner(area);
            block.render(area, buf);
            inner
        } else {
            area
        };

        if inner.width == 0 || inner.height == 0 {
            return;
        }

        let mid_row = inner.y + inner.height / 2;
        let half_height = inner.height / 2;

        // Draw center line
        for x in inner.x..inner.x + inner.width {
            if let Some(cell) = buf.cell_mut(Position::new(x, mid_row)) {
                cell.set_char('─')
                    .set_style(Style::default().fg(Color::DarkGray));
            }
        }

        // Draw waveform bars
        let style = Style::default().fg(self.color);
        for (i, &peak) in self.peaks.iter().enumerate() {
            let col = inner.x + i as u16;
            if col >= inner.x + inner.width {
                break;
            }

            let amplitude = peak.clamp(0.0, 1.0);
            if amplitude < 0.01 {
                continue;
            }

            // How many full rows + fractional part
            let bar_height_f = amplitude * half_height as f32;
            let full_rows = bar_height_f as u16;
            let frac = bar_height_f - full_rows as f32;
            let block_idx = ((frac * 8.0) as usize).min(7);

            // Draw upward from center
            for row_offset in 0..full_rows {
                let y = mid_row.saturating_sub(row_offset + 1);
                if y >= inner.y {
                    if let Some(cell) = buf.cell_mut(Position::new(col, y)) {
                        cell.set_char('█').set_style(style);
                    }
                }
            }
            // Fractional block on top
            if block_idx > 0 && full_rows < half_height {
                let y = mid_row.saturating_sub(full_rows + 1);
                if y >= inner.y {
                    if let Some(cell) = buf.cell_mut(Position::new(col, y)) {
                        cell.set_char(BLOCKS[block_idx]).set_style(style);
                    }
                }
            }

            // Mirror downward from center
            for row_offset in 0..full_rows {
                let y = mid_row + row_offset + 1;
                if y < inner.y + inner.height {
                    if let Some(cell) = buf.cell_mut(Position::new(col, y)) {
                        cell.set_char('█').set_style(style);
                    }
                }
            }
            if block_idx > 0 && full_rows < half_height {
                let y = mid_row + full_rows + 1;
                if y < inner.y + inner.height {
                    if let Some(cell) = buf.cell_mut(Position::new(col, y)) {
                        cell.set_char(BLOCKS[block_idx]).set_style(style);
                    }
                }
            }
        }
    }
}
