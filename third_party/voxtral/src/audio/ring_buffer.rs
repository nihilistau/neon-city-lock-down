//! Lock-free ring buffer for real-time audio waveform visualization.
//!
//! Provides a fixed-capacity circular buffer of f32 samples that both the
//! browser (via WASM bindgen) and CLI (via TUI) consume for rendering.
//! The buffer overwrites the oldest samples when full, maintaining a
//! sliding window of recent audio.
//!
//! # Example
//!
//! ```
//! use voxtral_mini_realtime::audio::RingBuffer;
//!
//! let mut rb = RingBuffer::new(1024);
//! rb.push_slice(&[0.1, 0.2, 0.3]);
//! assert_eq!(rb.len(), 3);
//!
//! let snapshot = rb.snapshot();
//! assert_eq!(snapshot, &[0.1, 0.2, 0.3]);
//! ```

/// A fixed-capacity circular buffer for f32 audio samples.
///
/// Designed for single-producer usage (audio thread pushes samples)
/// with snapshot reads for visualization. Not thread-safe on its own;
/// wrap in `Arc<Mutex<_>>` if sharing across threads, or access from
/// a single thread (which is the case in both WASM and TUI event loops).
#[derive(Debug, Clone)]
pub struct RingBuffer {
    /// Internal storage, always `capacity` elements long.
    buf: Vec<f32>,
    /// Write position (next index to write to).
    write_pos: usize,
    /// Number of valid samples currently in the buffer.
    len: usize,
}

impl RingBuffer {
    /// Create a new ring buffer with the given capacity in samples.
    ///
    /// A typical default for waveform display at 16kHz is 32,000 samples
    /// (2 seconds of audio).
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "RingBuffer capacity must be > 0");
        Self {
            buf: vec![0.0; capacity],
            write_pos: 0,
            len: 0,
        }
    }

    /// Create a ring buffer sized for a given duration at a sample rate.
    ///
    /// # Example
    /// ```
    /// use voxtral_mini_realtime::audio::RingBuffer;
    /// let rb = RingBuffer::from_duration_secs(2.0, 16000);
    /// assert_eq!(rb.capacity(), 32000);
    /// ```
    pub fn from_duration_secs(seconds: f32, sample_rate: u32) -> Self {
        let capacity = (seconds * sample_rate as f32).ceil() as usize;
        Self::new(capacity)
    }

    /// Push a single sample into the buffer.
    #[inline]
    pub fn push(&mut self, sample: f32) {
        self.buf[self.write_pos] = sample;
        self.write_pos = (self.write_pos + 1) % self.capacity();
        if self.len < self.capacity() {
            self.len += 1;
        }
    }

    /// Push a slice of samples into the buffer.
    ///
    /// If the slice is larger than capacity, only the last `capacity`
    /// samples are retained.
    pub fn push_slice(&mut self, samples: &[f32]) {
        let cap = self.capacity();

        if samples.len() >= cap {
            // Only keep the last `cap` samples
            let start = samples.len() - cap;
            self.buf.copy_from_slice(&samples[start..]);
            self.write_pos = 0;
            self.len = cap;
            return;
        }

        for &s in samples {
            self.push(s);
        }
    }

    /// Get a linearized snapshot of the buffer contents in chronological order.
    ///
    /// Returns a `Vec<f32>` with the oldest sample first and newest last.
    /// Length equals `self.len()` (may be less than capacity if not yet full).
    pub fn snapshot(&self) -> Vec<f32> {
        if self.len == 0 {
            return Vec::new();
        }

        let mut out = Vec::with_capacity(self.len);
        if self.len < self.capacity() {
            // Buffer not full yet — data starts at 0
            out.extend_from_slice(&self.buf[..self.len]);
        } else {
            // Buffer is full — read from write_pos (oldest) wrapping around
            out.extend_from_slice(&self.buf[self.write_pos..]);
            out.extend_from_slice(&self.buf[..self.write_pos]);
        }
        out
    }

    /// Get a downsampled snapshot suitable for rendering at a given width.
    ///
    /// Returns `width` samples, each being the peak (max absolute value)
    /// of its corresponding bucket. This is the standard approach for
    /// waveform visualization — preserves peaks that would be lost by
    /// simple decimation.
    pub fn snapshot_peaks(&self, width: usize) -> Vec<f32> {
        if width == 0 || self.len == 0 {
            return vec![0.0; width];
        }

        let data = self.snapshot();
        let samples_per_bucket = data.len() as f32 / width as f32;

        (0..width)
            .map(|i| {
                let start = (i as f32 * samples_per_bucket) as usize;
                let end = ((i + 1) as f32 * samples_per_bucket) as usize;
                let end = end.min(data.len());
                if start >= end {
                    0.0
                } else {
                    data[start..end]
                        .iter()
                        .map(|s| s.abs())
                        .fold(0.0f32, f32::max)
                }
            })
            .collect()
    }

    /// Number of valid samples currently stored.
    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    /// Whether the buffer is empty.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Total capacity in samples.
    #[inline]
    pub fn capacity(&self) -> usize {
        self.buf.len()
    }

    /// Whether the buffer has wrapped around (is full).
    #[inline]
    pub fn is_full(&self) -> bool {
        self.len == self.capacity()
    }

    /// Clear all samples, resetting to empty state.
    pub fn clear(&mut self) {
        self.write_pos = 0;
        self.len = 0;
        // No need to zero the buffer — len tracks valid data
    }

    /// Duration of stored audio at the given sample rate.
    pub fn duration_secs(&self, sample_rate: u32) -> f32 {
        self.len as f32 / sample_rate as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_buffer() {
        let rb = RingBuffer::new(100);
        assert_eq!(rb.capacity(), 100);
        assert_eq!(rb.len(), 0);
        assert!(rb.is_empty());
        assert!(!rb.is_full());
    }

    #[test]
    fn test_from_duration() {
        let rb = RingBuffer::from_duration_secs(2.0, 16000);
        assert_eq!(rb.capacity(), 32000);
    }

    #[test]
    fn test_push_and_snapshot() {
        let mut rb = RingBuffer::new(4);
        rb.push(1.0);
        rb.push(2.0);
        rb.push(3.0);
        assert_eq!(rb.len(), 3);
        assert_eq!(rb.snapshot(), vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn test_wrap_around() {
        let mut rb = RingBuffer::new(4);
        rb.push_slice(&[1.0, 2.0, 3.0, 4.0]);
        assert!(rb.is_full());

        // Push one more — overwrites oldest (1.0)
        rb.push(5.0);
        assert_eq!(rb.snapshot(), vec![2.0, 3.0, 4.0, 5.0]);
    }

    #[test]
    fn test_push_slice_larger_than_capacity() {
        let mut rb = RingBuffer::new(3);
        rb.push_slice(&[1.0, 2.0, 3.0, 4.0, 5.0]);
        // Only last 3 retained
        assert_eq!(rb.snapshot(), vec![3.0, 4.0, 5.0]);
        assert_eq!(rb.len(), 3);
    }

    #[test]
    fn test_snapshot_peaks() {
        let mut rb = RingBuffer::new(100);
        // Push a simple pattern: 0..99
        let samples: Vec<f32> = (0..100).map(|i| i as f32 / 100.0).collect();
        rb.push_slice(&samples);

        // Downsample to 10 buckets
        let peaks = rb.snapshot_peaks(10);
        assert_eq!(peaks.len(), 10);
        // Last bucket should have the highest peak (near 0.99)
        assert!(peaks[9] > 0.9);
        // First bucket should have low values
        assert!(peaks[0] < 0.1);
    }

    #[test]
    fn test_clear() {
        let mut rb = RingBuffer::new(10);
        rb.push_slice(&[1.0, 2.0, 3.0]);
        rb.clear();
        assert!(rb.is_empty());
        assert_eq!(rb.len(), 0);
        assert_eq!(rb.snapshot(), Vec::<f32>::new());
    }

    #[test]
    fn test_duration_secs() {
        let mut rb = RingBuffer::new(32000);
        rb.push_slice(&vec![0.0; 16000]);
        assert!((rb.duration_secs(16000) - 1.0).abs() < 1e-6);
    }
}
