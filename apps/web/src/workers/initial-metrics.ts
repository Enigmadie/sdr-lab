import type { StreamMetrics } from './messages';

export function createInitialMetrics(): StreamMetrics {
  return {
    processingMs: 0,
    maxProcessingMs: 0,
    gaps: 0,
    discontinuities: 0,
    rejectedBlocks: 0,
    sequence: 0,
    sampleRate: 0,
    centerHz: 0,
    blockDurationMs: 0,
    blocksPerSecond: 0,
    bytesPerSecond: 0,
    rttMs: null,
    lastBlockAgeMs: null,
    displayQueueDepth: 0,
    coalescedFrames: 0,
  };
}
