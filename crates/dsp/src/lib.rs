use std::sync::Arc;

use rustfft::{Fft, FftPlanner, num_complex::Complex};

/// Reuses the FFT plan and buffers. Output is fftshifted, window-gain-normalized
/// dBFS per bin (not calibrated dBm or power spectral density).
pub struct Spectrum {
    fft: Arc<dyn Fft<f32>>,
    bins: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
    window: Vec<f32>,
    window_sum: f32,
}

impl Spectrum {
    pub fn new(size: usize) -> Result<Self, &'static str> {
        if !(16..=65_536).contains(&size) || !size.is_power_of_two() {
            return Err("FFT size must be a power of two between 16 and 65536");
        }
        let fft = FftPlanner::new().plan_fft_forward(size);
        let window: Vec<_> = (0..size)
            .map(|n| 0.5 - 0.5 * (std::f32::consts::TAU * n as f32 / size as f32).cos())
            .collect();
        Ok(Self {
            scratch: vec![Complex::default(); fft.get_inplace_scratch_len()],
            fft,
            bins: vec![Complex::default(); size],
            window_sum: window.iter().sum(),
            window,
        })
    }

    pub fn process(&mut self, iq: &[f32]) -> Result<Vec<f32>, &'static str> {
        let size = self.bins.len();
        if iq.len() != size * 2 {
            return Err("I/Q block length must match FFT size");
        }
        for ((bin, pair), window) in self
            .bins
            .iter_mut()
            .zip(iq.chunks_exact(2))
            .zip(&self.window)
        {
            *bin = Complex::new(pair[0] * window, pair[1] * window);
        }
        self.fft
            .process_with_scratch(&mut self.bins, &mut self.scratch);
        Ok((0..size)
            .map(|n| {
                let amplitude = self.bins[(n + size / 2) % size].norm() / self.window_sum;
                20.0 * amplitude.max(1e-7).log10()
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complex_tone_has_correct_shifted_bin_and_amplitude() {
        let size = 1024;
        for bin in [64isize, -64] {
            let iq: Vec<_> = (0..size)
                .flat_map(|n| {
                    let phase = std::f32::consts::TAU * bin as f32 * n as f32 / size as f32;
                    [0.5 * phase.cos(), 0.5 * phase.sin()]
                })
                .collect();
            let power = Spectrum::new(size).unwrap().process(&iq).unwrap();
            let peak = power
                .iter()
                .enumerate()
                .max_by(|a, b| a.1.total_cmp(b.1))
                .unwrap();
            assert_eq!(peak.0, (size as isize / 2 + bin) as usize);
            assert!((peak.1 + 6.0206).abs() < 0.01);
        }
    }

    #[test]
    fn rejects_invalid_sizes_and_blocks_and_handles_silence() {
        assert!(Spectrum::new(1000).is_err());
        let mut spectrum = Spectrum::new(1024).unwrap();
        assert!(spectrum.process(&[0.0; 4]).is_err());
        assert!(
            spectrum
                .process(&[0.0; 2048])
                .unwrap()
                .iter()
                .all(|v| v.is_finite())
        );
    }
}
