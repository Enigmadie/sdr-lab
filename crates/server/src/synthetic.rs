use std::f64::consts::TAU;

/// Continuous-phase tones, a sweep, bursts, and reproducible low-level noise.
pub struct SyntheticSource {
    sample_rate: u32,
    sample_index: u64,
    sweep_phase: f64,
    noise_state: u32,
}

impl SyntheticSource {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            sample_rate,
            sample_index: 0,
            sweep_phase: 0.0,
            noise_state: 0x1234_5678,
        }
    }

    pub fn next_block(&mut self, count: usize) -> Vec<[f32; 2]> {
        (0..count).map(|_| self.next_sample()).collect()
    }

    pub fn skip_samples(&mut self, count: usize) {
        for _ in 0..count {
            self.next_sample();
        }
    }

    fn next_sample(&mut self) -> [f32; 2] {
        let time = self.sample_index as f64 / self.sample_rate as f64;
        self.sample_index += 1;

        let fixed_positive = TAU * 6_000.0 * time;
        let fixed_negative = TAU * -10_500.0 * time;
        let sweep_frequency = 14_000.0 * (TAU * time / 8.0).sin();
        self.sweep_phase =
            (self.sweep_phase + TAU * sweep_frequency / self.sample_rate as f64) % TAU;
        let burst_phase = TAU * 18_000.0 * time;
        let burst_amplitude = if time % 2.0 < 0.15 { 0.15 } else { 0.0 };

        [
            (0.4 * fixed_positive.cos()
                + 0.18 * fixed_negative.cos()
                + 0.18 * self.sweep_phase.cos()
                + burst_amplitude * burst_phase.cos()
                + self.noise()) as f32,
            (0.4 * fixed_positive.sin()
                + 0.18 * fixed_negative.sin()
                + 0.18 * self.sweep_phase.sin()
                + burst_amplitude * burst_phase.sin()
                + self.noise()) as f32,
        ]
    }

    fn noise(&mut self) -> f64 {
        self.noise_state = self
            .noise_state
            .wrapping_mul(1_664_525)
            .wrapping_add(1_013_904_223);
        (self.noise_state as f64 / u32::MAX as f64 - 0.5) * 0.04
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skipping_preserves_the_source_timeline() {
        let mut whole = SyntheticSource::new(48_000);
        let mut skipped = SyntheticSource::new(48_000);
        whole.next_block(4096);
        skipped.skip_samples(4096);
        assert_eq!(whole.next_block(2048), skipped.next_block(2048));
    }

    #[test]
    fn block_boundaries_do_not_reset_phase_or_noise() {
        let mut whole = SyntheticSource::new(48_000);
        let mut split = SyntheticSource::new(48_000);
        let expected = whole.next_block(4096);
        let mut actual = split.next_block(2048);
        actual.extend(split.next_block(2048));
        assert_eq!(actual, expected);
        assert!(
            actual
                .iter()
                .flatten()
                .all(|value| value.is_finite() && value.abs() <= 1.0)
        );
    }
}
