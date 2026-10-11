const HEADER_BYTES = 16;
const BYTES_PER_SAMPLE = 8;
const IQ01_MAGIC = 0x49513031;
const IQ02_MAGIC = 0x49513032;
const RTL_HEADER_BYTES = 24;
const FFT_SAMPLES = 2048;
const MIN_BLOCK_SIZE = 16;
const MAX_BLOCK_SIZE = 65_536;

interface IqBlock {
  sequence: number;
  sampleRate: number;
  count: number;
  centerHz: number;
  samples: Float32Array;
}

export function decodeIqBlock(buffer: ArrayBuffer): IqBlock {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER_BYTES) {
    throw new Error('Incomplete I/Q block.');
  }

  const view = new DataView(buffer);

  const magic = view.getUint32(0, false);
  const isRtl = magic === IQ02_MAGIC;
  if (magic !== IQ01_MAGIC && !isRtl) {
    throw new Error('Unknown I/Q protocol.');
  }

  const sequence = view.getUint32(4, true);
  const sampleRate = view.getUint32(8, true);
  const count = view.getUint32(12, true);
  const isPowerOfTwo = (count & (count - 1)) === 0;
  const headerBytes = isRtl ? RTL_HEADER_BYTES : HEADER_BYTES;
  const expectedBytes = headerBytes + count * (isRtl ? 2 : BYTES_PER_SAMPLE);

  if (
    sampleRate === 0 ||
    count < MIN_BLOCK_SIZE ||
    count > MAX_BLOCK_SIZE ||
    !isPowerOfTwo ||
    buffer.byteLength !== expectedBytes
  ) {
    throw new Error('Invalid I/Q block.');
  }
  const centerHz = isRtl ? view.getUint32(16, true) : 0;
  if (isRtl && (view.getUint32(20, true) !== 1 || centerHz === 0)) {
    throw new Error('Invalid RTL-SDR block metadata.');
  }

  // Decode explicitly as little-endian rather than relying on host byte order.
  // Spectrum is a snapshot of the latest window, not a full-stream demodulator.
  const windowCount = Math.min(count, FFT_SAMPLES);
  const samples = new Float32Array(windowCount * 2);
  const offset =
    headerBytes + (count - windowCount) * (isRtl ? 2 : BYTES_PER_SAMPLE);

  for (let index = 0; index < samples.length; index++) {
    samples[index] = isRtl
      ? (view.getUint8(offset + index) - 127.5) / 127.5
      : view.getFloat32(offset + index * 4, true);
  }

  return { sequence, sampleRate, count, centerHz, samples };
}
