const HEADER_BYTES = 16;
const BYTES_PER_SAMPLE = 8;
const IQ01_MAGIC = 0x49513031;
const MIN_BLOCK_SIZE = 16;
const MAX_BLOCK_SIZE = 65_536;

interface IqBlock {
  sequence: number;
  sampleRate: number;
  count: number;
  samples: Float32Array;
}

export function decodeIqBlock(buffer: ArrayBuffer): IqBlock {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER_BYTES) {
    throw new Error('Incomplete I/Q block.');
  }

  const view = new DataView(buffer);

  if (view.getUint32(0, false) !== IQ01_MAGIC) {
    throw new Error('Unknown I/Q protocol.');
  }

  const sequence = view.getUint32(4, true);
  const sampleRate = view.getUint32(8, true);
  const count = view.getUint32(12, true);
  const isPowerOfTwo = (count & (count - 1)) === 0;
  const expectedBytes = HEADER_BYTES + count * BYTES_PER_SAMPLE;

  if (
    sampleRate === 0 ||
    count < MIN_BLOCK_SIZE ||
    count > MAX_BLOCK_SIZE ||
    !isPowerOfTwo ||
    buffer.byteLength !== expectedBytes
  ) {
    throw new Error('Invalid I/Q block.');
  }

  // Decode explicitly as little-endian rather than relying on host byte order.
  const samples = new Float32Array(count * 2);

  for (let index = 0; index < samples.length; index++) {
    samples[index] = view.getFloat32(HEADER_BYTES + index * 4, true);
  }

  return { sequence, sampleRate, count, samples };
}
