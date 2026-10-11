//! Version 1 synthetic I/Q wire format. All numeric fields are little-endian.

pub const MAGIC: &[u8; 4] = b"IQ01";
pub const HEADER_BYTES: usize = 16;

/// IQ02 carries unsigned 8-bit interleaved I/Q plus tuning metadata.
pub fn encode_rtl_iq(sequence: u32, sample_rate: u32, center_hz: u32, samples: &[u8]) -> Vec<u8> {
    assert!(samples.len().is_multiple_of(2));
    let count = u32::try_from(samples.len() / 2).expect("sample count must fit u32");
    let mut bytes = Vec::with_capacity(24 + samples.len());
    bytes.extend_from_slice(b"IQ02");
    bytes.extend_from_slice(&sequence.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&count.to_le_bytes());
    bytes.extend_from_slice(&center_hz.to_le_bytes());
    bytes.extend_from_slice(&1u32.to_le_bytes()); // Format 1: offset-binary uint8 I/Q.
    bytes.extend_from_slice(samples);
    bytes
}

/// Payload is interleaved float32 I/Q, normalized to [-1, 1].
pub fn encode_iq(sequence: u32, sample_rate: u32, samples: &[[f32; 2]]) -> Vec<u8> {
    let count = u32::try_from(samples.len()).expect("sample count must fit u32");
    let mut bytes = Vec::with_capacity(HEADER_BYTES + samples.len() * 8);
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&sequence.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&count.to_le_bytes());
    for [i, q] in samples {
        bytes.extend_from_slice(&i.to_le_bytes());
        bytes.extend_from_slice(&q.to_le_bytes());
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rtl_wire_format_preserves_raw_bytes_and_tuning() {
        let bytes = encode_rtl_iq(7, 2_400_000, 97_100_000, &[0, 255, 127, 128]);
        assert_eq!(&bytes[..4], b"IQ02");
        assert_eq!(&bytes[4..8], &7u32.to_le_bytes());
        assert_eq!(&bytes[8..12], &2_400_000u32.to_le_bytes());
        assert_eq!(&bytes[12..16], &2u32.to_le_bytes());
        assert_eq!(&bytes[16..20], &97_100_000u32.to_le_bytes());
        assert_eq!(&bytes[20..24], &1u32.to_le_bytes());
        assert_eq!(&bytes[24..], &[0, 255, 127, 128]);
    }

    #[test]
    fn wire_format_is_little_endian_and_interleaved() {
        let bytes = encode_iq(42, 48_000, &[[0.5, -0.25]]);
        assert_eq!(&bytes[..4], b"IQ01");
        assert_eq!(&bytes[4..8], &42u32.to_le_bytes());
        assert_eq!(&bytes[8..12], &48_000u32.to_le_bytes());
        assert_eq!(&bytes[12..16], &1u32.to_le_bytes());
        assert_eq!(&bytes[16..20], &0.5f32.to_le_bytes());
        assert_eq!(&bytes[20..24], &(-0.25f32).to_le_bytes());
        assert_eq!(bytes.len(), HEADER_BYTES + 8);
    }
}
